import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { dictationReachableEnvironmentsAtom } from "../../state/dictation";
import {
  planPendingVoiceRecordingRuns,
  type PendingVoiceRecording,
} from "./pendingVoiceRecordingModel";
import {
  isPendingVoiceRecordingRunning,
  transcribePendingVoiceRecording,
} from "./pendingVoiceRecordingRunner";
import {
  getPendingVoiceRecordings,
  loadPendingVoiceRecordings,
  useAllPendingVoiceRecordings,
} from "./pendingVoiceRecordings";

/** Retries saved recordings when their environment is reachable again. */
export function PendingVoiceRecordingsCoordinator() {
  const recordings = useAllPendingVoiceRecordings();
  const reachable = useAtomValue(dictationReachableEnvironmentsAtom);
  useEffect(() => {
    void loadPendingVoiceRecordings();
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (current: ReadonlyArray<PendingVoiceRecording>) => {
      const { due, nextRetryAt } = planPendingVoiceRecordingRuns({
        recordings: current,
        reachable,
        isRunning: isPendingVoiceRecordingRunning,
        now: Date.now(),
      });
      for (const id of due) void transcribePendingVoiceRecording(id);
      if (nextRetryAt === null) return;
      timer = setTimeout(
        () => run(getPendingVoiceRecordings()),
        Math.max(0, nextRetryAt - Date.now()),
      );
    };
    run(recordings);
    return () => clearTimeout(timer);
  }, [recordings, reachable]);
  return null;
}
