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
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.UnrecoverableKeyException;
import java.security.spec.ECGenParameterSpec;
import java.security.spec.MGF1ParameterSpec;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

/**
 * Holds the rotating refresh credential and the biometric trusted-device key.
 *
 * Two independent things live here, on purpose:
 *
 * 1. The SESSION credential (refresh token). Not registered: AES/GCM with a
 *    non-authenticated Android Keystore key (erve_refresh_session_key),
 *    readable without user interaction, exactly as before biometric login
 *    existed. Registered (see 2): held in process memory only, never at rest,
 *    because every cold start signs in with the biometric anyway. Clearing it
 *    (logout, rejected or expired session) ends the session and nothing else.
 *
 * 2. The TRUSTED-DEVICE key (erve_trusted_device_key). An EC P-256 signing key
 *    generated in the Keystore, non-exportable, that requires a strong
 *    (Class 3) biometric for every single signature and is invalidated when
 *    biometrics are enrolled/removed or the screen lock is removed. Only its
 *    public half ever leaves the device (it is registered with the server
 *    after a password sign-in). The server issues a one-time challenge; the
 *    app signs it through a BiometricPrompt bound to this key and the server
 *    mints a brand-new session. The key and its small metadata (device id,
 *    user id, expiry hint) survive logout; only "Turn off", an invalidated key,
 *    an unauthorized device or a different account's sign-in remove them.
 *
 * The user's password is never stored. The v0.2.0 "biometric-protected refresh
 * credential" envelope is kept only so an upgrading user's working session can
 * be moved out of it once, after a biometric prompt (see unlockLegacyBiometric);
 * it can no longer be created.
 */
