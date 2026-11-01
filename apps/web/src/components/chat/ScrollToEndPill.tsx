import { ChevronDownIcon } from "@supaterm/icons";
import { useLayoutEffect, useRef } from "react";

import { usePresence } from "~/hooks/usePresence";
import { runningSizeAnimation } from "~/lib/motion";
import { Button } from "../ui/button";

export function ScrollToEndPill({
  show,
  bottom,
  composerOverlay,
  onScrollToEnd,
}: {
  show: boolean;
  bottom: number;
  composerOverlay: HTMLElement | null;
  onScrollToEnd: () => void;
}) {
  const presence = usePresence(show ? true : null);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef<{ bottom: number; animation: Animation | null }>({
    bottom,
    animation: null,
  });
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- the composer starts its height animation in a microtask after publishing its destination, so the pill holds its old position until it can share that animation's timing
  useLayoutEffect(() => {
    const follow = followRef.current;
    const shift = bottom - follow.bottom;
    follow.bottom = bottom;
    const element = elementRef.current;
    if (!element || shift === 0) return;
    const animatedTop = element.getBoundingClientRect().top;
    follow.animation?.cancel();
    const offset = shift + animatedTop - element.getBoundingClientRect().top;
    const keyframes = [{ transform: `translateY(${String(offset)}px)` }, { transform: "none" }];
    const hold = element.animate(keyframes, { duration: 1 });
    hold.pause();
    follow.animation = hold;
    queueMicrotask(() => {
      if (follow.animation !== hold) return;
      hold.cancel();
      follow.animation = null;
      const surface = composerOverlay?.querySelector('[data-chat-composer-main-surface="true"]');
      const composerAnimation = surface ? runningSizeAnimation(surface) : undefined;
      const timing = composerAnimation?.effect?.getTiming();
      if (!composerAnimation || !timing) return;
      const animation = element.animate(keyframes, { ...timing, fill: "none" });
      if (composerAnimation.startTime !== null) animation.startTime = composerAnimation.startTime;
      follow.animation = animation;
    });
  }, [bottom, composerOverlay]);
  if (!presence.value) return null;
  return (
    <div
      {...presence.props}
      ref={(node) => {
        presence.props.ref(node);
        elementRef.current = node;
      }}
      inert={presence.exiting}
      className="chat-scroll-to-bottom pointer-events-none absolute z-30 flex justify-center py-1.5 transition-[translate,scale] duration-200 ease-drawer data-enter:starting:translate-y-1 data-enter:starting:scale-95 data-ending-style:translate-y-1 data-ending-style:scale-95 data-ending-style:duration-150 data-ending-style:ease-in motion-reduce:transition-none"
      style={{ bottom }}
    >
      <Button
        aria-label="Scroll to end"
        onPointerDown={(event) => event.preventDefault()}
        onClick={onScrollToEnd}
        className="pointer-events-auto"
        size="xs"
        variant="glass"
      >
        <ChevronDownIcon className="size-3.5" />
        Scroll to end
      </Button>
    </div>
  );
}
