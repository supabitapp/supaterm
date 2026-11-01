import { type RefObject, useEffect } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { followKeyHold, type KeyHold } from "./keyHold";

export interface HoldSpaceToTalk<Draft> {
  /** The draft before the space types, or null to leave Space to type. */
  readonly arm: () => Draft | null;
  readonly hold: (draft: Draft) => void;
  readonly release: () => void;
}

/**
 * Space types as usual, so taps and fast typing never wait on it. Once it is held,
 * its repeats are swallowed and `hold` gets the draft from before the first space.
 */
export function useHoldSpaceToTalk<Draft>(
  target: RefObject<HTMLElement | null> | null,
  handlers: HoldSpaceToTalk<Draft>,
) {
  const arm = useStableCallback(handlers.arm);
  const hold = useStableCallback(handlers.hold);
  const release = useStableCallback(handlers.release);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- listens for Space on the composer's DOM while the setting is on
  useEffect(() => {
    const element = target?.current;
    if (!element) return;
    let press: KeyHold | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== " " ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.isComposing ||
        !(event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }
      if (event.repeat) {
        if (press?.active()) event.preventDefault();
        return;
      }
      const draft = arm();
      if (draft === null) return;
      press = followKeyHold({ onHold: () => hold(draft), onHeldRelease: release });
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      press?.cancel();
    };
  }, [target, arm, hold, release]);
}
