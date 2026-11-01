import { type RefObject, useEffect } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import type { KeyHold } from "./keyHold";

export interface ComposerDraft {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
}

export interface HoldSpaceToTalk {
  readonly canStart: () => boolean;
  readonly readDraft: () => ComposerDraft;
  readonly restoreDraft: (draft: ComposerDraft) => void;
  readonly start: () => void;
  /** Follows this key press; `onHold` runs once it is held past a tap. */
  readonly followPress: (onHold: () => void) => KeyHold;
}

function withSpaceTyped({ text, selection }: ComposerDraft): string {
  return `${text.slice(0, selection.start)} ${text.slice(selection.start)}`;
}

/**
 * Space types as usual, so taps and fast typing never wait on it. Once it is held,
 * its repeats are swallowed and the space it typed is taken back out before recording.
 */
export function useHoldSpaceToTalk(
  target: RefObject<HTMLElement | null> | null,
  handlers: HoldSpaceToTalk,
) {
  const canStart = useStableCallback(handlers.canStart);
  const readDraft = useStableCallback(handlers.readDraft);
  const restoreDraft = useStableCallback(handlers.restoreDraft);
  const start = useStableCallback(handlers.start);
  const followPress = useStableCallback(handlers.followPress);
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
      if (!canStart()) return;
      const before = readDraft();
      // A space typed over a selection can delete context chips, which restoring text can't bring back.
      if (before.selection.start !== before.selection.end) return;
      press = followPress(() => {
        if (readDraft().text === withSpaceTyped(before)) restoreDraft(before);
        start();
      });
    };
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      press?.cancel();
    };
  }, [target, canStart, readDraft, restoreDraft, start, followPress]);
}
