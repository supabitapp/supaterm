import { type RefObject, useEffect } from "react";

const ESCAPE_OWNERS = '[role="dialog"], [role="menu"], [role="listbox"], [aria-activedescendant]';

/**
 * Listens in the capture phase: the focused editor would otherwise take Escape itself, to close
 * a comment form or mark it handled. Escape in a menu, dialog, or suggestion list still belongs
 * to it, unless it holds `recordingInto`, as a popover around a comment field does.
 */
export function useDiscardOnEscape(
  active: boolean,
  discard: () => void,
  recordingInto: RefObject<HTMLElement | null>,
) {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- holds a capture-phase window Escape listener while a recording is open
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      const owner = event.target instanceof Element ? event.target.closest(ESCAPE_OWNERS) : null;
      if (owner && !owner.contains(recordingInto.current)) return;
      event.preventDefault();
      event.stopPropagation();
      discard();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, discard, recordingInto]);
}
