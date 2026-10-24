import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@supaterm/contracts";
import * as Option from "effect/Option";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { webRecordingRunner } from "../dictation/pendingClipRunner";
import { useAllPendingClips, webRecordings } from "../dictation/pendingClips";
import { dictationAvailability } from "../state/dictation";
import { environmentPresentations } from "../state/presentation";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";

const dictationReadyAtom = Atom.make((get): ReadonlySet<EnvironmentId> => {
  const ready = new Set<EnvironmentId>();
  for (const environmentId of get(environmentPresentations.presentationsAtom).keys()) {
    const offered = get(dictationAvailability.environmentStateAtom(environmentId)).status;
    if (offered === "offered" && get(threadOutboxDeliverableAtom(environmentId))) {
      ready.add(environmentId);
    }
  }
  const previous = Option.getOrNull(get.self<ReadonlySet<EnvironmentId>>());
  return previous !== null &&
    previous.size === ready.size &&
    [...ready].every((environmentId) => previous.has(environmentId))
    ? previous
    : ready;
});

/** Transcribes saved recordings whenever their environment can take them. */
export function DictationCoordinator() {
  const ready = useAtomValue(dictationReadyAtom);
  const recordings = useAllPendingClips();
  useEffect(() => {
    void webRecordings.load();
  }, []);
  useEffect(() => {
    let timer: number | undefined;
    const run = () => {
      const { due, nextRetryAt } = webRecordingRunner.plan(ready);
      for (const id of due) void webRecordingRunner.run(id);
      for (const recording of recordings) {
        if (recording.status === "ready") void webRecordingRunner.offer(recording.id);
      }
      if (nextRetryAt !== null) {
        timer = window.setTimeout(run, Math.max(0, nextRetryAt - Date.now()));
      }
    };
    run();
    return () => window.clearTimeout(timer);
  }, [recordings, ready]);
  return null;
}
