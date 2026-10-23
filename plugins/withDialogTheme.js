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
// `fill` carries white text (date picker header, selected day): the tokens' fill colour in both schemes.
const LIGHT = { surface: '#FFFFFF', text: '#101828', muted: '#475467', accent: '#1D4ED8', fill: '#1D4ED8' };
const DARK = { surface: '#1F293B', text: '#EDF1F7', muted: '#A3AEC2', accent: '#7AA2FF', fill: '#2563EB' };

const colors = (c) => `<?xml version="1.0" encoding="utf-8"?>
<resources>
  <color name="bm_dialog_surface">${c.surface}</color>
  <color name="bm_dialog_text">${c.text}</color>
  <color name="bm_dialog_muted">${c.muted}</color>
  <color name="bm_dialog_accent">${c.accent}</color>
  <color name="bm_dialog_fill">${c.fill}</color>
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

    // The calendar (date picker) dialog: the app's blue header and selected day instead of the stock teal,
    // on the same rounded surface as the alerts.
    let picker = styles.find((s) => s.$.name === 'BluemoonDatePicker');
    if (!picker) {
      picker = { $: { name: 'BluemoonDatePicker', parent: 'Theme.AppCompat.DayNight.Dialog' }, item: [] };
      styles.push(picker);
    }
    setItem(picker, 'android:windowBackground', '@drawable/bm_dialog_bg');
    setItem(picker, 'colorAccent', '@color/bm_dialog_fill');
    setItem(picker, 'android:colorAccent', '@color/bm_dialog_fill');
    setItem(picker, 'colorPrimary', '@color/bm_dialog_fill');
    setItem(picker, 'android:textColorPrimary', '@color/bm_dialog_text');
    setItem(picker, 'android:textColorSecondary', '@color/bm_dialog_muted');
    setItem(picker, 'android:buttonBarButtonStyle', '@style/BluemoonAlertButton');
    setItem(picker, 'buttonBarButtonStyle', '@style/BluemoonAlertButton');

    const app = styles.find((s) => s.$.name === 'AppTheme');
    if (app) {
      setItem(app, 'alertDialogTheme', '@style/BluemoonAlert');
      setItem(app, 'android:alertDialogTheme', '@style/BluemoonAlert');
      setItem(app, 'android:datePickerDialogTheme', '@style/BluemoonDatePicker');
      setItem(app, 'android:timePickerDialogTheme', '@style/BluemoonDatePicker');
    }
    cfg.modResults.resources.style = styles;
    return cfg;
  });
}

module.exports = function withDialogTheme(config) {
  return withStyles(withResourceFiles(config));
};
