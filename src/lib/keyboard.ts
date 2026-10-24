import { Alert, Keyboard, TextInput } from 'react-native';

let installed = false;
let movedAt = 0;

/** Called just before Next moves focus to another field: the keyboard hide that may follow is not "put away". */
export function noteFocusMove() {
  movedAt = Date.now();
}

/**
 * App-wide keyboard manners, installed once at start:
 * - every Alert (confirm delete, pay now, discard…) closes the keyboard first, so the dialog is never shown
 *   over a keypad and the keypad never pops back after it;
 * - when the keyboard is put away (Back, the keypad's own button), the field it belonged to loses focus too,
 *   so its blue focus edge does not stay lit on a field nobody is typing in. Only the field that had focus
 *   when the keyboard went away is let go, and only if it still has focus a moment later: Next into a field
 *   with another keypad (numbers → letters, plain → password) hides and re-shows the keyboard, and the new
 *   field must keep its focus (blurring it made Android put the cursor back in the first field).
 */
export function installKeyboardHygiene() {
  if (installed) return;
  installed = true;
  const alert = Alert.alert.bind(Alert);
  Alert.alert = (...args: Parameters<typeof Alert.alert>) => {
    Keyboard.dismiss();
    alert(...args);
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  Keyboard.addListener('keyboardDidShow', () => clearTimeout(pending));
  Keyboard.addListener('keyboardDidHide', () => {
    const was = TextInput.State.currentlyFocusedInput?.();
    if (!was || Date.now() - movedAt < 1000) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      if (Keyboard.isVisible() || Date.now() - movedAt < 1000) return;
      if (TextInput.State.currentlyFocusedInput?.() === was) TextInput.State.blurTextInput(was);
    }, 450);
  });
}
