package com.erve.mobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.appcompat.app.AppCompatActivity;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.PublicKey;
import java.security.cert.Certificate;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.X509EncodedKeySpec;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * Holds the rotating refresh credential for the packaged app.
 *
 * Two mutually exclusive storage modes:
 *
 * 1. Default: AES/GCM with a non-authenticated Android Keystore key
 *    (erve_refresh_session_key). The credential is readable without any user
 *    interaction, exactly as before biometric login existed.
 *
 * 2. Biometric login enabled: the credential is stored only as an
 *    envelope. A fresh AES-256 data key encrypts it, and that data key is
 *    wrapped with an RSA public key whose private half lives in the Keystore
 *    and requires a strong biometric for every use (erve_biometric_session_key;
 *    invalidated when biometrics are enrolled or removed). The credential
 *    rotates on every refresh, so it must be re-stored while the app runs; the
 *    public key allows that without a prompt, but reading it back requires a
 *    BiometricPrompt that returns a Cipher bound to the private key. The
 *    unprotected store is emptied when this mode is entered and is never
 *    consulted while it is active, so there is no way to read the credential
 *    at rest without biometric authentication. After a successful unlock the
 *    credential is held in process memory only, and dropped when the activity
 *    is destroyed.
 *
 * The user's password is never stored.
 */
