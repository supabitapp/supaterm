import { NodeHttpServer } from "@effect/platform-node";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  AttachmentCreateUploadUrlResult,
  EnvironmentId,
  ProviderInstanceId,
  TranscriptionError,
  TranscriptionTranscribeResult,
} from "@supaterm/contracts";
import type { ProviderInstance } from "@supaterm/provider-core/server/driver";
import type { ProviderTranscription } from "@supaterm/provider-core/server/transcription";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
} from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ServerConfig from "../config.ts";
import { layerAttachmentUploadRoute } from "../http.ts";
import { mcpToolSession } from "../mcp/AcpMcpStdioBridge.ts";
import * as McpHttpServer from "../mcp/McpHttpServer.ts";
import type * as McpInvocationContext from "../mcp/McpInvocationContext.ts";
import * as McpPendingUploads from "../mcp/McpPendingUploads.ts";
import * as McpSessionRegistry from "../mcp/McpSessionRegistry.ts";
import * as McpToolAccessTestkit from "../mcp/McpToolAccess.testkit.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Transcription from "../transcription/Transcription.ts";
import { CliServerUnreachableError, makeServerTools, type ServerTools } from "./serverTools.ts";
import { transcribeRecording } from "./transcribe.ts";

const PROVIDER = ProviderInstanceId.make("codex");
const TOKEN = "transcribe-cli-session";

const wav = (durationMs: number) => {
  const dataBytes = (durationMs / 1000) * 16_000 * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16_000, 24);
  bytes.writeUInt32LE(32_000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return new Uint8Array(bytes);
};

const cliScope: McpInvocationContext.McpInvocationScope = {
  environmentId: EnvironmentId.make("transcribe-cli-environment"),
  requestNamespace: `client:${TOKEN}`,
  thread: undefined,
  client: { sessionId: TOKEN, label: "supaterm transcribe cli", access: "full-access" },
  capabilities: new Set(["orchestration"]),
  issuedAt: 0,
};

/**
 * The running server as the CLI meets it: real HTTP, the real MCP transport,
 * attachment and transcription tools, the signed upload route, and the real
 * Transcription service. Only the provider's vendor call is faked.
 */
const withServer = <A, E, R>(
  transcribe: ProviderTranscription["transcribe"],
  run: (input: {
    readonly tools: ServerTools;
    readonly uploadsLeft: Effect.Effect<ReadonlyArray<string>>;
  }) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const instance = {
      instanceId: PROVIDER,
      driverKind: "codex",
      enabled: true,
      transcription: {
        acceptsKeyterms: false,
        supportsLanguage: () => true,
        transcribe,
      } satisfies ProviderTranscription,
      snapshot: {
        getSnapshot: Effect.succeed({ instanceId: PROVIDER, transcription: { status: "ready" } }),
      },
    } as unknown as ProviderInstance;
    const server = Layer.mergeAll(
      McpHttpServer.layerAttachmentToolkit,
      McpHttpServer.layerTranscriptionToolkit,
      layerAttachmentUploadRoute,
    ).pipe(
      Layer.provide(McpPendingUploads.layer),
      Layer.provideMerge(McpHttpServer.layerMcpTransport),
      Layer.provide(
        Layer.mock(McpSessionRegistry.McpSessionRegistry)({
          resolve: () => Effect.succeed(undefined),
        }),
      ),
      Layer.provide(
        Layer.succeed(McpHttpServer.McpClientAuthenticator, {
          authenticate: (request) =>
            Effect.succeed(
              request.headers.authorization === `Bearer ${TOKEN}` ? cliScope : undefined,
            ),
        }),
      ),
      Layer.provide(McpToolAccessTestkit.liveThreadsLayer),
      Layer.provide(
        Transcription.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
                getInstance: (instanceId) =>
                  Effect.succeed(instanceId === PROVIDER ? instance : undefined),
              }),
              Layer.mock(ProviderRegistry.ProviderRegistry)({}),
              Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
              Layer.mock(ProjectService.ProjectService)({}),
            ),
          ),
        ),
      ),
    );
    yield* HttpRouter.serve(server, { disableListenLog: true, disableLogger: true }).pipe(
      Layer.build,
    );
    const origin = yield* HttpServer.addressFormattedWith((url) => Effect.succeed(url));
    const session = yield* mcpToolSession({
      endpoint: `${origin}/mcp`,
      authorization: `Bearer ${TOKEN}`,
      clientName: "supaterm-transcribe-cli",
    });
    const fileSystem = yield* FileSystem.FileSystem;
    const uploadsLeft = fileSystem.readDirectory(config.attachmentsDir, { recursive: true }).pipe(
      Effect.map((entries) => entries.filter((entry) => entry.endsWith(".wav"))),
      Effect.orElseSucceed(() => []),
    );
    return yield* run({ tools: makeServerTools(session, origin), uploadsLeft });
  }).pipe(
    Effect.scoped,
    Effect.provide(
      Layer.mergeAll(
        NodeHttpServer.layerTest,
        FetchHttpClient.layer,
        ServerSecretStore.layer.pipe(
          Layer.provideMerge(
            ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-transcribe-cli-" }),
          ),
          Layer.provideMerge(NodeServices.layer),
        ),
      ),
    ),
  );

