export const KEY_HOLD_MS = 400;

export interface KeyHold {
  readonly active: () => boolean;
  readonly cancel: () => void;
}

/**
 * Follows the key press that just started, telling a tap from a hold. The first key
 * release ends it: macOS sends no keyup for a letter let go while Command is down, only
 * for Command. Another key press, or the window losing focus, makes it a tap.
 */
export function followKeyHold(handlers: {
  readonly onHold?: (() => void) | undefined;
  readonly onHeldRelease: () => void;
}): KeyHold {
  let held = false;
  let done = false;
  const timer = window.setTimeout(() => {
    held = true;
    handlers.onHold?.();
  }, KEY_HOLD_MS);
  const end = () => {
    if (done) return;
    done = true;
    window.clearTimeout(timer);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("blur", end);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!event.repeat) end();
  };
  const onKeyUp = () => {
    end();
    if (held) handlers.onHeldRelease();
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("blur", end);
  return { active: () => !done, cancel: end };
}
