import type { VoiceHoldToTalkKey } from "@supaterm/contracts";
import { type RefObject, useEffect } from "react";

import { useStableCallback } from "../hooks/useStableCallback";
import { isMacPlatform } from "../lib/utils";
import type { KeyHold, KeyHoldHandlers } from "./keyHold";

export function holdToTalkKeyLabel(key: VoiceHoldToTalkKey): string | null {
  if (key === "off") return null;
  if (key === "space") return "Space";
  return isMacPlatform(navigator.platform) ? "⌥" : "Alt";
}

export interface ComposerDraft {
  readonly text: string;
  readonly selection: { readonly start: number; readonly end: number };
}

export interface HoldToTalk {
  readonly canStart: () => boolean;
  readonly readDraft: () => ComposerDraft;
  readonly restoreDraft: (draft: ComposerDraft) => void;
  /** The microphone is still opening, as at the permission prompt. */
  readonly opening: () => boolean;
  readonly start: () => void;
  /** Stops and reviews or sends; a microphone still opening keeps recording. */
  readonly finish: () => void;
  readonly cancel: () => void;
  readonly followPress: (code: string, handlers: KeyHoldHandlers) => KeyHold;
}

function withSpaceTyped({ text, selection }: ComposerDraft): string {
  return `${text.slice(0, selection.start)} ${text.slice(selection.start)}`;
}

/**
 * Alt types nothing, so a held Alt records right away, and a chord such as Option+Left, or
 * letting go before the microphone opens, takes it back. Space types as usual, so taps never
 * wait on it; once held, its repeats are swallowed and the space it typed is taken back out.
 */
export function useHoldToTalk(
  target: RefObject<HTMLElement | null>,
  key: VoiceHoldToTalkKey,
  handlers: HoldToTalk,
) {
  const canStart = useStableCallback(handlers.canStart);
  const readDraft = useStableCallback(handlers.readDraft);
  const restoreDraft = useStableCallback(handlers.restoreDraft);
  const opening = useStableCallback(handlers.opening);
  const start = useStableCallback(handlers.start);
  const finish = useStableCallback(handlers.finish);
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
      press = followPress(event.code, {
        onHold: start,
        onHeldRelease: (release) => {
          // Releasing a lone Alt opens the menu bar on Windows and Linux unless the page consumes it.
          release.preventDefault();
          if (opening()) cancel();
          else finish();
        },
        onHeldChord: cancel,
      });
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
      press = followPress(event.code, {
        onHold: () => {
          if (readDraft().text === withSpaceTyped(before)) restoreDraft(before);
          start();
        },
        onHeldRelease: finish,
      });
    };
    const onKeyDown = key === "alt" ? onAltDown : onSpaceDown;
    element.addEventListener("keydown", onKeyDown);
    return () => {
      element.removeEventListener("keydown", onKeyDown);
      press?.cancel();
    };
  }, [target, key, canStart, readDraft, restoreDraft, opening, start, finish, cancel, followPress]);
}
