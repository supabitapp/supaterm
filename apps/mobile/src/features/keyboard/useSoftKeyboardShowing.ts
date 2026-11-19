import { useSyncExternalStore } from "react";
import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";

let keyboardShowing = KeyboardController.isVisible();
function subscribeKeyboardShowing(onChange: () => void) {
  keyboardShowing = KeyboardController.isVisible();
  const willShow = KeyboardEvents.addListener("keyboardWillShow", () => {
    keyboardShowing = true;
    onChange();
  });
  const willHide = KeyboardEvents.addListener("keyboardWillHide", () => {
    keyboardShowing = false;
    onChange();
  });
  return () => {
    willShow.remove();
    willHide.remove();
  };
}
const getKeyboardShowing = () => keyboardShowing;

export function useSoftKeyboardShowing() {
  return useSyncExternalStore(subscribeKeyboardShowing, getKeyboardShowing);
}
