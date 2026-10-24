import { classifyDictationFailure } from "@supaterm/client-runtime/state/dictation-failure";
import {
  resolveParkedInsertion,
  throwIfVoiceTranscriptionAborted,
  VoiceTranscriptionError,
  type VoiceTranscriber,
} from "@supaterm/client-runtime/voice-input";

import { uuidv4 } from "../../lib/uuid";
import { readDictationReachable } from "../../state/dictation";
import { pendingVoiceRecordingAfterFailure } from "./pendingVoiceRecordingModel";
import { parkPendingVoiceRecording } from "./pendingVoiceRecordings";
import { transcribeVoiceRecording } from "./transcribeVoiceRecording";
import { voiceInputLocale } from "./voiceInputLocale";
import { readVoiceComposerTarget } from "./voiceComposerTargets";
import type { VoiceEnvironmentRoute } from "./voiceRoute";

/**
 * Transcribes on the route's environment while it is reachable. When it is not, or the attempt
 * fails, the recording is adopted as a saved recording and the controller is told it was
 * deferred, so it never deletes audio the user has not given up on.
 */
export function createServerVoiceTranscriber(input: {
  readonly route: VoiceEnvironmentRoute;
  readonly readDurationMs: () => number;
}): VoiceTranscriber {
  const { environmentId, source, format } = input.route;
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      const locale = voiceInputLocale();
      return {
        locale,
        transcribe: async (uri, { signal: transcriptionSignal, capturedDraft }) => {
          throwIfVoiceTranscriptionAborted(transcriptionSignal);
          if (!capturedDraft) {
            throw new VoiceTranscriptionError("transcription-failed", "The draft is missing.");
          }
          const id = uuidv4();
          const durationMs = input.readDurationMs();
          const park = async (
            state: Parameters<typeof parkPendingVoiceRecording>[0]["state"],
          ): Promise<never> => {
            try {
              await parkPendingVoiceRecording({
                id,
                uri,
                ownerKey: capturedDraft.ownerKey,
                environmentId,
                sourceId: source.id,
                format,
                durationMs,
                locale,
                capturedDraft,
                state,
              });
            } catch (error) {
              throw new VoiceTranscriptionError(
                "transcription-failed",
                "The recording could not be saved.",
                { cause: error },
              );
            }
            throw new VoiceTranscriptionError("deferred", "The recording was saved.");
          };

          if (!readDictationReachable(environmentId)) return park({ status: "waiting" });
          let text: string;
          try {
            ({ text } = await transcribeVoiceRecording({
              requestId: id,
              environmentId,
              sourceId: source.id,
              uri,
              extension: format.extension,
              mimeType: format.mimeType,
              durationMs,
              locale,
              signal: transcriptionSignal,
            }));
          } catch (error) {
            const failure = classifyDictationFailure(error);
            if (failure.kind === "cancelled") {
              throw new VoiceTranscriptionError("cancelled", failure.message, { cause: error });
            }
            if (failure.kind === "empty") return "";
            const state = pendingVoiceRecordingAfterFailure({ attempts: 0 }, failure, Date.now());
            return park({ ...state, status: failure.kind === "transient" ? "waiting" : "failed" });
          }
          const target = readVoiceComposerTarget(capturedDraft.ownerKey);
          const insertion = resolveParkedInsertion({
            captured: capturedDraft,
            current: target?.readDraft() ?? null,
            transcript: text,
            locale,
          });
          // The controller would drop a transcript for an edited draft; keep it for Insert.
          return insertion.kind === "ready"
            ? park({ status: "ready", transcript: text.trim() })
            : text;
        },
      };
    },
  };
}