it.effect("transcribes a recording through the running server and leaves no upload", () =>
  withServer(
    ({ audio }) => Effect.succeed({ text: `heard ${audio.durationMs} ms` }),
    Effect.fn(function* ({ tools, uploadsLeft }) {
      const result = yield* transcribeRecording(tools, wav(1_000), {
        providerInstanceId: PROVIDER,
      });

      assert.deepStrictEqual(result, { text: "heard 1000 ms" });
      assert.deepStrictEqual(yield* uploadsLeft, []);
    }),
  ),
);

it.effect("a refused recording reports why and leaves no upload", () =>
  withServer(
    () => Effect.fail(new TranscriptionError({ reason: "signedOut" })),
    Effect.fn(function* ({ tools, uploadsLeft }) {
      const error = yield* transcribeRecording(tools, wav(1_000), {
        providerInstanceId: PROVIDER,
      }).pipe(Effect.flip);

      assert.strictEqual(error.message, "Sign in to this provider again to transcribe.");
      assert.deepStrictEqual(yield* uploadsLeft, []);
    }),
  ),
);

// The server's run outlives the request, so stopping the command must stop it
// too or the account keeps paying for a transcript nobody reads.
it.effect("stopping the command stops the vendor call and deletes the upload", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const stopped = yield* Deferred.make<void>();
    return yield* withServer(
      () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(stopped, undefined)),
        ),
      Effect.fn(function* ({ tools, uploadsLeft }) {
        const command = yield* transcribeRecording(tools, wav(1_000), {
          providerInstanceId: PROVIDER,
        }).pipe(Effect.forkChild);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(command);

        assert.isTrue(yield* Deferred.isDone(stopped));
        assert.deepStrictEqual(yield* uploadsLeft, []);
      }),
    );
  }),
);

it.effect("after cancelling, the caller hears the recording is gone", () =>
  withServer(
    () => Effect.succeed({ text: "never reached" }),
    Effect.fn(function* ({ tools }) {
      const { attachmentId } = yield* tools.call(
        "supaterm_attachment_prepare_upload",
        { upload: { type: "file", name: "recording.wav", mimeType: "audio/wav", sizeBytes: 44 } },
        AttachmentCreateUploadUrlResult,
      );
      yield* tools.call(
        "supaterm_transcription_cancel",
        { audioAttachmentId: attachmentId },
        Schema.Struct({}),
      );

      const error = yield* tools
        .call(
          "supaterm_transcription_transcribe",
          { providerInstanceId: PROVIDER, audioAttachmentId: attachmentId },
          TranscriptionTranscribeResult,
        )
        .pipe(Effect.flip);

      assert.strictEqual(error.message, "The recording is no longer available. Record it again.");
    }),
  ),
);

// Cancelling drops the recorded outcome, so a lost response must not cancel a
// run the account already paid for.
it.effect("a lost response picks up the same run instead of cancelling it", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const calls: Array<string> = [];
    const call = ((tool: string) =>
      Effect.suspend((): Effect.Effect<unknown, CliServerUnreachableError> => {
        calls.push(tool);
        if (tool === "supaterm_attachment_prepare_upload") {
          return Effect.succeed({ attachmentId: "pending-1.wav", relativeUrl: "/u", expiresAt: 0 });
        }
        return attempts++ === 0
          ? Effect.fail(
              new CliServerUnreachableError({
                origin: "http://127.0.0.1:1",
                cause: new Error("socket hang up"),
              }),
            )
          : Effect.succeed({ text: "already transcribed" });
      })) as ServerTools["call"];
    const tools = { origin: "http://127.0.0.1:1", call } satisfies ServerTools;

    const result = yield* transcribeRecording(tools, wav(1_000), { providerInstanceId: PROVIDER });

    assert.deepStrictEqual(result, { text: "already transcribed" });
    assert.deepStrictEqual(calls, [
      "supaterm_attachment_prepare_upload",
      "supaterm_transcription_transcribe",
      "supaterm_transcription_transcribe",
    ]);
  }).pipe(
    Effect.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 204 }))),
        ),
      ),
    ),
  ),
);
