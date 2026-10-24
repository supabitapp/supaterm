import {
  resolveDictationRoute,
  type DictationAvailability,
  type DictationEnvironmentState,
  type DictationRouting,
} from "@supaterm/client-runtime/state/dictation";
import type { EnvironmentId } from "@supaterm/contracts";

export type VoiceRecordingFormat = {
  readonly encoding: "aac" | "pcm";
  readonly extension: "m4a" | "mp4" | "wav";
  readonly mimeType: "audio/mp4" | "audio/wav";
};

const AAC_M4A: VoiceRecordingFormat = { encoding: "aac", extension: "m4a", mimeType: "audio/mp4" };
const AAC_MP4: VoiceRecordingFormat = { encoding: "aac", extension: "mp4", mimeType: "audio/mp4" };
const PCM_WAV: VoiceRecordingFormat = { encoding: "pcm", extension: "wav", mimeType: "audio/wav" };

/**
 * The server checks the upload's extension against the source, so the file has to be named in
 * a format the source lists. Compressed audio is preferred; 16 kHz PCM is ~1.9 MB a minute.
 */
export function resolveVoiceRecordingFormat(
  audioFormats: ReadonlyArray<string>,
  pcmCapture: boolean,
): VoiceRecordingFormat | null {
  if (audioFormats.includes("m4a")) return AAC_M4A;
  if (audioFormats.includes("mp4")) return AAC_MP4;
  return pcmCapture && audioFormats.includes("wav") ? PCM_WAV : null;
}

export const DEVICE_RECORDING_FORMAT = AAC_M4A;

type AvailableDictation = Extract<DictationAvailability, { readonly kind: "available" }>;

export type VoiceRoute =
  | { readonly kind: "device" }
  | Exclude<DictationAvailability, AvailableDictation>
  | (AvailableDictation & { readonly format: VoiceRecordingFormat });

export type VoiceEnvironmentRoute = Extract<VoiceRoute, { readonly kind: "available" }>;

export const UNSUPPORTED_RECORDING_REASON =
  "This account can't transcribe recordings made on this device. Choose another account.";

export function resolveVoiceRoute(input: {
  readonly onDevice: boolean;
  readonly routing: DictationRouting;
  readonly environmentId: EnvironmentId | null;
  readonly stateFor: (environmentId: EnvironmentId) => DictationEnvironmentState;
  readonly pcmCapture: boolean;
}): VoiceRoute {
  if (input.onDevice) return { kind: "device" };
  const draftEnvironmentId =
    input.environmentId ?? (input.routing.mode === "pinned" ? input.routing.environmentId : null);
  if (draftEnvironmentId === null) return { kind: "hidden", reason: "unknown" };
  const route = resolveDictationRoute({
    routing: input.routing,
    draftEnvironmentId,
    localEnvironmentId: null,
    stateFor: input.stateFor,
    captureSupported: true,
  });
  if (route.kind !== "available") return route;
  const format = resolveVoiceRecordingFormat(route.source.audioFormats, input.pcmCapture);
  return format === null
    ? {
        kind: "unavailable",
        environmentId: route.environmentId,
        source: { ...route.source, unavailableReason: UNSUPPORTED_RECORDING_REASON },
      }
    : { ...route, format };
}
