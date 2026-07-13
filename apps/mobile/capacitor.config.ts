import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.erve.mobile',
  appName: 'Erve',
  webDir: 'dist',
  plugins: {
    SplashScreen: {
      // The native Android 12 Splash Screen API theme (see
      // native/android-template/res/values{,-night}/styles.xml) already
      // paints the correct light/dark background before any JS runs.
      // launchAutoHide is disabled so the plugin defers to explicit
      // SplashScreen.hide() (see src/theme/NativeThemeSurfaces.tsx), which
      // only fires once React has mounted and applied the resolved theme —
      // that is what stops the splash from ever dismissing onto a
      // not-yet-themed WebView frame.
      launchAutoHide: false,
      androidScaleType: 'CENTER',
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
