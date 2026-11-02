import type { VoiceHoldToTalkKey } from "@supaterm/contracts";
import { type RefObject, useEffect } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import type { KeyHold } from "./keyHold";

export interface ComposerDraft {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
}

export interface HoldToTalk {
  readonly canStart: () => boolean;
  readonly readDraft: () => ComposerDraft;
  readonly restoreDraft: (draft: ComposerDraft) => void;
  readonly start: () => void;
  readonly cancel: () => void;
  /** Follows this key press; `onHold` runs once it is held past a tap, `onHeldChord` if it then joins a chord. */
  readonly followPress: (onHold: () => void, onHeldChord?: () => void) => KeyHold;
}

function withSpaceTyped({ text, selection }: ComposerDraft): string {
  return `${text.slice(0, selection.start)} ${text.slice(selection.start)}`;
}

/**
 * Alt types nothing, so a held Alt records right away and a chord such as Option+Left
 * takes the recording back. Space types as usual, so taps and fast typing never wait on
 * it. Once it is held, its repeats are swallowed and the space it typed is taken back out.
 */
export function useHoldToTalk(
  target: RefObject<HTMLElement | null>,
  key: VoiceHoldToTalkKey,
  handlers: HoldToTalk,
) {
  const canStart = useStableCallback(handlers.canStart);
  const readDraft = useStableCallback(handlers.readDraft);
  const restoreDraft = useStableCallback(handlers.restoreDraft);
  const start = useStableCallback(handlers.start);
  const cancel = useStableCallback(handlers.cancel);
  const followPress = useStableCallback(handlers.followPress);
  // oxlint-disable-next-line supaterm/no-unreasoned-state-sync -- listens for the hold-to-talk key on the composer's DOM
  useEffect(() => {
    const element = target.current;
    if (!element || key === "off") return;
    let press: KeyHold | null = null;
    const onAltDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Alt" ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        !canStart()
      ) {
        return;
      }
      press = followPress(start, cancel);
    };
    const onSpaceDown = (event: KeyboardEvent) => {
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
    const onKeyDown = key === "alt" ? onAltDown : onSpaceDown;
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      press?.cancel();
    };
  }, [target, key, canStart, readDraft, restoreDraft, start, cancel, followPress]);
}