@CapacitorPlugin(name = "SecureSessionBridge")
public class SecureSessionBridgePlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";

    // --- session credential (unprotected-by-biometric, Keystore-encrypted) ---
    private static final String KEY_ALIAS = "erve_refresh_session_key";
    private static final String STORE = "erve_secure_session";
    private static final String CIPHERTEXT = "refresh_ciphertext";
    private static final String IV = "refresh_iv";

    // --- v0.2.0 biometric envelope (read-only, for migration) ---
    private static final String BIO_KEY_ALIAS = "erve_biometric_session_key";
    private static final String BIO_STORE = "erve_biometric_session";
    private static final String BIO_ENABLED = "enabled";
    private static final String BIO_WRAPPED_KEY = "wrapped_key";
    private static final String BIO_IV = "iv";
    private static final String BIO_CIPHERTEXT = "ciphertext";

    private static final String RSA_TRANSFORMATION = "RSA/ECB/OAEPWithSHA-256AndMGF1Padding";
    // Android Keystore always uses SHA-1 for the MGF1 digest of RSA-OAEP.
    private static final OAEPParameterSpec OAEP = new OAEPParameterSpec(
        "SHA-256", "MGF1", MGF1ParameterSpec.SHA1, PSource.PSpecified.DEFAULT);

    // --- trusted device ---
    private static final String DEVICE_KEY_ALIAS = "erve_trusted_device_key";
    private static final String DEVICE_STORE = "erve_trusted_device";
    private static final String DEV_REGISTERED = "registered";
    private static final String DEV_ID = "device_id";
    private static final String DEV_USER_ID = "user_id";
    private static final String DEV_EXPIRES_AT = "expires_at";
    /** A registration this phone dropped but has not yet been able to revoke on the server. */
    private static final String DEV_PENDING_ID = "pending_revoke_device_id";
    private static final String DEV_PENDING_USER = "pending_revoke_user_id";
    /** Why the phone itself turned biometric login off ("key-invalidated"); shown once to the user. */
    private static final String DEV_INVALIDATED = "invalidated_reason";
    private static final String SIGNATURE_ALGORITHM = "SHA256withECDSA";
    private static final int MAX_MESSAGE_LENGTH = 2048;

    private static final int PROBE_OK = 0;
    private static final int PROBE_INVALID = 1;
    private static final int PROBE_ERROR = 2;

    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    /** Guards every read and write of the stores and of {@link #memoryToken}. */
    private static final Object LOCK = new Object();
    /** The refresh credential while a trusted device is registered. Memory only. */
    private static String memoryToken;
    private static final AtomicBoolean PROMPT_ACTIVE = new AtomicBoolean(false);

    // ------------------------------------------------------------------ storage

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(STORE, Context.MODE_PRIVATE);
    }

    private SharedPreferences legacyBiometricPreferences() {
        return getContext().getSharedPreferences(BIO_STORE, Context.MODE_PRIVATE);
    }

    private SharedPreferences devicePreferences() {
        return getContext().getSharedPreferences(DEVICE_STORE, Context.MODE_PRIVATE);
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

    private void storePersisted(String token) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encrypted = cipher.doFinal(token.getBytes(StandardCharsets.UTF_8));
        boolean saved = preferences().edit()
            .putString(CIPHERTEXT, Base64.encodeToString(encrypted, Base64.NO_WRAP))
            .putString(IV, Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP))
            .commit();
        if (!saved) throw new IllegalStateException("Preferences write failed");
    }

    /** Returns the persisted credential, or null if none (or if it was unreadable and has been dropped). */
    private String readPersisted() {
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

    private void clearPersisted() {
        preferences().edit().clear().commit();
    }

    // ------------------------------------------------ v0.2.0 envelope (migration)

    private boolean isLegacyPresent() {
        return legacyBiometricPreferences().getBoolean(BIO_ENABLED, false);
    }

    private void deleteLegacyKey() {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            if (store.containsAlias(BIO_KEY_ALIAS)) store.deleteEntry(BIO_KEY_ALIAS);
        } catch (Exception ignored) {
            // Nothing useful to do; the envelope is removed separately.
        }
    }

    /** Removes the v0.2.0 key and envelope. Touches nothing else. Caller holds LOCK. */
    private void wipeLegacyBiometric() {
        legacyBiometricPreferences().edit().clear().commit();
        deleteLegacyKey();
    }

    /** Throws KeyPermanentlyInvalidatedException when the key was invalidated by a biometric change. */
    private Cipher legacyUnwrapCipher() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        PrivateKey key = (PrivateKey) store.getKey(BIO_KEY_ALIAS, null);
        if (key == null) throw new KeyPermanentlyInvalidatedException("Biometric key is missing");
        Cipher cipher = Cipher.getInstance(RSA_TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, key, OAEP);
        return cipher;
    }

    private String legacyUnwrap(Cipher authenticatedRsa) throws Exception {
        SharedPreferences prefs = legacyBiometricPreferences();
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

    // ------------------------------------------------------------ trusted device

    private boolean isDeviceRegistered() {
        return devicePreferences().getBoolean(DEV_REGISTERED, false);
    }

    private void deleteDeviceKey() {
        try {
            KeyStore store = KeyStore.getInstance(KEYSTORE);
            store.load(null);
            if (store.containsAlias(DEVICE_KEY_ALIAS)) store.deleteEntry(DEVICE_KEY_ALIAS);
        } catch (Exception ignored) {
            // If this fails the key is still unusable without the server's registration.
        }
    }

    /** Generates a fresh non-exportable P-256 key that needs a strong biometric for every use. */
    private String generateDeviceKey() throws Exception {
        deleteDeviceKey();
        KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE);
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(DEVICE_KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(new ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
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
        KeyPair pair = generator.generateKeyPair();
        // X.509 SubjectPublicKeyInfo, which is what the server parses.
        return Base64.encodeToString(pair.getPublic().getEncoded(), Base64.NO_WRAP);
    }

    /**
     * Initialises a signature with the device key. Throws KeyPermanentlyInvalidatedException
     * when biometrics changed, the lock screen was removed or the key is gone.
     */
    private Signature deviceSignature() throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        PrivateKey key;
        try {
            key = (PrivateKey) store.getKey(DEVICE_KEY_ALIAS, null);
        } catch (UnrecoverableKeyException error) {
            throw new KeyPermanentlyInvalidatedException("Device key is unrecoverable");
        }
        if (key == null) throw new KeyPermanentlyInvalidatedException("Device key is missing");
        Signature signature = Signature.getInstance(SIGNATURE_ALGORITHM);
        signature.initSign(key);
        return signature;
    }

    /** Checks the key without showing a prompt. initSign fails for an invalidated key. */
    private int probeDeviceKey() {
        try {
            deviceSignature();
            return PROBE_OK;
        } catch (KeyPermanentlyInvalidatedException error) {
            return PROBE_INVALID;
        } catch (Exception error) {
            return PROBE_ERROR;
        }
    }

    /**
     * Forgets this phone's registration locally: deletes the key and metadata. With
     * {@code keepPendingRevocation} the registration's ids are remembered so the server
     * record can be revoked the next time that user is signed in. A live in-memory
     * session is kept (moved to the persisted store) so turning biometric login off
     * does not sign the user out. Caller holds LOCK.
     */
    private void dropRegistration(boolean keepPendingRevocation, String invalidatedReason) {
        SharedPreferences prefs = devicePreferences();
        SharedPreferences.Editor editor = prefs.edit();
        if (prefs.getBoolean(DEV_REGISTERED, false) && keepPendingRevocation) {
            String id = prefs.getString(DEV_ID, null);
            String user = prefs.getString(DEV_USER_ID, null);
            if (id != null && user != null) {
                editor.putString(DEV_PENDING_ID, id).putString(DEV_PENDING_USER, user);
            }
        }
        editor.remove(DEV_REGISTERED).remove(DEV_ID).remove(DEV_USER_ID).remove(DEV_EXPIRES_AT);
        if (invalidatedReason != null) editor.putString(DEV_INVALIDATED, invalidatedReason);
        editor.commit();
        deleteDeviceKey();
        if (memoryToken != null) {
            try {
                storePersisted(memoryToken);
            } catch (Exception ignored) {
                // The session simply ends; the user signs in again.
            }
            memoryToken = null;
        }
    }

    private static String deviceLabel() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        if (!manufacturer.isEmpty() && model.toLowerCase().startsWith(manufacturer.toLowerCase())) {
            return model;
        }
        String label = (manufacturer + " " + model).trim();
        return label.isEmpty() ? "Android device" : label;
    }

    private String appVersion() {
        try {
            String name = getContext().getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0).versionName;
            return name == null ? "" : name;
        } catch (Exception error) {
            return "";
        }
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
        void onSuccess(BiometricPrompt.CryptoObject authenticated) throws Exception;
        void onFailure();
    }

    /** Shows the system biometric prompt bound to {@code crypto}; rejects {@code call} on any failure. */
    private void authenticate(
        PluginCall call,
        BiometricPrompt.CryptoObject crypto,
        String title,
        String subtitle,
        String negativeText,
        PromptResult result
    ) {
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
                            result.onSuccess(authentication.getCryptoObject());
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
                .setNegativeButtonText(negativeText)
                .setAllowedAuthenticators(AUTHENTICATORS)
                .setConfirmationRequired(false)
                .build();
            try {
                prompt.authenticate(info, crypto);
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
                // A fresh credential supersedes any stale v0.2.0 biometric lock, so it can never
                // keep blocking password sign-in.
                if (isLegacyPresent()) wipeLegacyBiometric();
                if (isDeviceRegistered()) {
                    // Trusted device registered: the session lives in memory only; every cold start
                    // signs in with the biometric instead of reading a credential at rest.
                    memoryToken = token;
                    clearPersisted();
                } else {
                    storePersisted(token);
                }
                call.resolve();
            } catch (Exception error) { call.reject("Unable to store secure session", error); }
        }
    }

    @PluginMethod
    public void getRefreshToken(PluginCall call) {
        synchronized (LOCK) {
            JSObject result = new JSObject();
            if (isDeviceRegistered()) {
                if (memoryToken == null) {
                    // No session in this process: biometric sign-in (or a password) is required.
                    call.reject("Biometric sign-in required", "BIOMETRIC_LOCKED");
                    return;
                }
                result.put("token", memoryToken);
                call.resolve(result);
                return;
            }
            if (isLegacyPresent()) {
                call.reject("Biometric authentication required", "BIOMETRIC_LOCKED");
                return;
            }
            String token = readPersisted();
            result.put("token", token == null ? JSObject.NULL : token);
            call.resolve(result);
        }
    }

    /**
     * Ends the SESSION: logout, a rejected/expired session and "unreadable" recovery land
     * here. It removes the credential (and any stale v0.2.0 envelope) and deliberately
     * leaves the trusted-device key and registration alone, so biometric sign-in survives.
     */
    @PluginMethod
    public void clearRefreshToken(PluginCall call) {
        synchronized (LOCK) {
            clearPersisted();
            wipeLegacyBiometric();
            memoryToken = null;
        }
        call.resolve();
    }

    // ------------------------------------------------------- biometric login API

    @PluginMethod
    public void getBiometricStatus(PluginCall call) {
        synchronized (LOCK) {
            boolean registered = isDeviceRegistered();
            if (registered && probeDeviceKey() == PROBE_INVALID) {
                // Biometrics changed, the lock screen was removed or the key is gone (e.g. a
                // restored backup): the registration is unusable. Drop it locally and remember
                // to revoke it on the server after the next password sign-in.
                dropRegistration(true, "key-invalidated");
                registered = false;
            }
            SharedPreferences prefs = devicePreferences();
            JSObject result = new JSObject();
            result.put("availability", availabilityName(canAuthenticate()));
            result.put("enabled", registered);
            result.put("locked", registered && memoryToken == null);
            result.put("userId", registered ? prefs.getString(DEV_USER_ID, null) : JSObject.NULL);
            result.put("deviceId", registered ? prefs.getString(DEV_ID, null) : JSObject.NULL);
            result.put("expiresAt", registered ? prefs.getString(DEV_EXPIRES_AT, null) : JSObject.NULL);
            result.put("legacy", isLegacyPresent());
            result.put("invalidatedReason", prefs.getString(DEV_INVALIDATED, null));
            String pendingId = prefs.getString(DEV_PENDING_ID, null);
            String pendingUser = prefs.getString(DEV_PENDING_USER, null);
            if (pendingId != null && pendingUser != null) {
                JSObject pending = new JSObject();
                pending.put("deviceId", pendingId);
                pending.put("userId", pendingUser);
                result.put("pendingRevocation", pending);
            } else {
                result.put("pendingRevocation", JSObject.NULL);
            }
            call.resolve(result);
        }
    }

    /**
     * Step 1 of enabling: creates the device key (no prompt) and returns its public half plus
     * descriptive metadata. The key is not trusted until commitDeviceRegistration.
     */
    @PluginMethod
    public void createDeviceKey(PluginCall call) {
        if (canAuthenticate() != BiometricManager.BIOMETRIC_SUCCESS) {
            call.reject("Strong biometric authentication is not available", "BIOMETRIC_UNAVAILABLE");
            return;
        }
        synchronized (LOCK) {
            if (isDeviceRegistered()) {
                call.reject("Biometric login is already set up on this phone", "DEVICE_ALREADY_REGISTERED");
                return;
            }
            try {
                String publicKey = generateDeviceKey();
                JSObject result = new JSObject();
                result.put("publicKey", publicKey);
                result.put("deviceLabel", deviceLabel());
                result.put("appVersion", appVersion());
                call.resolve(result);
            } catch (Exception error) {
                deleteDeviceKey();
                call.reject("Unable to prepare biometric login", "BIOMETRIC_UNAVAILABLE", error);
            }
        }
    }

    /**
     * Signs a server challenge with the device key after a strong-biometric prompt bound to that
     * key. purpose "register" signs with the not-yet-committed key; "sign-in" requires a
     * committed registration.
     */
    @PluginMethod
    public void signWithDeviceKey(PluginCall call) {
        final String message = call.getString("message");
        final String purpose = call.getString("purpose");
        if (message == null || message.isEmpty() || message.length() > MAX_MESSAGE_LENGTH) {
            call.reject("message is required");
            return;
        }
        final boolean registering = "register".equals(purpose);
        if (!registering && !"sign-in".equals(purpose)) { call.reject("purpose is invalid"); return; }

        final Signature signature;
        synchronized (LOCK) {
            if (!registering && !isDeviceRegistered()) {
                call.reject("Biometric sign-in is not set up on this phone", "BIOMETRIC_NOT_ENABLED");
                return;
            }
            try {
                signature = deviceSignature();
            } catch (KeyPermanentlyInvalidatedException error) {
                if (registering) deleteDeviceKey(); else dropRegistration(true, "key-invalidated");
                call.reject("Biometric settings changed", "BIOMETRIC_KEY_INVALIDATED", error);
                return;
            } catch (Exception error) {
                call.reject("Unable to use the device key", "BIOMETRIC_UNAVAILABLE", error);
                return;
            }
        }

        authenticate(
            call,
            new BiometricPrompt.CryptoObject(signature),
            registering ? "Turn on biometric login" : "Sign in to Erve",
            registering ? "Confirm to sign in with biometrics on this phone" : "Use your biometrics to continue",
            registering ? "Cancel" : "Use password",
            new PromptResult() {
                @Override
                public void onSuccess(BiometricPrompt.CryptoObject authenticated) throws Exception {
                    // Key invalidation surfaces at initSign (handled above); once the prompt has
                    // authenticated this signature object, update/sign only fail on a hardware fault.
                    Signature authenticatedSignature = authenticated.getSignature();
                    authenticatedSignature.update(message.getBytes(StandardCharsets.UTF_8));
                    byte[] signed = authenticatedSignature.sign();
                    JSObject result = new JSObject();
                    result.put("signature", Base64.encodeToString(signed, Base64.NO_WRAP));
                    call.resolve(result);
                }

                @Override
                public void onFailure() { /* nothing to undo; the key and registration are unchanged */ }
            }
        );
    }

    /**
     * Step 3 of enabling, after the server accepted the public key: marks this phone registered
     * and moves any persisted session into memory so nothing is left at rest.
     */
    @PluginMethod
    public void commitDeviceRegistration(PluginCall call) {
        String deviceId = call.getString("deviceId");
        String userId = call.getString("userId");
        String expiresAt = call.getString("expiresAt");
        if (deviceId == null || deviceId.isEmpty() || userId == null || userId.isEmpty() || expiresAt == null) {
            call.reject("deviceId, userId and expiresAt are required");
            return;
        }
        synchronized (LOCK) {
            if (probeDeviceKey() != PROBE_OK) {
                call.reject("The device key is not available", "BIOMETRIC_KEY_INVALIDATED");
                return;
            }
            boolean saved = devicePreferences().edit()
                .putBoolean(DEV_REGISTERED, true)
                .putString(DEV_ID, deviceId)
                .putString(DEV_USER_ID, userId)
                .putString(DEV_EXPIRES_AT, expiresAt)
                .remove(DEV_INVALIDATED)
                .commit();
            if (!saved) {
                deleteDeviceKey();
                call.reject("Preferences write failed");
                return;
            }
            wipeLegacyBiometric();
            String token = readPersisted();
            if (token != null) memoryToken = token;
            clearPersisted();
        }
        call.resolve();
    }

    /** Enabling failed or was abandoned before commit: removes the uncommitted key. */
    @PluginMethod
    public void discardDeviceKey(PluginCall call) {
        synchronized (LOCK) {
            if (!isDeviceRegistered()) deleteDeviceKey();
        }
        call.resolve();
    }

    /**
     * Removes this phone's trusted-device key and metadata (the local half of "Turn off", an
     * unauthorized device, or a different account signing in). With keepPendingRevocation the
     * server revocation is remembered until it can be completed.
     */
    @PluginMethod
    public void removeDeviceAuthorization(PluginCall call) {
        boolean keepPending = Boolean.TRUE.equals(call.getBoolean("keepPendingRevocation", false));
        synchronized (LOCK) {
            dropRegistration(keepPending, null);
        }
        call.resolve();
    }

    @PluginMethod
    public void clearPendingRevocation(PluginCall call) {
        synchronized (LOCK) {
            devicePreferences().edit().remove(DEV_PENDING_ID).remove(DEV_PENDING_USER).commit();
        }
        call.resolve();
    }

    @PluginMethod
    public void acknowledgeInvalidation(PluginCall call) {
        synchronized (LOCK) {
            devicePreferences().edit().remove(DEV_INVALIDATED).commit();
        }
        call.resolve();
    }

    /**
     * Upgrade from v0.2.0, where biometric login protected the refresh credential itself. One
     * biometric prompt moves the working session out of that envelope into the ordinary store and
     * removes the envelope and its key. It does NOT register a trusted device: the user must opt in
     * again (from this password-established session) to get sign-in-after-logout.
     */
    @PluginMethod
    public void unlockLegacyBiometric(PluginCall call) {
        final Cipher unwrapCipher;
        synchronized (LOCK) {
            if (!isLegacyPresent()) { call.resolve(); return; }
            try {
                unwrapCipher = legacyUnwrapCipher();
            } catch (Exception error) {
                // Key invalidated (biometrics changed) or gone (e.g. restored backup): password required.
                wipeLegacyBiometric();
                call.reject("Biometric settings changed", "BIOMETRIC_KEY_INVALIDATED", error);
                return;
            }
        }

        authenticate(
            call,
            new BiometricPrompt.CryptoObject(unwrapCipher),
            "Unlock Erve",
            "Use your biometrics to continue",
            "Use password",
            new PromptResult() {
                @Override
                public void onSuccess(BiometricPrompt.CryptoObject authenticated) throws Exception {
                    synchronized (LOCK) {
                        String token;
                        try {
                            token = legacyUnwrap(authenticated.getCipher());
                        } catch (java.security.GeneralSecurityException | IllegalStateException error) {
                            // Corrupt or unreadable envelope: treat like a lost credential.
                            wipeLegacyBiometric();
                            throw new KeyPermanentlyInvalidatedException("Biometric session unreadable");
                        }
                        storePersisted(token);
                        wipeLegacyBiometric();
                    }
                    call.resolve();
                }

                @Override
                public void onFailure() { /* stays locked; nothing to undo */ }
            }
        );
    }

    @Override
    protected void handleOnDestroy() {
        // The next launch must sign in again.
        synchronized (LOCK) { memoryToken = null; }
        super.handleOnDestroy();
    }
}
