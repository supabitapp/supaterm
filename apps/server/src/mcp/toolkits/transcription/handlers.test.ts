import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TranscriptionError,
  type TranscriptionTranscribeInput,
} from "@supaterm/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { McpSchema, McpServer } from "effect/ai";

import * as Transcription from "../../../transcription/Transcription.ts";
import * as McpHttpServer from "../../McpHttpServer.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpPendingUploads from "../../McpPendingUploads.ts";
import * as McpToolAccessTestkit from "../../McpToolAccess.testkit.ts";

const threadId = ThreadId.make("transcribing-thread");
const scope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("mcp-transcription-environment"),
  requestNamespace: "mcp-transcription-session",
  thread: {
    threadId,
    providerSessionId: "mcp-transcription-session",
    providerInstanceId: ProviderInstanceId.make("codex"),
  },
  client: undefined,
  issuedAt: 0,
  capabilities: new Set(["orchestration"]),
};
const client = McpSchema.McpServerClient.of({
  clientId: 1,
  protocolVersion: "2025-06-18",
  clientCapabilities: {},
  clientInfo: { name: "mcp-transcription", version: "1" },
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "mcp-transcription", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const declaredFailure = (result: McpSchema.CallToolResult) => {
  const text = result.content[0];
  return result.isError === true && text?.type === "text" ? JSON.parse(text.text) : undefined;
};

const audioAttachmentId = "pending-recording.wav";
const otherCaller: McpInvocationContext.McpInvocationScope = {
  ...scope,
  requestNamespace: "other-session",
  thread: { ...scope.thread!, threadId: ThreadId.make("other-thread") },
};

const withTranscription = (service: Partial<Transcription.Transcription["Service"]>) =>
  McpHttpServer.layerTranscriptionToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provideMerge(McpPendingUploads.layer),
    Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
    Layer.provide(Layer.mock(Transcription.Transcription)(service)),
  );

const prepareUpload = McpPendingUploads.McpPendingUploads.pipe(
  Effect.flatMap((uploads) => uploads.record(audioAttachmentId)),
  Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
);

const callTool = (
  name: string,
  args: Record<string, unknown>,
  invocation: McpInvocationContext.McpInvocationScope = scope,
) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) => server.callTool({ name, arguments: args })),
    Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

const callTranscribe = (
  args: Record<string, unknown>,
  invocation?: McpInvocationContext.McpInvocationScope,
) =>
  callTool(
    "supaterm_transcription_transcribe",
    { providerInstanceId: "claudeAgent", audioAttachmentId, ...args },
    invocation,
  );

it.effect("a thread's recording is biased toward that thread unless it names other context", () => {
  const received: Array<TranscriptionTranscribeInput> = [];
  return Effect.gen(function* () {
    const projectId = ProjectId.make("named-project");
    yield* prepareUpload;
    yield* callTranscribe({});
    yield* callTranscribe({ context: { projectId } });

    expect(received.map((input) => input.context)).toEqual([{ threadId }, { projectId }]);
  }).pipe(
    Effect.provide(
      withTranscription({
        transcribe: (input) =>
          Effect.sync(() => {
            received.push(input);
            return { text: "hello" };
          }),
      }),
    ),
  );
});

it.effect("only the caller that prepared an upload can transcribe or cancel it", () => {
  const used: Array<string> = [];
  return Effect.gen(function* () {
    yield* prepareUpload;

    const transcribed = yield* callTranscribe({}, otherCaller);
    const cancelled = yield* callTool(
      "supaterm_transcription_cancel",
      { audioAttachmentId },
      otherCaller,
    );

    expect(declaredFailure(transcribed)).toMatchObject({ code: "invalid_request" });
    expect(declaredFailure(cancelled)).toMatchObject({ code: "invalid_request" });
    expect(used).toEqual([]);
  }).pipe(
    Effect.provide(
      withTranscription({
        transcribe: () =>
          Effect.sync(() => {
            used.push("transcribe");
            return { text: "someone else's words" };
          }),
        cancel: () =>
          Effect.sync(() => {
            used.push("cancel");
          }),
      }),
    ),
  );
});

it.effect("a rate-limited account tells the agent when to try again", () =>
  Effect.gen(function* () {
    yield* prepareUpload;
    const result = yield* callTranscribe({});

    expect(declaredFailure(result)).toEqual({
      _tag: "OrchestratorMcpFailure",
      code: "provider_unavailable",
      message: "Transcription is rate limited. Try again soon. Retry after 5 s.",
    });
  }).pipe(
    Effect.provide(
      withTranscription({
        transcribe: () =>
          Effect.fail(new TranscriptionError({ reason: "rateLimited", retryAfterMs: 4_200 })),
      }),
    ),
  ),
);
