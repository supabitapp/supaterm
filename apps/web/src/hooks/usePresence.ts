import { useEffect, useRef, useState } from "react";

import { animationsSettled } from "~/lib/motion";

/** Retains exiting content until its DOM animations finish; enter styles skip the first paint. */
export function usePresence<T>(value: T | null | undefined) {
  const live = value ?? null;
  const [retained, setRetained] = useState(live);
  const [animateEnter, setAnimateEnter] = useState(live === null);
  if (live !== null && !Object.is(live, retained)) setRetained(live);
  const exiting = live === null && retained !== null;
  const elementRef = useRef<HTMLElement | null>(null);

  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- Waits for the exiting DOM element's animations before releasing its content.
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
