export const KEY_HOLD_MS = 400;

export interface KeyHold {
  readonly active: () => boolean;
  readonly cancel: () => void;
}

export interface KeyHoldHandlers {
  readonly onHold?: (() => void) | undefined;
  readonly onHeldRelease: (event: KeyboardEvent) => void;
  readonly onHeldChord?: (() => void) | undefined;
}

/**
 * Tells a tap from a hold of the key at `code`. The first key release ends it: macOS sends no
 * keyup for a letter let go while Command is down. Any other key, even a repeat, or losing focus
 * makes it a tap; once held, those or a click make a modifier hold a chord (`onHeldChord`).
 */
export function followKeyHold(code: string, handlers: KeyHoldHandlers): KeyHold {
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
    window.removeEventListener("pointerdown", interrupt, true);
    window.removeEventListener("blur", interrupt);
  };
  const interrupt = () => {
    if (done) return;
    end();
    if (held) handlers.onHeldChord?.();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat && event.code === code) return;
    interrupt();
  };
  const onKeyUp = (event: KeyboardEvent) => {
    end();
    if (held) handlers.onHeldRelease(event);
  };
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  if (handlers.onHeldChord) window.addEventListener("pointerdown", interrupt, true);
  window.addEventListener("blur", interrupt);
  return { active: () => !done, cancel: end };
}
