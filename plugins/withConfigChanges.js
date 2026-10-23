/**
 * Keep the app running through display-size, text-size and fold changes.
 *
 * Android rebuilds an activity for any configuration change it does not list in android:configChanges. Expo
 * lists orientation, screen size, locale and night mode, but not `density` or `fontScale`, so changing the
 * phone's display size or font size (or some foldables and DeX) recreated the activity. The new React root
 * then came up while the router still belonged to the old one, and every tap that navigated failed with
 * "The imperative router is unavailable before the first render has finished". React Native already
 * re-lays out on these changes by itself (useWindowDimensions, PixelRatio.getFontScale), so the activity
 * only has to be told to stay.
 */
const { withAndroidManifest, AndroidConfig } = require('expo/config-plugins');

const NEEDED = ['density', 'fontScale', 'smallestScreenSize', 'screenSize', 'screenLayout', 'orientation', 'keyboard', 'keyboardHidden', 'uiMode', 'locale', 'layoutDirection'];

module.exports = function withConfigChanges(config) {
  return withAndroidManifest(config, (cfg) => {
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(cfg.modResults);
    const have = new Set(String(main.$['android:configChanges'] ?? '').split('|').filter(Boolean));
    for (const c of NEEDED) have.add(c);
    main.$['android:configChanges'] = [...have].join('|');
    return cfg;
  });
};
