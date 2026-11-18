import type { ComposerHandleRef } from "../../composerHandleContext";
import { useStableCallback } from "../../hooks/useStableCallback";

// Kept out of ChatView: a compiler-memoized closure there pins its render's scope, which pins the
// previous render's, so every thread copy ChatView showed stayed alive until it unmounted.
export function useComposerFocus(composerRef: ComposerHandleRef, isPaneInputOwner: () => boolean) {
  // Focus moving into a pane makes it the focused pane, so a pane in the background never takes it.
  const focusComposer = useStableCallback(() => {
    if (!isPaneInputOwner()) return;
    composerRef.current?.focusAtEnd();
  });
  const scheduleComposerFocus = useStableCallback(() => {
    window.requestAnimationFrame(() => focusComposer());
  });
  return { focusComposer, scheduleComposerFocus };
}
