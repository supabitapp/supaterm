import { useRef, type RefObject } from "react";

type PointerPresence = "active" | "idle";

// Written to the DOM rather than React state so pointer moves never re-render.
export function usePointerIdle(targetRef: RefObject<HTMLElement | null>, idleAfterMs: number) {
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPresence = (presence: PointerPresence | null) => {
    const target = targetRef.current;
    if (!target || target.dataset.pointer === presence) return;
    if (presence === null) {
      delete target.dataset.pointer;
    } else {
      target.dataset.pointer = presence;
    }
  };

  const cancelIdleTimer = () => {
    if (idleTimer.current === null) return;
    clearTimeout(idleTimer.current);
    idleTimer.current = null;
  };

  return {
    onPointerMove: () => {
      cancelIdleTimer();
      setPresence("active");
      idleTimer.current = setTimeout(() => {
        idleTimer.current = null;
        setPresence("idle");
      }, idleAfterMs);
    },
    onPointerLeave: () => {
      cancelIdleTimer();
      setPresence(null);
    },
  };
}
