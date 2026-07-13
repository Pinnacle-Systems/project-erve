import { useEffect, useRef } from 'react';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { SplashScreen } from '@capacitor/splash-screen';
import { StatusBar, Style } from '@capacitor/status-bar';
import { useTheme } from '@erve/theme';

/**
 * Same light/dark app-background values as packages/theme/src/theme.css
 * (`:root` and `.dark`) and native/android-template/res/values{,-night}/colors.xml
 * — @capacitor/status-bar takes a literal hex string, it cannot read the
 * WebView's CSS custom properties, so this is a deliberate, small
 * duplication. Keep in sync with both of those.
 */
const APP_BACKGROUND_BY_THEME = {
  light: '#eef3f8',
  dark: '#020617',
} as const;

interface NativeThemeBridgePlugin {
  setNavigationBarAppearance(options: {
    lightIcons: boolean;
    backgroundColor: string;
  }): Promise<{ applied: boolean }>;
}

/**
 * First-party plugin registered in native/android-template/java — see that
 * file's doc comment for why this isn't an official or community plugin.
 * registerPlugin() resolves lazily, so this is safe to call on web/iOS too
 * (methods simply aren't invoked there, see isAndroidNative below).
 */
const NativeThemeBridge = registerPlugin<NativeThemeBridgePlugin>('NativeThemeBridge');

/**
 * Keeps native Android surfaces (status bar, navigation bar, splash) in sync
 * with @erve/theme's resolvedTheme. Does nothing on web or iOS. Does not
 * create a second theme state — reads resolvedTheme from useTheme() only.
 */
export function NativeThemeSurfaces(): null {
  const { resolvedTheme } = useTheme();
  const hasHiddenSplash = useRef(false);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    const backgroundColor = APP_BACKGROUND_BY_THEME[resolvedTheme];
    const lightIcons = resolvedTheme === 'dark';

    // Not available on Android 15+ (edge-to-edge enforced, bars forced
    // transparent) — the WebView's own background shows through instead.
    // setStyle (icon color) still works on every version.
    void StatusBar.setStyle({ style: lightIcons ? Style.Dark : Style.Light });
    void StatusBar.setBackgroundColor({ color: backgroundColor }).catch(() => {
      // Expected rejection on Android 15+; see comment above.
    });

    if (Capacitor.getPlatform() === 'android') {
      void NativeThemeBridge.setNavigationBarAppearance({
        lightIcons,
        backgroundColor,
      }).catch(() => {
        // Same Android 15+ edge-to-edge caveat as the status bar background.
      });
    }
  }, [resolvedTheme]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || hasHiddenSplash.current) {
      return;
    }
    hasHiddenSplash.current = true;
    // Runs once the WebView has mounted with the correct resolvedTheme
    // already applied (theme-init.js ran before this), so the splash never
    // dismisses onto an unthemed frame. See capacitor.config.ts's
    // `launchAutoHide: false`.
    void SplashScreen.hide();
  }, []);

  return null;
}

NativeThemeSurfaces.displayName = 'NativeThemeSurfaces';
