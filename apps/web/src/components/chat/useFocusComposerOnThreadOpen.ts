import type { ScopedThreadRef } from "@supaterm/contracts";
import { useEffect } from "react";

import { restoreFocusOnThreadEnter } from "../../lib/terminalFocus";

const ALWAYS_OWNS_FOCUS = () => true;

/** Restores thread focus, landing the caret a frame after composer entry. */
export function useFocusComposerOnThreadOpen(
  threadRef: ScopedThreadRef | null,
  root: HTMLElement | null,
  enabled: boolean,
  terminalOpen: boolean,
  focusComposer: () => void,
  ownsFocus: () => boolean = ALWAYS_OWNS_FOCUS,
) {
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- restores DOM focus on thread entry and after the drawer opens or closes
  useEffect(() => {
    if (!threadRef || !enabled || !root) return;
    let frame: number | undefined;
    const leave = restoreFocusOnThreadEnter(threadRef, {
      root,
      // Split panes each mount a chat; only the focused pane takes focus back.
      restoresFocus: ownsFocus(),
      focusComposer: () => {
        frame = window.requestAnimationFrame(() => {
          // Double-clicking a sidebar row opens its thread and its rename field in one gesture.
          if (document.activeElement?.matches("[data-sidebar-row] input")) return;
          focusComposer();
        });
      },
    });
    return () => {
      leave();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [
    threadRef,
    root,
    enabled,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Drawer visibility changes also restore focus after explicit open/close actions.
    terminalOpen,
    focusComposer,
    ownsFocus,
  ]);
}
