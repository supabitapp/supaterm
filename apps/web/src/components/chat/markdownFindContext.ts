import { createContext } from "react";

export const MarkdownFindContext = createContext(false);

/**
 * Find dispatches `beforematch` on hidden or clipped ancestors of the selected
 * match, like the browser's own find-in-page. Callers create the ref during render
 * from a stable `onReveal`, so the compiler caches it and React attaches it once.
 */
export function findRevealRef(onReveal: () => void) {
  return (element: HTMLElement | null) => {
    if (!element) return;
    element.addEventListener("beforematch", onReveal);
    return () => element.removeEventListener("beforematch", onReveal);
  };
}
