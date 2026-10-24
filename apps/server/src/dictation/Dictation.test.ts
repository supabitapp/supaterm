import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  DICTATION_MAX_CLIP_BYTES,
  DictationSourceId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@supaterm/contracts";
import type { ProviderInstance } from "@supaterm/provider-core/server/driver";
import {
  type ProviderTranscription,
  type TranscriptionClip,
  TranscriptionFailure,
  type TranscriptionFailureReason,
  type TranscriptionSourceDescription,
} from "@supaterm/provider-core/server/transcription";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { describe } from "vite-plus/test";

import { createAttachmentId, createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as Dictation from "./Dictation.ts";

const chatGpt: TranscriptionSourceDescription = {
  serviceLabel: "ChatGPT",
  accountLabel: "dev@example.com",
  eligible: true,
  audioFormats: ["webm", "wav"],
};

const fakeTranscription = (input: {
  readonly description: Ref.Ref<TranscriptionSourceDescription | null>;
  readonly calls?: Array<TranscriptionClip>;
  readonly result?: Effect.Effect<{ readonly text: string }, TranscriptionFailure>;
}): ProviderTranscription => ({
  kind: "codex",
  describe: Ref.get(input.description),
  transcribe: (clip) =>
    Effect.sync(() => input.calls?.push(clip)).pipe(
      Effect.andThen(input.result ?? Effect.succeed({ text: "  hello there \n" })),
    ),
});

const makeInstance = (
  id: string,
  options: {
    readonly transcription?: ProviderTranscription;
    readonly enabled?: boolean;
    readonly displayName?: string;
  } = {},
): ProviderInstance => ({
  instanceId: ProviderInstanceId.make(id),
  driverKind: ProviderDriverKind.make("codex"),
  continuationIdentity: {
    driverKind: ProviderDriverKind.make("codex"),
    continuationKey: `codex:${id}`,
  },
  displayName: options.displayName,
  enabled: options.enabled ?? true,
  snapshot: {
    getSnapshot: Effect.succeed({ displayName: "Codex" } as ServerProvider),
  } as ProviderInstance["snapshot"],
  orchestrationAdapter: {} as ProviderInstance["orchestrationAdapter"],
  textGeneration: {} as ProviderInstance["textGeneration"],
  ...(options.transcription === undefined ? {} : { transcription: options.transcription }),
});

const layerFor = (input: {
  readonly instances: ReadonlyArray<ProviderInstance>;
  readonly enabled?: boolean;
  readonly providerChanges?: PubSub.PubSub<void>;
}) => {
  const byId = new Map(input.instances.map((instance) => [instance.instanceId, instance]));
  return Dictation.layer.pipe(
    Layer.provide(
      Layer.succeed(ProviderInstanceRegistry.ProviderInstanceRegistry, {
        getInstance: (id) => Effect.succeed(byId.get(id)),
        listInstances: Effect.succeed(input.instances),
        listUnavailable: Effect.succeed([]),
        streamChanges:
          input.providerChanges === undefined
            ? Stream.empty
            : Stream.fromPubSub(input.providerChanges),
        subscribeChanges: Effect.flatMap(PubSub.unbounded<void>(), PubSub.subscribe),
      }),
    ),
    Layer.provide(
      Layer.succeed(ProviderRegistry.ProviderRegistry, {
        streamChanges: Stream.empty,
      } as unknown as ProviderRegistry.ProviderRegistry["Service"]),
    ),
    Layer.provide(
      ServerSettings.ServerSettingsService.layerTest({
        dictation: { enabled: input.enabled ?? true },
      }),
    ),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-dictation-" })),
    Layer.provideMerge(NodeServices.layer),
  );
};

const writeClip = (extension: string, options: { readonly threadId?: string } = {}) =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const attachmentId =
      options.threadId === undefined
        ? createPendingAttachmentId(extension)
        : createAttachmentId(options.threadId, extension)!;
    const filePath = path.join(config.attachmentsDir, `${attachmentId}.${extension}`);
    yield* fileSystem.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* fileSystem.writeFile(filePath, new Uint8Array([1, 2, 3]));
    return { attachmentId, filePath, exists: fileSystem.exists(filePath) };
  });

const request = (attachmentId: string, sourceId = "codex:work", durationMs = 4_000) => ({
  attachmentId,
  sourceId: DictationSourceId.make(sourceId),
  durationMs,
});

