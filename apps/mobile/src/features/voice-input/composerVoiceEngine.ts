import { resolveVoiceTranscriptionSource } from "@supaterm/client-runtime/state/transcription";
import type { EnvironmentId, ProjectId, ThreadId } from "@supaterm/contracts";

import * as Dialog from "../../components/ui/Dialog";
import { systemVoiceLanguage } from "../../lib/voiceLanguage";
import { appAtomRegistry } from "../../state/atom-registry";
import { serverEnvironment } from "../../state/server";
import { createEnvironmentVoiceTranscriber } from "../../state/transcription";
import type { VoiceInputEngine } from "./voiceInputSession";

export type VoiceTranscriptionContext = {
  readonly threadId?: ThreadId;
  readonly projectId?: ProjectId;
};

type ComposerVoiceEngineResolution =
  | { readonly status: "ready"; readonly engine: VoiceInputEngine }
  | { readonly status: "unavailable"; readonly message: string };

/**
 * Read when recording starts, so a settings change never re-renders every composer. An
 * environment whose config hasn't arrived still records, so the turn can queue for it.
 */
export function resolveComposerVoiceEngine(input: {
  readonly environmentId: EnvironmentId | null;
  readonly context?: VoiceTranscriptionContext;
}): ComposerVoiceEngineResolution {
  const { environmentId } = input;
  if (environmentId === null) {
    return { status: "unavailable", message: "Choose an environment to transcribe voice input." };
  }
  const config = appAtomRegistry.get(serverEnvironment.configValueAtom(environmentId));
  const source = config === null ? null : resolveVoiceTranscriptionSource(config);
  if (source?.status === "unavailable") return { status: "unavailable", message: source.message };
  const language = systemVoiceLanguage();
  const transcriber = createEnvironmentVoiceTranscriber({
    environmentId,
    language,
    ...(input.context ? { context: input.context } : {}),
  });
  return { status: "ready", engine: { transcriber, language } };
}

export function presentUnavailableVoiceEngine(message: string): void {
  Dialog.alert("Voice input unavailable", message);
}
