import { resolveVoiceTranscriptionSource } from "@supaterm/client-runtime/state/transcription";

import { voiceLanguageName } from "./voiceLanguage";

export type VoiceTranscriptionEngine = "environment" | "device";

export type VoiceEngine = {
  readonly kind: VoiceTranscriptionEngine;
  /** Names who transcribes while recording, such as "Claude · English" or "This iPhone". */
  readonly label: string;
};

export type VoiceEngineResolution =
  | { readonly status: "ready"; readonly engine: VoiceEngine }
  | {
      readonly status: "unavailable";
      readonly message: string;
      /** This device could transcribe instead, if the user chooses it. */
      readonly offersDevice: boolean;
    };

/**
 * Follows only the user's choice. An environment that can't transcribe is reported, never
 * swapped for the device, and the device is never swapped for an environment.
 */
export function resolveVoiceEngine(input: {
  readonly preference: VoiceTranscriptionEngine | undefined;
  /** Null where on-device transcription isn't supported. */
  readonly deviceName: string | null;
  /** Null until the environment's config arrives; recording can still queue for it. */
  readonly serverConfig: Parameters<typeof resolveVoiceTranscriptionSource>[0] | null;
  readonly language: string;
}): VoiceEngineResolution {
  if (input.preference === "device") {
    return input.deviceName === null
      ? {
          status: "unavailable",
          message:
            "This device can't transcribe voice input. Choose Environment in Voice input settings.",
          offersDevice: false,
        }
      : { status: "ready", engine: { kind: "device", label: input.deviceName } };
  }
  const languageName = voiceLanguageName(input.language);
  if (input.serverConfig === null) {
    return { status: "ready", engine: { kind: "environment", label: languageName } };
  }
  const source = resolveVoiceTranscriptionSource(input.serverConfig);
  if (source.status === "unavailable") {
    return {
      status: "unavailable",
      message: source.message,
      offersDevice: input.deviceName !== null,
    };
  }
  const providerName = source.provider.displayName ?? source.provider.instanceId;
  return {
    status: "ready",
    engine: { kind: "environment", label: `${providerName} · ${languageName}` },
  };
}
