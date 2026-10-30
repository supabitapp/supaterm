import { useRef, useState, type RefObject } from "react";
import { KeyboardController } from "react-native-keyboard-controller";

import type { ComposerEditorHandle } from "../../components/ComposerEditor";

type PresentationPhase = "closed" | "opening" | "visible" | "restoring";

/**
 * The navigator-level UIKit completion event added by the repo's
 * `@react-navigation/native-stack` patch; absent from upstream event maps.
 */
export type NavigationWithFinishTransitioning = {
  readonly addListener: (type: "finishTransitioning", callback: () => void) => () => void;
};

const SHEET_DISMISSAL_KEYBOARD_OVERLAP_MS = 300;

const NATIVE_DISMISSAL_ECHO_WINDOW_MS = 150;

/**
 * A plain blur/focus pair costs one keyboard animation each way —
 * keepFocus-style inputView overrides are avoided because removing them forces
 * UIKit to reload input views, replaying the keyboard's show as a visible
 * collapse/re-open.
 */
export function useThreadSettingsSheetPresentation(input: {
  readonly editorRef: RefObject<ComposerEditorHandle | null>;
  /** Runs on the frame the sheet becomes visible, after the keyboard started leaving. */
  readonly onPresent: () => void;
}) {
  // Destructured so the compiler keys memoized handlers on the stable editor ref, not on
  // the fresh input object: the finishTransitioning listener re-subscribes on every change.
  const { editorRef, onPresent } = input;
  const [phase, setPhase] = useState<PresentationPhase>("closed");
  const isActiveRef = useRef(false);
  // Written by the editor's focus handlers; read when restoring focus after dismissal.
  const isEditorFocusedRef = useRef(false);
  const openingIdRef = useRef(0);
  const focusRestoreIdRef = useRef(0);
  const restoreFocusAfterDismissRef = useRef(false);
  const restorePendingRef = useRef(false);
  const lastStackTransitionFinishedAtRef = useRef(0);
  const dismissRestoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearDismissRestoreTimer = () => {
    if (dismissRestoreTimerRef.current !== null) {
      clearTimeout(dismissRestoreTimerRef.current);
      dismissRestoreTimerRef.current = null;
    }
  };

  const open = () => {
    if (isActiveRef.current) {
      return;
    }

    isActiveRef.current = true;
    focusRestoreIdRef.current += 1;
    clearDismissRestoreTimer();
    restorePendingRef.current = false;
    restoreFocusAfterDismissRef.current =
      phase === "restoring" || isEditorFocusedRef.current || KeyboardController.isVisible();
    setPhase("opening");

    const openingId = openingIdRef.current + 1;
    openingIdRef.current = openingId;

    // Start the keyboard transition before the custom native editor resigns
    // first responder, then present the sheet on the next frame. The sheet and
    // keyboard animate together instead of serializing two native transitions.
    void KeyboardController.dismiss({ animated: true });
    editorRef.current?.blur();

    requestAnimationFrame(() => {
      // A composer unmounted during the frame takes its editor with it; present nothing.
      if (
        !isActiveRef.current ||
        openingIdRef.current !== openingId ||
        editorRef.current === null
      ) {
        return;
      }
      setPhase("visible");
      onPresent();
    });
  };

  const restoreEditorFocus = () => {
    const focusRestoreId = focusRestoreIdRef.current + 1;
    focusRestoreIdRef.current = focusRestoreId;
    let attemptsRemaining = 20;

    // Restoration runs after the dismissal transition, so the first attempt
    // normally succeeds; the retries are insurance against UIKit briefly
    // refusing first-responder status right at the transition boundary.
    const restoreFocus = () => {
      if (focusRestoreIdRef.current !== focusRestoreId) {
        return;
      }
      if (isEditorFocusedRef.current || attemptsRemaining <= 0) {
        setPhase("closed");
        return;
      }

      attemptsRemaining -= 1;
      editorRef.current?.focus();
      setTimeout(restoreFocus, 50);
    };
    requestAnimationFrame(restoreFocus);
  };

  const runPendingDismissalRestore = () => {
    if (!restorePendingRef.current) {
      return;
    }
    restorePendingRef.current = false;
    clearDismissRestoreTimer();
    if (isActiveRef.current) {
      return;
    }
    restoreEditorFocus();
  };

  const onDismissed = () => {
    isActiveRef.current = false;

    if (!restoreFocusAfterDismissRef.current) {
      setPhase("closed");
      return;
    }
    // Keep the card expanded across the handoff back to its editor. With a
    // hardware keyboard there is no software-keyboard travel to hide a collapse
    // while the sheet dismissal and focus restoration finish.
    setPhase("restoring");
    restoreFocusAfterDismissRef.current = false;
    restorePendingRef.current = true;
    clearDismissRestoreTimer();
    if (Date.now() - lastStackTransitionFinishedAtRef.current <= NATIVE_DISMISSAL_ECHO_WINDOW_MS) {
      runPendingDismissalRestore();
      return;
    }
    dismissRestoreTimerRef.current = setTimeout(() => {
      dismissRestoreTimerRef.current = null;
      runPendingDismissalRestore();
    }, SHEET_DISMISSAL_KEYBOARD_OVERLAP_MS);
  };

  const onStackTransitionsFinished = () => {
    lastStackTransitionFinishedAtRef.current = Date.now();
    runPendingDismissalRestore();
  };

  const onEditorFocusChange = (focused: boolean) => {
    isEditorFocusedRef.current = focused;
  };

  // Called when the composer unmounts: cancels a queued presentation frame, the
  // dismissal restore timer, and any focus-restore retries still in flight.
  const dispose = () => {
    isActiveRef.current = false;
    openingIdRef.current += 1;
    focusRestoreIdRef.current += 1;
    restorePendingRef.current = false;
    clearDismissRestoreTimer();
  };

  return {
    isActive: phase === "opening" || phase === "visible",
    keepsComposerExpanded: phase !== "closed",
    isVisible: phase === "visible",
    open,
    onEditorFocusChange,
    onDismissed,
    onStackTransitionsFinished,
    dispose,
  } as const;
}
