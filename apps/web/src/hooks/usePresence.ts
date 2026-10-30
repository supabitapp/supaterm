import { useEffect, useRef, useState } from "react";

import { animationsSettled } from "~/lib/motion";

/**
 * Keeps the last non-null `value` rendered while its element plays an exit
 * transition. Spread `props` on that element: it carries `data-ending-style`
 * while exiting, matching Base UI popups, and `data-enter` when the value
 * arrived after mount, so `data-enter:starting:` styles never replay on first
 * paint. Unmount waits for the element's own animations, so `transition: none`
 * unmounts immediately.
 */
export function usePresence<T>(value: T | null | undefined) {
  const live = value ?? null;
  const [retained, setRetained] = useState(live);
  const [animateEnter, setAnimateEnter] = useState(live === null);
  if (live !== null && !Object.is(live, retained)) setRetained(live);
  const exiting = live === null && retained !== null;
  const elementRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!exiting) return;
    let cancelled = false;
    const element = elementRef.current;
    void (element ? animationsSettled(element) : Promise.resolve()).then(() => {
      if (cancelled) return;
      setRetained(null);
      setAnimateEnter(true);
    });
    return () => {
      cancelled = true;
    };
  }, [exiting]);

  const ref = (node: HTMLElement | null) => {
    elementRef.current = node;
  };

  return {
    value: live ?? retained,
    exiting,
    props: {
      ref,
      "data-ending-style": exiting ? "" : undefined,
      "data-enter": animateEnter ? "" : undefined,
    },
  } as const;
}
