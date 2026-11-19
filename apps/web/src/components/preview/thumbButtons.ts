import type { MouseEvent as ReactMouseEvent } from "react";

const isThumbButton = (event: ReactMouseEvent) => event.button === 3 || event.button === 4;

export function preventThumbButtonFocus(event: ReactMouseEvent) {
  if (isThumbButton(event)) event.preventDefault();
}

export function takeThumbButtonNavigation(
  event: ReactMouseEvent,
  navigate: ((direction: "back" | "forward") => void) | undefined,
) {
  if (!isThumbButton(event) || event.defaultPrevented) return;
  event.preventDefault();
  navigate?.(event.button === 3 ? "back" : "forward");
}
