import type { KeyboardEvent } from "react";

/** Safari reports the Enter that confirms an IME candidate as not composing, with keyCode 229. */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
