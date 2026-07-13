package com.erve.mobile;

import android.graphics.Color;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Minimal first-party bridge for the one native surface the official
 * @capacitor/status-bar plugin does not cover: the Android navigation bar.
 * There is no maintained official Capacitor navigation-bar plugin (see the
 * mobile native-theme task report for the alternatives considered), so this
 * plugin exists instead of pulling in an unmaintained community dependency.
 *
 * Uses only public, documented AndroidX/framework APIs (WindowInsetsControllerCompat,
 * Window#setNavigationBarColor) — no reflection, no hidden APIs. On API 35+
 * (edge-to-edge enforced), the color set here is a no-op by design; the
 * WebView's own background shows through the transparent bar instead, and
 * only the icon-appearance call has any effect.
 */
@CapacitorPlugin(name = "NativeThemeBridge")
public class NativeThemeBridgePlugin extends Plugin {

    @PluginMethod
    public void setNavigationBarAppearance(PluginCall call) {
        Boolean lightIcons = call.getBoolean("lightIcons");
        String backgroundColor = call.getString("backgroundColor");

        if (lightIcons == null || backgroundColor == null) {
            call.reject("lightIcons and backgroundColor are required");
            return;
        }

        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            try {
                window.setNavigationBarColor(Color.parseColor(backgroundColor));
            } catch (IllegalArgumentException ignored) {
                // Invalid color string: leave the current navigation bar color untouched.
            }

            WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());
            // true = dark icons (for a light bar); false = light icons (for a dark bar).
            controller.setAppearanceLightNavigationBars(lightIcons);

            JSObject result = new JSObject();
            result.put("applied", true);
            call.resolve(result);
        });
    }
}