describe("Dictation.sources", () => {
  it.effect("lists eligible and ineligible sources by id and skips the rest", () =>
    Effect.gen(function* () {
      const eligible = yield* Ref.make<TranscriptionSourceDescription | null>(chatGpt);
      const managed = yield* Ref.make<TranscriptionSourceDescription | null>({
        serviceLabel: "ChatGPT",
        accountLabel: null,
        eligible: false,
        unavailableReason: "This sign-in method can't transcribe.",
        audioFormats: [],
      });
      const hidden = yield* Ref.make<TranscriptionSourceDescription | null>(null);
      const dictation = yield* Dictation.Dictation.pipe(
        Effect.provide(
          layerFor({
            instances: [
              makeInstance("work", {
                transcription: fakeTranscription({ description: eligible }),
                displayName: "Work",
              }),
              makeInstance("managed", {
                transcription: fakeTranscription({ description: managed }),
              }),
              makeInstance("off", {
                transcription: fakeTranscription({ description: eligible }),
                enabled: false,
              }),
              makeInstance("quiet", { transcription: fakeTranscription({ description: hidden }) }),
              makeInstance("claude"),
            ],
          }),
        ),
      );
      expect(yield* dictation.sources).toEqual([
        {
          id: "codex:managed",
          kind: "codex",
          runsOn: "environment",
          label: "Codex",
          serviceLabel: "ChatGPT",
          accountLabel: null,
          providerInstanceId: "managed",
          eligible: false,
          unavailableReason: "This sign-in method can't transcribe.",
          audioFormats: [],
        },
        {
          id: "codex:work",
          kind: "codex",
          runsOn: "environment",
          label: "Work",
          serviceLabel: "ChatGPT",
          accountLabel: "dev@example.com",
          providerInstanceId: "work",
          eligible: true,
          audioFormats: ["webm", "wav"],
        },
      ]);
    }),
  );

  it.effect("re-emits the catalog when a transcription changes a source's eligibility", () =>
    Effect.gen(function* () {
      const description = yield* Ref.make<TranscriptionSourceDescription | null>(chatGpt);
      const transcription = fakeTranscription({
        description,
        result: Ref.set(description, {
          ...chatGpt,
          eligible: false,
          unavailableReason: "Paused.",
        }).pipe(
          Effect.andThen(
            Effect.fail(new TranscriptionFailure({ reason: { _tag: "endpointRejected" } })),
          ),
        ),
      });
      yield* Effect.gen(function* () {
        const dictation = yield* Dictation.Dictation;
        const next = yield* dictation.streamSources.pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        const { attachmentId } = yield* writeClip("webm");
        yield* dictation.transcribe(request(attachmentId)).pipe(Effect.flip);
        yield* TestClock.adjust("1 second");
        const [sources] = yield* Fiber.join(next);
        expect(sources?.map((source) => [source.id, source.eligible])).toEqual([
          ["codex:work", false],
        ]);
      }).pipe(Effect.provide(layerFor({ instances: [makeInstance("work", { transcription })] })));
    }),
  );
});

