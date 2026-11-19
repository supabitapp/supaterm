import type { ComposerHandleRef } from "../../composerHandleContext";
import { useStableCallback } from "../../hooks/useStableCallback";

export function useComposerFocus(composerRef: ComposerHandleRef, isPaneInputOwner: () => boolean) {
  const focusComposer = useStableCallback(() => {
    if (!isPaneInputOwner()) return;
    composerRef.current?.focusAtEnd();
  });
  const scheduleComposerFocus = useStableCallback(() => {
    window.requestAnimationFrame(() => focusComposer());
  });
  return { focusComposer, scheduleComposerFocus };
}
