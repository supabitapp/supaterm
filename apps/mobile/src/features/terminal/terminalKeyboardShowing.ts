import { KeyboardController, KeyboardEvents } from "react-native-keyboard-controller";

const subscribers = new Set<() => void>();
let showEpoch = 1;
let keyboardShowing = KeyboardController.isVisible();
let hiddenSinceShow = !keyboardShowing;

const notify = () => {
  for (const subscriber of subscribers) subscriber();
};
const show = () => {
  if (hiddenSinceShow) showEpoch += 1;
  hiddenSinceShow = false;
  keyboardShowing = true;
  notify();
};
KeyboardEvents.addListener("keyboardWillShow", show);
KeyboardEvents.addListener("keyboardDidShow", show);
KeyboardEvents.addListener("keyboardWillHide", () => {
  keyboardShowing = false;
  hiddenSinceShow = true;
  notify();
});
KeyboardEvents.addListener("keyboardDidHide", () => {
  hiddenSinceShow = true;
});

export function subscribeKeyboardShowing(onChange: () => void) {
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
  };
}

export const getKeyboardShowEpoch = () => (keyboardShowing ? showEpoch : 0);
