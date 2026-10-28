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

const withTranscription = (transcribe: Transcription.Transcription["Service"]["transcribe"]) =>
  McpHttpServer.layerTranscriptionToolkit.pipe(
    Layer.provideMerge(McpServer.McpServer.layer),
    Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
    Layer.provide(Layer.mock(Transcription.Transcription)({ transcribe })),
  );

const callTranscribe = (args: Record<string, unknown>) =>
  McpServer.McpServer.pipe(
    Effect.flatMap((server) =>
      server.callTool({
        name: "supaterm_transcription_transcribe",
        arguments: {
          providerInstanceId: "claudeAgent",
          audioAttachmentId: "pending-recording.wav",
          ...args,
        },
      }),
    ),
    Effect.provideService(McpInvocationContext.McpInvocationContext, scope),
    Effect.provideService(McpSchema.McpServerClient, client),
  );

it.effect("a thread's recording is biased toward that thread unless it names other context", () => {
  const received: Array<TranscriptionTranscribeInput> = [];
  return Effect.gen(function* () {
    const projectId = ProjectId.make("named-project");
    yield* callTranscribe({});
    yield* callTranscribe({ context: { projectId } });

    expect(received.map((input) => input.context)).toEqual([{ threadId }, { projectId }]);
  }).pipe(
    Effect.provide(
      withTranscription((input) =>
        Effect.sync(() => {
          received.push(input);
          return { text: "hello" };
        }),
      ),
    ),
  );
});

it.effect("a rate-limited account tells the agent when to try again", () =>
  Effect.gen(function* () {
    const result = yield* callTranscribe({});

    expect(declaredFailure(result)).toEqual({
      _tag: "OrchestratorMcpFailure",
      code: "provider_unavailable",
      message: "Transcription is rate limited. Try again soon. Retry after 5 s.",
    });
  }).pipe(
    Effect.provide(
      withTranscription(() =>
        Effect.fail(new TranscriptionError({ reason: "rateLimited", retryAfterMs: 4_200 })),
      ),
    ),
  ),
);