describe("Dictation.transcribe", () => {
  const withWork = <A, E>(
    body: (context: {
      readonly calls: Array<TranscriptionClip>;
      readonly dictation: Dictation.Dictation["Service"];
    }) => Effect.Effect<A, E, ServerConfig.ServerConfig | FileSystem.FileSystem | Path.Path>,
    options: {
      readonly enabled?: boolean;
      readonly result?: Effect.Effect<{ readonly text: string }, TranscriptionFailure>;
      readonly extra?: ReadonlyArray<ProviderInstance>;
      readonly description?: TranscriptionSourceDescription;
    } = {},
  ) =>
    Effect.gen(function* () {
      const calls: Array<TranscriptionClip> = [];
      const description = yield* Ref.make<TranscriptionSourceDescription | null>(
        options.description ?? chatGpt,
      );
      const work = makeInstance("work", {
        transcription: fakeTranscription({
          description,
          calls,
          ...(options.result === undefined ? {} : { result: options.result }),
        }),
      });
      return yield* Effect.gen(function* () {
        const dictation = yield* Dictation.Dictation;
        return yield* body({ calls, dictation });
      }).pipe(
        Effect.provide(
          layerFor({
            instances: [work, ...(options.extra ?? [])],
            ...(options.enabled === undefined ? {} : { enabled: options.enabled }),
          }),
        ),
      );
    });

  it.effect("transcribes the pending clip with the resolved source and then deletes it", () =>
    withWork(({ calls, dictation }) =>
      Effect.gen(function* () {
        const clip = yield* writeClip("webm");
        const result = yield* dictation.transcribe({
          ...request(clip.attachmentId),
          language: "en-US",
        });
        expect(result).toEqual({ text: "hello there", sourceId: "codex:work" });
        expect(calls).toEqual([
          {
            filePath: clip.filePath,
            fileName: "dictation.webm",
            mimeType: "audio/webm",
            language: "en-US",
          },
        ]);
        expect(yield* clip.exists).toBe(false);
      }),
    ),
  );

  it.effect("re-resolves the client's pick against the sources it can verify", () =>
    Effect.gen(function* () {
      const other = yield* Ref.make<TranscriptionSourceDescription | null>(chatGpt);
      const otherCalls: Array<TranscriptionClip> = [];
      yield* withWork(
        ({ calls, dictation }) =>
          Effect.gen(function* () {
            const clip = yield* writeClip("webm");
            const result = yield* dictation.transcribe(request(clip.attachmentId));
            expect(result.sourceId).toBe("codex:other");
            expect(calls).toEqual([]);
            expect(otherCalls).toHaveLength(1);
          }),
        {
          description: { ...chatGpt, eligible: false, unavailableReason: "Signed out." },
          extra: [
            makeInstance("other", {
              transcription: fakeTranscription({ description: other, calls: otherCalls }),
            }),
          ],
        },
      );
    }),
  );

  it.effect("refuses when dictation is off and still deletes the clip", () =>
    withWork(
      ({ calls, dictation }) =>
        Effect.gen(function* () {
          const clip = yield* writeClip("webm");
          const error = yield* dictation.transcribe(request(clip.attachmentId)).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DictationUnavailableError", reason: "disabled" });
          expect(calls).toEqual([]);
          expect(yield* clip.exists).toBe(false);
        }),
      { enabled: false },
    ),
  );

  it.effect("tells an unknown source from an ineligible one when nothing can transcribe", () =>
    withWork(
      ({ dictation }) =>
        Effect.gen(function* () {
          const first = yield* writeClip("webm");
          expect(
            yield* dictation.transcribe(request(first.attachmentId)).pipe(Effect.flip),
          ).toMatchObject({ reason: "source-ineligible" });
          const second = yield* writeClip("webm");
          expect(
            yield* dictation
              .transcribe(request(second.attachmentId, "codex:gone"))
              .pipe(Effect.flip),
          ).toMatchObject({ reason: "unknown-source" });
          expect(yield* second.exists).toBe(false);
        }),
      { description: { ...chatGpt, eligible: false, unavailableReason: "Signed out." } },
    ),
  );

  it.effect("only reads clips from the pending segment and leaves thread attachments alone", () =>
    withWork(({ calls, dictation }) =>
      Effect.gen(function* () {
        const clip = yield* writeClip("webm", { threadId: "thread-1" });
        expect(
          yield* dictation.transcribe(request(clip.attachmentId)).pipe(Effect.flip),
        ).toMatchObject({ _tag: "DictationClipError", problem: "missing" });
        expect(calls).toEqual([]);
        expect(yield* clip.exists).toBe(true);
      }),
    ),
  );

  it.effect("rejects formats the source or dictation does not accept", () =>
    withWork(({ calls, dictation }) =>
      Effect.gen(function* () {
        for (const extension of ["ogg", "mp3"]) {
          const clip = yield* writeClip(extension);
          expect(
            yield* dictation.transcribe(request(clip.attachmentId)).pipe(Effect.flip),
          ).toMatchObject({ problem: "unsupported-format" });
          expect(yield* clip.exists).toBe(false);
        }
        expect(calls).toEqual([]);
      }),
    ),
  );

  it.effect("enforces duration and size limits independently", () =>
    withWork(({ calls, dictation }) =>
      Effect.gen(function* () {
        const short = yield* writeClip("webm");
        expect(
          yield* dictation
            .transcribe(request(short.attachmentId, "codex:work", 100))
            .pipe(Effect.flip),
        ).toMatchObject({ problem: "too-short" });
        const long = yield* writeClip("webm");
        expect(
          yield* dictation
            .transcribe(request(long.attachmentId, "codex:work", 10 * 60_000))
            .pipe(Effect.flip),
        ).toMatchObject({ problem: "too-long" });
        const large = yield* writeClip("webm");
        const fileSystem = yield* FileSystem.FileSystem;
        yield* fileSystem.truncate(large.filePath, DICTATION_MAX_CLIP_BYTES + 1);
        expect(
          yield* dictation.transcribe(request(large.attachmentId)).pipe(Effect.flip),
        ).toMatchObject({ problem: "too-large" });
        expect(yield* large.exists).toBe(false);
        expect(calls).toEqual([]);
      }),
    ),
  );

  it.effect.each<{
    readonly reason: TranscriptionFailureReason;
    readonly expected: Record<string, unknown>;
  }>([
    { reason: { _tag: "auth" }, expected: { _tag: "DictationAuthError", sourceId: "codex:work" } },
    {
      reason: { _tag: "rateLimited", retryAfterSeconds: 30 },
      expected: { _tag: "DictationRateLimitedError", retryAfterSeconds: 30 },
    },
    {
      reason: { _tag: "upstream", category: "server", status: 503 },
      expected: { _tag: "DictationUpstreamError", category: "server", status: 503 },
    },
    {
      reason: { _tag: "endpointRejected" },
      expected: { _tag: "DictationUnavailableError", reason: "endpoint-rejected" },
    },
    {
      reason: { _tag: "ineligible", reason: "Can't." },
      expected: { _tag: "DictationUnavailableError", reason: "source-ineligible" },
    },
    {
      reason: { _tag: "invalidAudio" },
      expected: { _tag: "DictationClipError", problem: "unsupported-format" },
    },
  ])("maps a $reason._tag failure and deletes the clip", ({ reason, expected }) =>
    withWork(
      ({ dictation }) =>
        Effect.gen(function* () {
          const clip = yield* writeClip("webm");
          expect(
            yield* dictation.transcribe(request(clip.attachmentId)).pipe(Effect.flip),
          ).toMatchObject(expected);
          expect(yield* clip.exists).toBe(false);
        }),
      { result: Effect.fail(new TranscriptionFailure({ reason })) },
    ),
  );
});
