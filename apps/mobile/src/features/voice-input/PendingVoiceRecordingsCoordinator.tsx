import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { dictationReachableEnvironmentsAtom } from "../../state/dictation";
import { savedVoiceRecordings } from "./pendingVoiceRecordings";
import { voiceRecordingRunner } from "./transcribeVoiceRecording";

/** Transcribes saved recordings while their environment is reachable. */
export function PendingVoiceRecordingsCoordinator() {
  const reachable = useAtomValue(dictationReachableEnvironmentsAtom);
  useEffect(() => {
    void savedVoiceRecordings.load();
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      clearTimeout(timer);
      const { due, nextRetryAt } = voiceRecordingRunner.plan(reachable);
      for (const id of due) void voiceRecordingRunner.run(id);
      if (nextRetryAt !== null) timer = setTimeout(run, Math.max(0, nextRetryAt - Date.now()));
    };
    run();
    const unsubscribe = savedVoiceRecordings.subscribe(run);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [reachable]);
  return null;
}
