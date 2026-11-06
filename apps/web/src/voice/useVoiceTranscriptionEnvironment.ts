import { useAtomValue } from "@effect/atom-react";
import { AuthOrchestrationOperateScope, type EnvironmentId } from "@supaterm/contracts";
import type { VoiceTranscriptionEnvironment } from "@supaterm/contracts/settings";

import { useClientSettings } from "../hooks/useSettings";
import { usePrimaryEnvironmentId } from "../state/environments";
import { useEnvironmentScope } from "../state/session";
import { threadOutboxDeliverableAtom } from "../state/threadOutbox";
import { useVoiceTranscriptionSource } from "../state/transcription";

const selectPreference = (settings: {
  readonly voiceTranscriptionEnvironment: VoiceTranscriptionEnvironment;
}) => settings.voiceTranscriptionEnvironment;

export function chooseVoiceTranscriptionEnvironment(input: {
  readonly preference: VoiceTranscriptionEnvironment;
  readonly threadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
  readonly primaryCanTranscribe: boolean;
}): EnvironmentId {
  switch (input.preference.kind) {
    case "thread":
      return input.threadEnvironmentId;
    case "environment":
      return input.preference.environmentId;
    case "auto":
      return input.primaryEnvironmentId !== null && input.primaryCanTranscribe
        ? input.primaryEnvironmentId
        : input.threadEnvironmentId;
  }
}

/**
 * The environment that transcribes voice input started from a thread on `threadEnvironmentId`.
 * Automatic prefers the environment the app runs from, usually this machine, whenever it is
 * reachable and can transcribe, and otherwise stays with the thread's own environment.
 */
export function useVoiceTranscriptionEnvironment(
  threadEnvironmentId: EnvironmentId,
): EnvironmentId {
  const preference = useClientSettings(selectPreference);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const candidate = primaryEnvironmentId ?? threadEnvironmentId;
  const source = useVoiceTranscriptionSource(candidate);
  const reachable = useAtomValue(threadOutboxDeliverableAtom(candidate));
  const operable = useEnvironmentScope(candidate, AuthOrchestrationOperateScope);
  return chooseVoiceTranscriptionEnvironment({
    preference,
    threadEnvironmentId,
    primaryEnvironmentId,
    primaryCanTranscribe: source?.status === "ready" && reachable && operable,
  });
}
