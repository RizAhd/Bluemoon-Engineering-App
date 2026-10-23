/**
 * expo-sharing keeps the promise of the last share until Android reports that the chooser closed. Some phones
 * never report it — MIUI's "direct share" straight into Drive's upload screen, a share left with Home, the app
 * killed in the background — and from then on every share in the app failed with "Another share request is
 * being processed now" until the app was restarted (estimates could not be sent).
 *
 * At prebuild this patches the module's Kotlin source: a new share first settles the stuck one (as finished)
 * and then goes ahead, so the person tapping Share always gets the chooser. Applied once; a newer
 * expo-sharing that has changed this code is left alone and the build log says so.
 */
const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('expo/config-plugins');

const STUCK = `      if (pendingPromise != null) {
        throw SharingInProgressException()
      }`;
const FIXED = `      // Bluemoon patch: a share whose result never came back must not block every later share.
      pendingPromise?.resolve(null)
      pendingPromise = null`;

module.exports = function withSharingFix(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      let file;
      try {
        const pkg = require.resolve('expo-sharing/package.json', { paths: [cfg.modRequest.projectRoot] });
        file = path.join(path.dirname(pkg), 'android', 'src', 'main', 'java', 'expo', 'modules', 'sharing', 'SharingModule.kt');
      } catch {
        return cfg;
      }
      const src = fs.readFileSync(file, 'utf8');
      if (src.includes(FIXED)) return cfg;
      if (!src.includes(STUCK)) {
        console.warn('[withSharingFix] expo-sharing has changed; the stuck-share patch was not applied.');
        return cfg;
      }
      fs.writeFileSync(file, src.replace(STUCK, FIXED));
      return cfg;
    },
  ]);
};
