/**
 * Android dialog theme: every Alert (confirm delete, pay now, mark as sent, discard changes…) is a
 * native AlertDialog. Left alone it is the grey stock dialog; this gives it the app's surface colours,
 * 16 dp rounded corners, its text colours and blue action words, in light and in dark
 * (values-night follows the app's own Light / Dark choice through Appearance.setColorScheme).
 */
const fs = require('fs');
const path = require('path');
const { withAndroidStyles, withDangerousMod } = require('expo/config-plugins');

// The same values as src/theme/tokens.ts (surface3, text, textMuted, primary/fill).
const LIGHT = { surface: '#FFFFFF', text: '#101828', muted: '#475467', accent: '#1D4ED8' };
const DARK = { surface: '#1F293B', text: '#EDF1F7', muted: '#A3AEC2', accent: '#7AA2FF' };

const colors = (c) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="bm_dialog_surface">${c.surface}</color>
  <color name="bm_dialog_text">${c.text}</color>
  <color name="bm_dialog_muted">${c.muted}</color>
  <color name="bm_dialog_accent">${c.accent}</color>
</resources>
`;

// Rounded card, inset from the screen edges like a Material dialog.
const BACKGROUND = `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android"
  android:insetLeft="24dp" android:insetRight="24dp" android:insetTop="24dp" android:insetBottom="24dp">
  <shape android:shape="rectangle">
    <corners android:radius="16dp" />
    <solid android:color="@color/bm_dialog_surface" />
  </shape>
</inset>
`;

function withResourceFiles(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const res = path.join(cfg.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res');
      for (const [dir, body] of [
        ['values', colors(LIGHT)],
        ['values-night', colors(DARK)],
      ]) {
        fs.mkdirSync(path.join(res, dir), { recursive: true });
        fs.writeFileSync(path.join(res, dir, 'bm_dialog_colors.xml'), body);
      }
      fs.mkdirSync(path.join(res, 'drawable'), { recursive: true });
      fs.writeFileSync(path.join(res, 'drawable', 'bm_dialog_bg.xml'), BACKGROUND);
      return cfg;
    },
  ]);
}

function setItem(style, name, value) {
  style.item = (style.item ?? []).filter((i) => i.$.name !== name);
  style.item.push({ $: { name }, _: value });
}

function withStyles(config) {
  return withAndroidStyles(config, (cfg) => {
    const styles = cfg.modResults.resources.style ?? [];
    let dialog = styles.find((s) => s.$.name === 'BluemoonAlert');
    if (!dialog) {
      dialog = { $: { name: 'BluemoonAlert', parent: 'Theme.AppCompat.DayNight.Dialog.Alert' }, item: [] };
      styles.push(dialog);
    }
    setItem(dialog, 'android:windowBackground', '@drawable/bm_dialog_bg');
    setItem(dialog, 'colorAccent', '@color/bm_dialog_accent');
    setItem(dialog, 'android:textColorPrimary', '@color/bm_dialog_text');
    setItem(dialog, 'android:textColorSecondary', '@color/bm_dialog_muted');
    setItem(dialog, 'android:textColor', '@color/bm_dialog_text');
    // sentence-case buttons ("Keep editing"), not the stock ALL CAPS
    setItem(dialog, 'buttonBarButtonStyle', '@style/BluemoonAlertButton');

    let button = styles.find((s) => s.$.name === 'BluemoonAlertButton');
    if (!button) {
      button = { $: { name: 'BluemoonAlertButton', parent: 'Widget.AppCompat.Button.ButtonBar.AlertDialog' }, item: [] };
      styles.push(button);
    }
    setItem(button, 'android:textAllCaps', 'false');
    setItem(button, 'android:textColor', '@color/bm_dialog_accent');
    setItem(button, 'android:textStyle', 'bold');

    const app = styles.find((s) => s.$.name === 'AppTheme');
    if (app) {
      setItem(app, 'alertDialogTheme', '@style/BluemoonAlert');
      setItem(app, 'android:alertDialogTheme', '@style/BluemoonAlert');
    }
    cfg.modResults.resources.style = styles;
    return cfg;
  });
}

module.exports = function withDialogTheme(config) {
  return withStyles(withResourceFiles(config));
};
