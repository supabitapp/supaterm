import {
  OrchestratorMcpFailure,
  type TranscriptionError,
  type TranscriptionErrorReason,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Transcription from "../../../transcription/Transcription.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpPendingUploads from "../../McpPendingUploads.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { TranscriptionToolkit } from "./tools.ts";

const FAILURE_CODES = {
  sourceUnavailable: "provider_unavailable",
  unsupportedLogin: "provider_unavailable",
  signedOut: "provider_unavailable",
  credentialsLocked: "provider_unavailable",
  rateLimited: "provider_unavailable",
  blocked: "provider_unavailable",
  audioMissing: "invalid_request",
  invalidAudio: "invalid_request",
  audioTooShort: "invalid_request",
  audioTooLong: "invalid_request",
  unsupportedLanguage: "invalid_request",
  requestConflict: "invalid_request",
  cancelled: "orchestration_error",
  failed: "orchestration_error",
} satisfies Record<TranscriptionErrorReason, OrchestratorMcpFailure["code"]>;

const transcriptionFailure = (error: TranscriptionError) =>
  new OrchestratorMcpFailure({
    code: error.reason === undefined ? "orchestration_error" : FAILURE_CODES[error.reason],
    message:
      error.retryAfterMs === undefined
        ? error.message
        : `${error.message} Retry after ${Math.ceil(error.retryAfterMs / 1000)} s.`,
  });

export const layer = McpToolAccess.toLayer(
  TranscriptionToolkit,
  Effect.gen(function* () {
    const transcription = yield* Transcription.Transcription;
    const pendingUploads = yield* McpPendingUploads.McpPendingUploads;
    return {
      supaterm_transcription_transcribe: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          yield* pendingUploads.requireOwner(input.audioAttachmentId);
          const { thread } = yield* McpInvocationContext.McpInvocationContext;
          const context = input.context ?? (thread && { threadId: thread.threadId });
          return yield* transcription
            .transcribe({ ...input, ...(context && { context }) })
            .pipe(Effect.mapError(transcriptionFailure));
        }),
      ),
      supaterm_transcription_cancel: McpToolAccess.writes((input) =>
        Effect.gen(function* () {
          yield* pendingUploads.requireOwner(input.audioAttachmentId);
          yield* transcription.cancel(input);
          return {};
        }),
      ),
    };
  }),
);
