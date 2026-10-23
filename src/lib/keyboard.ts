import { Alert, Keyboard, TextInput } from 'react-native';

let installed = false;

/**
 * App-wide keyboard manners, installed once at start:
 * - every Alert (confirm delete, pay now, discard…) closes the keyboard first, so the dialog is never shown
 *   over a keypad and the keypad never pops back after it;
 * - when the keyboard is put away (Back, the keypad's own button), the field it belonged to loses focus too,
 *   so its blue focus edge does not stay lit on a field nobody is typing in. A short wait lets a switch
 *   between two fields (which can hide and re-show the keyboard) keep its focus.
 */
export function installKeyboardHygiene() {
  if (installed) return;
  installed = true;
  const alert = Alert.alert.bind(Alert);
  Alert.alert = (...args: Parameters<typeof Alert.alert>) => {
    Keyboard.dismiss();
    alert(...args);
  };
  Keyboard.addListener('keyboardDidHide', () => {
    setTimeout(() => {
      if (Keyboard.isVisible()) return;
      const focused = TextInput.State.currentlyFocusedInput?.();
      if (focused) TextInput.State.blurTextInput(focused);
    }, 150);
  });
}
