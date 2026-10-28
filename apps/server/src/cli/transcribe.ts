import {
  AttachmentCreateUploadUrlResult,
  ProviderInstanceId,
  ThreadId,
  TranscriptionTranscribeResult,
  type TranscriptionTranscribeInput,
} from "@supaterm/contracts";
import { parseWav } from "@supaterm/provider-core/server/transcription";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Runtime from "effect/Runtime";
import * as Schema from "effect/Schema";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import { projectLocationFlags } from "./config.ts";
import {
  CliServerUnreachableError,
  reportExpectedErrors,
  resolveProject,
  type ServerTools,
  ServerToolsErrors,
  withServerTools,
} from "./serverTools.ts";

export class TranscribeUsageError extends Schema.TaggedError<TranscribeUsageError>()(
  "TranscribeUsageError",
  { detail: Schema.String },
) {
  override readonly [Runtime.errorReported] = false;
  override get message(): string {
    return this.detail;
  }
}

const reportTranscribeErrors = reportExpectedErrors(
  Schema.is(Schema.Union([...ServerToolsErrors, TranscribeUsageError])),
);

const decodeThreadId = Schema.decodeUnknownEffect(ThreadId);
const decodeProviderInstanceId = Schema.decodeUnknownEffect(ProviderInstanceId);

/**
 * A refused or interrupted run leaves the upload behind and may still be
 * spending the account, so anything short of a transcript cancels it.
 */
export const transcribeRecording = Effect.fn("cli.transcribe.recording")(function* (
  tools: ServerTools,
  audio: Uint8Array,
  input: Omit<TranscriptionTranscribeInput, "audioAttachmentId" | "retry">,
) {
  const upload = yield* tools.call(
    "supaterm_attachment_prepare_upload",
    {
      upload: {
        type: "file",
        name: "recording.wav",
        mimeType: "audio/wav",
        sizeBytes: audio.byteLength,
      },
    },
    AttachmentCreateUploadUrlResult,
  );
  const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
  const cancel = tools
    .call(
      "supaterm_transcription_cancel",
      { audioAttachmentId: upload.attachmentId },
      Schema.Struct({}),
    )
    .pipe(Effect.ignore);
  return yield* Effect.gen(function* () {
    yield* client
      .execute(
        HttpClientRequest.post(new URL(upload.relativeUrl, tools.origin).href).pipe(
          HttpClientRequest.bodyUint8Array(audio, "audio/wav"),
        ),
      )
      .pipe(
        Effect.mapError((cause) => new CliServerUnreachableError({ origin: tools.origin, cause })),
      );
    return yield* tools.call(
      "supaterm_transcription_transcribe",
      { ...input, audioAttachmentId: upload.attachmentId },
      TranscriptionTranscribeResult,
    );
  }).pipe(Effect.onError(() => cancel));
});

export const transcribeCommand = Command.make("transcribe", {
  ...projectLocationFlags,
  recording: Argument.File("recording", { mustExist: true }).pipe(
    Argument.withDescription("A 16 kHz mono 16-bit WAV file of at most 5 minutes."),
  ),
  provider: Flag.String("provider").pipe(
    Flag.withDescription(
      "Provider instance whose login transcribes, such as codex or claudeAgent. Its account is charged.",
    ),
  ),
  language: Flag.String("language").pipe(
    Flag.withDescription(
      "Spoken language as a BCP 47 tag, such as en. Defaults to the provider's.",
    ),
    Flag.optional,
  ),
  project: Flag.String("project").pipe(
    Flag.withDescription(
      "Project id or a path inside a project, whose names bias recognition. Claude only.",
    ),
    Flag.optional,
  ),
  thread: Flag.String("thread").pipe(
    Flag.withDescription("Thread id whose project and branch names bias recognition. Claude only."),
    Flag.optional,
  ),
}).pipe(
  Command.withDescription(
    "Transcribe a recording with a provider's own login on the running server.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const audio = yield* fileSystem.readFile(flags.recording);
      if (parseWav(audio) === null) {
        return yield* new TranscribeUsageError({
          detail: `${flags.recording} is not a 16 kHz mono 16-bit WAV file. Convert it with: ffmpeg -i <input> -ar 16000 -ac 1 -c:a pcm_s16le out.wav`,
        });
      }
      const providerInstanceId = yield* decodeProviderInstanceId(flags.provider.trim()).pipe(
        Effect.mapError(
          () =>
            new TranscribeUsageError({
              detail: `'${flags.provider}' is not a provider instance id.`,
            }),
        ),
      );
      const thread = Option.getOrUndefined(flags.thread);
      const threadId =
        thread === undefined
          ? undefined
          : yield* decodeThreadId(thread.trim()).pipe(
              Effect.mapError(
                () => new TranscribeUsageError({ detail: `'${thread}' is not a thread id.` }),
              ),
            );
      const language = Option.getOrUndefined(flags.language);
      const projectIdentifier = Option.getOrUndefined(flags.project);
      yield* withServerTools(
        flags,
        { label: "supaterm transcribe cli", name: "supaterm-transcribe-cli" },
        Effect.fn("cli.transcribe")(function* (tools) {
          const project =
            projectIdentifier === undefined
              ? undefined
              : yield* resolveProject(tools, projectIdentifier);
          const { text } = yield* transcribeRecording(tools, audio, {
            providerInstanceId,
            ...(language && { language }),
            context: {
              ...(project && { projectId: project.id }),
              ...(threadId && { threadId }),
            },
          });
          yield* Console.log(text);
        }),
      );
    }).pipe(reportTranscribeErrors, Effect.provide(FetchHttpClient.layer)),
  ),
);
