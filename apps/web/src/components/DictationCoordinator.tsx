import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useEffect, useSyncExternalStore } from "react";

import { isPendingClipRunning, transcribePendingClip } from "../dictation/pendingClipRunner";
import {
  getPendingClips,
  loadPendingClips,
  subscribePendingClips,
} from "../dictation/pendingClips";
import { dictationAvailability } from "../state/dictation";
import { environmentPresentations } from "../state/presentation";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";

const dictationReadyAtom = Atom.make((get): ReadonlySet<string> => {
  const ready = new Set<string>();
  for (const environmentId of get(environmentPresentations.presentationsAtom).keys()) {
    const offered = get(dictationAvailability.environmentStateAtom(environmentId)).status;
    if (offered === "offered" && get(threadOutboxDeliverableAtom(environmentId))) {
      ready.add(environmentId);
    }
  }
  const previous = Option.getOrNull(get.self<ReadonlySet<string>>());
  return previous !== null &&
    previous.size === ready.size &&
    [...ready].every((environmentId) => previous.has(environmentId))
    ? previous
    : ready;
});

export function DictationCoordinator() {
  const ready = useAtomValue(dictationReadyAtom);
  const clips = useSyncExternalStore(subscribePendingClips, getPendingClips);
  useEffect(() => {
    void loadPendingClips();
  }, []);
  useEffect(() => {
    let nextRetryAt = Number.POSITIVE_INFINITY;
    const now = Date.now();
    for (const clip of clips) {
      if (
        (clip.status !== "waiting" && clip.status !== "transcribing") ||
        !ready.has(clip.environmentId)
      )
        continue;
      if (isPendingClipRunning(clip.id)) continue;
      if (clip.retryAt > now) {
        nextRetryAt = Math.min(nextRetryAt, clip.retryAt);
        continue;
      }
      void transcribePendingClip(clip.id);
    }
    if (!Number.isFinite(nextRetryAt)) return;
    const timer = window.setTimeout(
      () => {
        for (const clip of getPendingClips()) {
          if (
            (clip.status === "waiting" || clip.status === "transcribing") &&
            clip.retryAt <= Date.now() &&
            ready.has(clip.environmentId) &&
            !isPendingClipRunning(clip.id)
          ) {
            void transcribePendingClip(clip.id);
          }
        }
      },
      Math.max(0, nextRetryAt - now),
    );
    return () => window.clearTimeout(timer);
  }, [clips, ready]);
  return null;
}
