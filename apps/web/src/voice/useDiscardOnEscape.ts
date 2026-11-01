import { useEffect } from "react";

const ESCAPE_OWNERS = '[role="dialog"], [role="menu"], [role="listbox"], [aria-activedescendant]';

/**
 * Listens in the capture phase: the composer's editor keeps focus while recording and marks
 * Escape handled itself, so a bubbling listener would never see it. Escape inside an open
 * menu or dialog, or in a field driving a suggestion list, still belongs to that.
 */
export function useDiscardOnEscape(active: boolean, discard: () => void) {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- holds a capture-phase window Escape listener while a recording is open
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest(ESCAPE_OWNERS)) return;
      event.preventDefault();
      discard();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, discard]);
}
