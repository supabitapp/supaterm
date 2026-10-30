import { useCanGoBack, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

import { registerCommands } from "../shortcuts/dispatcher";
import { useStableCallback } from "./useStableCallback";

export function useEscapeToGoBack(onEscape?: () => void) {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const handleEscape = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || event.isComposing || event.key !== "Escape")
      return false;
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (onEscape) onEscape();
    else if (canGoBack) router.history.back();
    else void router.navigate({ to: "/" });
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- registers the current page's Escape action with the shared keyboard dispatcher
  useEffect(() => registerCommands({}, { onKeyDown: handleEscape }), [handleEscape]);
}