@CapacitorPlugin(name = "SecureSessionBridge")
public class SecureSessionBridgePlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";

    private static final String KEY_ALIAS = "erve_refresh_session_key";
    private static final String STORE = "erve_secure_session";
    private static final String CIPHERTEXT = "refresh_ciphertext";
    private static final String IV = "refresh_iv";

    private static final String BIO_KEY_ALIAS = "erve_biometric_session_key";
    private static final String BIO_STORE = "erve_biometric_session";
    private static final String BIO_ENABLED = "enabled";
    private static final String BIO_USER_ID = "user_id";
    private static final String BIO_WRAPPED_KEY = "wrapped_key";
    private static final String BIO_IV = "iv";
    private static final String BIO_CIPHERTEXT = "ciphertext";

    private static final String RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    // Android Keystore always uses SHA-1 for the MGF1 digest of RSA-OAEP.
    private static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
        "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);

    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    /** Guards every read and write of both stores and of {@link #unlockedToken}. */
    private static final Object LOCK = new Object();
    /** The decrypted credential while biometric login is enabled and unlocked. Memory only. */
    private static String unlockedToken;
    private static final AtomicBoolean PROMPT_ACTIVE = new AtomicBoolean(false);

    // ------------------------------------------------------------------ storage

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    private SharedPreferences biometricPreferences() {
        return getContext().getSharedPreferences(BIO_STORE, Context.MODE_PRIVATE);
    }

    private boolean isBiometricEnabled() {
        return biometricPreferences().getBoolean(BIO_ENABLED, false);
    }

    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
         .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
         .build());
        return generator.generateKey();
    }

    private void storeLegacy(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        boolean saved = preferences().edit()
            .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .commit();
        if (!saved) throw new IllegalStateException("Preferences write failed");
    }

    /** Returns the legacy credential, or null if none (or if it was unreadable and has been dropped). */
    private String readLegacy() {
        String encrypted = preferences().getString(CIPHERTEXT, null);
        String iv = preferences().getString(IV, null);
        if (encrypted == null || iv == null) return null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
            byte[] plain = cipher.doFinal(Base64.decode(encrypted, Base64.NO_WRAP));
            return new String(plain, StandardCharsets.UTF_8);
        } catch (Exception error) {
            preferences().edit().clear().commit();
            return null;
        }
    }

    private void clearLegacy() {
        preferences().edit().clear().commit();
    }

    // ------------------------------------------------------- biometric envelope

    private static final class Envelope {
        String wrappedKey;
        String iv;
        String ciphertext;
    }

    private void generateBiometricKey() throws Exception {
        deleteBiometricKey();
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, KEYSTORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(BIO_KEY_ALIAS, KeyProperties.PURPOSE_DECRYPT)
            .setKeySize(2048)
            .setDigests(KeyProperties.DIGEST_SHA256, KeyProperties.DIGEST_SHA1)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Timeout 0 = authenticate for every single use of the private key.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // -1 = fingerprint (per-use, CryptoObject-bound) on API 24-29.
            spec.setUserAuthenticationValidityDurationSeconds(-1);
        }
        generator.initialize(spec.build());
        generator.generateKeyPair();
    }

    private void deleteBiometricKey() {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            if (store.containsAlias(BIO_KEY_ALIAS)) store.deleteEntry(BIO_KEY_ALIAS);
        } catch (Exception ignored) {
            // Nothing useful to do; the stored envelope is removed separately.
        }
    }

    private PublicKey biometricPublicKey() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        Certificate certificate = store.getCertificate(BIO_KEY_ALIAS);
        if (certificate == null) throw new IllegalStateException("Biometric key is missing");
        PublicKey key = certificate.getPublicKey();
        // Re-create the key outside the Keystore provider so OAEP encryption does not need authentication.
        return KeyFactory.getInstance(key.getAlgorithm()).generatePublic(new X509EncodedKeySpec(key.getEncoded()));
    }

    /** Throws KeyPermanentlyInvalidatedException when the key was invalidated by a biometric change. */
    private Cipher biometricUnwrapCipher() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        PrivateKey key = (PrivateKey) store.getKey(BIO_KEY_ALIAS, null);
        if (key == null) throw new IllegalStateException("Biometric key is missing");
        Cipher cipher = Cipher.getInstance(RSA_TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, OAEP);
        return cipher;
    }

    private Envelope wrap(String token) throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(256);
        SecretKey dataKey = generator.generateKey();

        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.ENCRYPT_MODE, dataKey);
        byte[] ciphertext = aes.doFinal(token.getBytes(StandardCharsets.UTF_8));

        Cipher rsa = Cipher.getInstance(RSA_TRANSFORMATION);
        rsa.init(Cipher.ENCRYPT_MODE, biometricPublicKey(), OAEP);

        Envelope envelope = new Envelope();
        envelope.wrappedKey = Base64.encodeToString(rsa.doFinal(dataKey.getEncoded()), Base64.NO_WRAP);
        envelope.iv = Base64.encodeToString(aes.getIV(), Base64.NO_WRAP);
        envelope.ciphertext = Base64.encodeToString(ciphertext, Base64.NO_WRAP);
        return envelope;
    }

    private String unwrap(Cipher authenticatedRsa) throws Exception {
        SharedPreferences prefs = biometricPreferences();
        String wrappedKey = prefs.getString(BIO_WRAPPED_KEY, null);
        String iv = prefs.getString(BIO_IV, null);
        String ciphertext = prefs.getString(BIO_CIPHERTEXT, null);
        if (wrappedKey == null || iv == null || ciphertext == null) {
            throw new IllegalStateException("Biometric session is missing");
        }
        byte[] dataKey = authenticatedRsa.doFinal(Base64.decode(wrappedKey, Base64.NO_WRAP));
        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(dataKey, "AES"), new GCMParameterSpec(128, Base64.decode(iv, Base64.NO_WRAP)));
        return new String(aes.doFinal(Base64.decode(ciphertext, Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private void writeEnvelope(Envelope envelope, String userId) {
        boolean saved = biometricPreferences().edit()
            .putString(BIO_WRAPPED_KEY, envelope.wrappedKey)
            .putString(BIO_IV, envelope.iv)
            .putString(BIO_CIPHERTEXT, envelope.ciphertext)
            .putString(BIO_USER_ID, userId)
            .putBoolean(BIO_ENABLED, true)
            .commit();
        if (!saved) throw new IllegalStateException("Preferences write failed");
    }

    /** Removes the biometric key and envelope and leaves biometric login disabled. Caller holds LOCK. */
    private void wipeBiometric() {
        biometricPreferences().edit().clear().commit();
        deleteBiometricKey();
    }

    // ------------------------------------------------------------- availability

    private int canAuthenticate() {
        return BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
    }

    private static String availabilityName(int result) {
        switch (result) {
            case BiometricManager.BIOMETRIC_SUCCESS: return "available";
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE: return "no-hardware";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED: return "none-enrolled";
            case BiometricManager.BIOMETRIC_ERROR_UNSUPPORTED: return "unsupported";
            default: return "unavailable";
        }
    }

    private static String promptErrorCode(int code) {
        switch (code) {
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
            case BiometricPrompt.ERROR_CANCELED:
                return "BIOMETRIC_CANCELED";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "BIOMETRIC_LOCKOUT";
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_NO_DEVICE_CREDENTIAL:
                return "BIOMETRIC_UNAVAILABLE";
            default:
                return "BIOMETRIC_FAILED";
        }
    }

    // ------------------------------------------------------------------ prompts

    private interface PromptResult {
        void onSuccess(Cipher authenticated) throws Exception;
        void onFailure();
    }

    /** Shows the system biometric prompt bound to {@code cipher}; rejects {@code call} on any failure. */
    private void authenticate(PluginCall call, Cipher cipher, String title, String subtitle, PromptResult result) {
        if (!PROMPT_ACTIVE.compareAndSet(false, true)) {
            result.onFailure();
            call.reject("A biometric prompt is already showing", "BIOMETRIC_FAILED");
            return;
        }
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            PROMPT_ACTIVE.set(false);
            result.onFailure();
            call.reject("The app is not in the foreground", "BIOMETRIC_UNAVAILABLE");
            return;
        }
        activity.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult authentication) {
                        PROMPT_ACTIVE.set(false);
                        try {
                            result.onSuccess(authentication.getCryptoObject().getCipher());
                        } catch (KeyPermanentlyInvalidatedException error) {
                            result.onFailure();
                            call.reject("Biometric settings changed", "BIOMETRIC_KEY_INVALIDATED", error);
                        } catch (Exception error) {
                            result.onFailure();
                            call.reject("Biometric authentication failed", "BIOMETRIC_FAILED", error);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence message) {
                        PROMPT_ACTIVE.set(false);
                        result.onFailure();
                        call.reject(String.valueOf(message), promptErrorCode(errorCode));
                    }
                }
            );
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setSubtitle(subtitle)
                .setNegativeButtonText("Use password")
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(false)
                .build();
            try {
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
            } catch (Exception error) {
                PROMPT_ACTIVE.set(false);
                result.onFailure();
                call.reject("Unable to show biometric prompt", "BIOMETRIC_UNAVAILABLE", error);
            }
        });
    }

    // ------------------------------------------------- refresh credential API

    @PluginMethod
    public void setRefreshToken(PluginCall call) {
        String token = call.getString("token");
        if (token == null || token.isEmpty()) { call.reject("token is required"); return; }
        synchronized (LOCK) {
            try {
                if (isBiometricEnabled()) {
                    // Rotation while biometric login is on: re-wrap with the public key (no prompt),
                    // never write the unprotected store.
                    String userId = biometricPreferences().getString(BIO_USER_ID, "");
                    writeEnvelope(wrap(token), userId);
                    unlockedToken = token;
                } else {
                    storeLegacy(token);
                }
                call.resolve();
            } catch (Exception error) { call.reject("Unable to store secure session", error); }
        }
    }

    @PluginMethod
    public void getRefreshToken(PluginCall call) {
        synchronized (LOCK) {
            JSObject result = new JSObject();
            if (isBiometricEnabled()) {
                clearLegacy();
                if (unlockedToken == null) {
                    // Deliberately no fallback to any other store.
                    call.reject("Biometric authentication required", "BIOMETRIC_LOCKED");
                    return;
                }
                result.put("token", unlockedToken);
                call.resolve(result);
                return;
            }
            String token = readLegacy();
            if (token == null) {
                result.put("token", JSObject.NULL);
                call.resolve(result);
                return;
            }
            result.put("token", token);
            call.resolve(result);
        }
    }

    /** Explicit logout, rejected/expired sessions and "unreadable" recovery all end up here. */
    @PluginMethod
    public void clearRefreshToken(PluginCall call) {
        synchronized (LOCK) {
            clearLegacy();
            wipeBiometric();
            unlockedToken = null;
        }
        call.resolve();
    }

    // ------------------------------------------------------- biometric login API

    @PluginMethod
    public void getBiometricStatus(PluginCall call) {
        synchronized (LOCK) {
            boolean enabled = isBiometricEnabled();
            if (enabled) clearLegacy();
            JSObject result = new JSObject();
            result.put("availability", availabilityName(canAuthenticate()));
            result.put("enabled", enabled);
            result.put("locked", enabled && unlockedToken == null);
            String userId = biometricPreferences().getString(BIO_USER_ID, null);
            result.put("userId", enabled && userId != null ? userId : JSObject.NULL);
            call.resolve(result);
        }
    }

    @PluginMethod
    public void enableBiometric(PluginCall call) {
        String userId = call.getString("userId");
        if (userId == null || userId.isEmpty()) { call.reject("userId is required"); return; }
        if (canAuthenticate() != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Strong biometric authentication is not available", "BIOMETRIC_UNAVAILABLE");
            return;
        }

        final Envelope probe;
        final Cipher unwrapCipher;
        synchronized (LOCK) {
            if (isBiometricEnabled()) { call.resolve(); return; }
            String token = readLegacy();
            if (token == null) { call.reject("There is no signed-in session to protect", "NO_SESSION"); return; }
            try {
                generateBiometricKey();
                probe = wrap(token);
                unwrapCipher = biometricUnwrapCipher();
            } catch (Exception error) {
                deleteBiometricKey();
                call.reject("Unable to prepare biometric login", "BIOMETRIC_UNAVAILABLE", error);
                return;
            }
        }

        // The user must prove their biometric works with the new key before the unprotected copy is removed.
        authenticate(call, unwrapCipher, "Enable biometric login", "Confirm to use biometrics to unlock Erve", new PromptResult() {
            @Override
            public void onSuccess(Cipher authenticated) throws Exception {
                byte[] dataKey = authenticated.doFinal(Base64.decode(probe.wrappedKey, Base64.NO_WRAP));
                if (dataKey.length != 32) throw new IllegalStateException("Biometric key verification failed");
                synchronized (LOCK) {
                    // A refresh may have rotated the credential while the prompt was open: protect the newest one.
                    String latest = readLegacy();
                    if (latest == null) throw new IllegalStateException("Session ended during enrollment");
                    writeEnvelope(wrap(latest), userId);
                    clearLegacy();
                    unlockedToken = latest;
                }
                call.resolve();
            }

            @Override
            public void onFailure() {
                synchronized (LOCK) {
                    if (!isBiometricEnabled()) deleteBiometricKey();
                }
            }
        });
    }

    @PluginMethod
    public void unlockBiometric(PluginCall call) {
        final Cipher unwrapCipher;
        synchronized (LOCK) {
            if (!isBiometricEnabled()) { call.reject("Biometric login is not enabled", "BIOMETRIC_NOT_ENABLED"); return; }
            if (unlockedToken != null) { call.resolve(); return; }
            try {
                unwrapCipher = biometricUnwrapCipher();
            } catch (Exception error) {
                // Key invalidated (biometrics changed) or gone (e.g. restored backup): password required.
                wipeBiometric();
                call.reject("Biometric settings changed", "BIOMETRIC_KEY_INVALIDATED", error);
                return;
            }
        }

        authenticate(call, unwrapCipher, "Unlock Erve", "Use your biometrics to continue", new PromptResult() {
            @Override
            public void onSuccess(Cipher authenticated) throws Exception {
                synchronized (LOCK) {
                    try {
                        unlockedToken = unwrap(authenticated);
                    } catch (KeyPermanentlyInvalidatedException error) {
                        wipeBiometric();
                        throw error;
                    } catch (java.security.GeneralSecurityException | IllegalStateException error) {
                        // Corrupt or unreadable envelope: treat like a lost credential.
                        wipeBiometric();
                        throw new KeyPermanentlyInvalidatedException("Biometric session unreadable");
                    }
                }
                call.resolve();
            }

            @Override
            public void onFailure() { /* stays locked; nothing to undo */ }
        });
    }

    @PluginMethod
    public void disableBiometric(PluginCall call) {
        synchronized (LOCK) {
            if (!isBiometricEnabled()) { call.resolve(); return; }
            String token = unlockedToken;
            wipeBiometric();
            unlockedToken = null;
            if (token != null) {
                try {
                    // Disabling happens inside an unlocked session: keep the user signed in.
                    storeLegacy(token);
                } catch (Exception error) {
                    call.reject("Unable to keep the session after disabling biometric login", error);
                    return;
                }
            }
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        // The next launch must authenticate again.
        synchronized (LOCK) { unlockedToken = null; }
        super.handleOnDestroy();
    }
}
