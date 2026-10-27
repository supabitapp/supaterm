// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationV2ThreadShell,
  type Project,
  ProjectId,
  ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
  ThreadId,
  TranscriptionError,
} from "@supaterm/contracts";
import type { ProviderInstance } from "@supaterm/provider-core/server/driver";
import type { ProviderTranscription } from "@supaterm/provider-core/server/transcription";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";

import { createPendingAttachmentId } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderInstanceRegistry from "../provider/ProviderInstanceRegistry.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as Transcription from "./Transcription.ts";

const INSTANCE = ProviderInstanceId.make("claude_test");
const OTHER_INSTANCE = ProviderInstanceId.make("codex_test");
const THREAD = ThreadId.make("thread-1");
const PROJECT = ProjectId.make("project-1");
const TEN_MINUTES = "10 minutes";

const wav = (input: { readonly durationMs: number; readonly sampleRate?: number }) => {
  const sampleRate = input.sampleRate ?? 16_000;
  const dataBytes = Math.round((input.durationMs / 1000) * sampleRate) * 2;
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVE", 8, "ascii");
  bytes.write("fmt ", 12, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
};

const skill = (name: string, enabled = true): ServerProviderSkill => ({
  name,
  path: `/skills/${name}`,
  enabled,
});

interface BackendCall {
  readonly language: string | undefined;
  readonly keyterms: ReadonlyArray<string>;
  readonly durationMs: number;
}

const makeHarness = Effect.gen(function* () {
  const calls = yield* Ref.make<ReadonlyArray<BackendCall>>([]);
  const started = yield* Queue.unbounded<void>();
  const responses =
    yield* Queue.unbounded<Effect.Effect<{ readonly text: string }, TranscriptionError>>();
  const backend: ProviderTranscription = {
    acceptsKeyterms: true,
    supportsLanguage: (code) => code === "en" || code === "no",
    transcribe: (input) =>
      Ref.update(calls, (current) => [
        ...current,
        {
          language: input.language,
          keyterms: input.keyterms,
          durationMs: input.audio.durationMs,
        },
      ]).pipe(
        Effect.andThen(Queue.offer(started, undefined)),
        Effect.andThen(Queue.take(responses)),
        Effect.flatten,
      ),
  };
  const transcriptionStatus = yield* Ref.make<ServerProvider["transcription"]>({ status: "ready" });
  const instance = {
    instanceId: INSTANCE,
    driverKind: "claudeAgent",
    enabled: true,
    transcription: backend,
    snapshot: {
      getSnapshot: Ref.get(transcriptionStatus).pipe(
        Effect.map((transcription) => ({ instanceId: INSTANCE, transcription })),
      ),
    },
    snapshotForCwd: () => Effect.die("transcription must not probe the workspace"),
  } as unknown as ProviderInstance;
  const provider = {
    instanceId: INSTANCE,
    skills: [skill("machine")],
    workspaceSnapshots: [
      {
        cwd: "/worktrees/voice",
        checkedAt: "2026-10-27T00:00:00.000Z",
        slashCommands: [],
        skills: [
          skill("thermos"),
          skill("emil-ui-polish"),
          skill("kstack", false),
          skill("security:scan"),
        ],
      },
    ],
  } as unknown as ServerProvider;
  const shell = {
    id: THREAD,
    projectId: PROJECT,
    branch: "supaterm/voice-transcription",
    worktreePath: "/worktrees/voice",
  } as unknown as OrchestrationV2ThreadShell;
  const project = { id: PROJECT, title: "Supaterm", workspaceRoot: "/repo" } as unknown as Project;

  const layer = Transcription.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ProviderInstanceRegistry.ProviderInstanceRegistry)({
          getInstance: (instanceId) =>
            Effect.succeed(instanceId === INSTANCE ? instance : undefined),
        }),
        Layer.mock(ProviderRegistry.ProviderRegistry)({
          getProviders: Effect.succeed([provider]),
        }),
        Layer.mock(ProjectionStore.ProjectionStoreV2)({
          getThreadShell: (threadId) => Effect.succeed(threadId === THREAD ? shell : null),
        }),
        Layer.mock(ProjectService.ProjectService)({
          getById: (projectId) =>
            Effect.succeed(projectId === PROJECT ? Option.some(project) : Option.none()),
        }),
      ),
    ),
    Layer.provideMerge(
      ServerConfig.layerTest(process.cwd(), { prefix: "supaterm-transcription-" }),
    ),
    Layer.provideMerge(NodeServices.layer),
  );
  return { calls, started, responses, transcriptionStatus, layer };
});

const upload = (bytes: Buffer) =>
  Effect.gen(function* () {
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const attachmentId = createPendingAttachmentId(".wav");
    NodeFS.mkdirSync(attachmentsDir, { recursive: true });
    const path = NodePath.join(attachmentsDir, `${attachmentId}.wav`);
    NodeFS.writeFileSync(path, bytes);
    return { attachmentId, exists: () => NodeFS.existsSync(path) };
  });

const reason = <A>(effect: Effect.Effect<A, TranscriptionError>) =>
  effect.pipe(
    Effect.flip,
    Effect.map((error) => error.reason),
  );

describe("Transcription", () => {
  it.effect("joins running work, so two callers share one vendor call", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        const first = yield* Effect.forkChild(service.transcribe(input));
        yield* Queue.take(harness.started);
        const second = yield* Effect.forkChild(service.transcribe(input));
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "hello" }));

        expect(yield* Fiber.join(first)).toEqual({ text: "hello" });
        expect(yield* Fiber.join(second)).toEqual({ text: "hello" });
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
        expect(audio.exists()).toBe(false);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps working after the caller disconnects and answers the reconnect", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        const disconnected = yield* Effect.forkChild(service.transcribe(input));
        yield* Queue.take(harness.started);
        yield* Fiber.interrupt(disconnected);
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "still here" }));

        expect(yield* service.transcribe(input)).toEqual({ text: "still here" });
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("returns a failed run on recovery and runs again only on retry", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        yield* Queue.offer(
          harness.responses,
          Effect.fail(new TranscriptionError({ reason: "failed" })),
        );
        expect(yield* reason(service.transcribe(input))).toBe("failed");
        expect(yield* reason(service.transcribe(input))).toBe("failed");
        expect(
          yield* reason(service.transcribe({ ...input, providerInstanceId: OTHER_INSTANCE })),
        ).toBe("failed");
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
        expect(audio.exists()).toBe(true);

        yield* Queue.offer(harness.responses, Effect.succeed({ text: "second try" }));
        expect(yield* service.transcribe({ ...input, retry: true })).toEqual({
          text: "second try",
        });
        expect(yield* Ref.get(harness.calls)).toHaveLength(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("doesn't record a refusal that spent nothing, so a resubmission tries again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        yield* Queue.offer(
          harness.responses,
          Effect.fail(new TranscriptionError({ reason: "rateLimited", retryAfterMs: 5_000 })),
        );
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "later" }));
        expect(yield* reason(service.transcribe(input))).toBe("rateLimited");
        expect(yield* service.transcribe(input)).toEqual({ text: "later" });
        expect(yield* Ref.get(harness.calls)).toHaveLength(2);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refuses different inputs for an upload that is running or done", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        const running = yield* Effect.forkChild(service.transcribe(input));
        yield* Queue.take(harness.started);
        expect(yield* reason(service.transcribe({ ...input, language: "no" }))).toBe(
          "requestConflict",
        );
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "done" }));
        yield* Fiber.join(running);
        expect(
          yield* reason(service.transcribe({ ...input, providerInstanceId: OTHER_INSTANCE })),
        ).toBe("requestConflict");
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("forgets a success after ten minutes, when its upload is already gone", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "once" }));
        yield* service.transcribe(input);
        yield* TestClock.adjust("9 minutes");
        expect(yield* service.transcribe(input)).toEqual({ text: "once" });
        yield* TestClock.adjust("2 minutes");
        expect(yield* reason(service.transcribe(input))).toBe("audioMissing");
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("deletes the upload when a failure expires, so a late recovery can't rerun", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        yield* Queue.offer(
          harness.responses,
          Effect.fail(new TranscriptionError({ reason: "failed" })),
        );
        expect(yield* reason(service.transcribe(input))).toBe("failed");
        yield* TestClock.adjust(TEN_MINUTES);
        expect(yield* reason(service.transcribe(input))).toBe("audioMissing");
        expect(audio.exists()).toBe(false);
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("deletes an expired failure's upload even if nobody asks again", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        yield* Queue.offer(
          harness.responses,
          Effect.fail(new TranscriptionError({ reason: "failed" })),
        );
        yield* Effect.flip(
          service.transcribe({
            providerInstanceId: INSTANCE,
            audioAttachmentId: audio.attachmentId,
          }),
        );
        // The prune runs every minute, and each run schedules the next.
        const advanceMinutes = (minutes: number) =>
          Effect.forEach(Array.from({ length: minutes }), () => TestClock.adjust("1 minute"), {
            discard: true,
          });
        yield* advanceMinutes(9);
        expect(audio.exists()).toBe(true);
        yield* advanceMinutes(2);
        // The prune deletes while holding the store lock; cancelling an unrelated
        // upload waits for that lock, so it returns once the prune is done.
        yield* service.cancel({ audioAttachmentId: createPendingAttachmentId(".wav") });
        expect(audio.exists()).toBe(false);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("cancel stops the run, deletes the upload and tells joined callers", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        const waiting = yield* Effect.forkChild(service.transcribe(input));
        yield* Queue.take(harness.started);
        yield* service.cancel({ audioAttachmentId: audio.attachmentId });

        expect(yield* reason(Fiber.join(waiting))).toBe("cancelled");
        expect(audio.exists()).toBe(false);
        expect(yield* reason(service.transcribe(input))).toBe("audioMissing");
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("accepts only pending WAV uploads", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        for (const audioAttachmentId of [
          "thread_1-3f2a6c1e-7b1d-4c2e-9a3f-1b2c3d4e5f60-wav",
          createPendingAttachmentId(".png"),
          "../secrets",
        ]) {
          expect(
            yield* reason(service.transcribe({ providerInstanceId: INSTANCE, audioAttachmentId })),
          ).toBe("audioMissing");
        }
        expect(yield* Ref.get(harness.calls)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("rejects unusable audio before any vendor call and deletes it", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const cases = [
          [wav({ durationMs: 1_000, sampleRate: 8_000 }), "invalidAudio"],
          [wav({ durationMs: 200 }), "audioTooShort"],
          [wav({ durationMs: 301_000 }), "audioTooLong"],
          [Buffer.from("not audio"), "invalidAudio"],
        ] as const;
        for (const [bytes, expected] of cases) {
          const audio = yield* upload(bytes);
          expect(
            yield* reason(
              service.transcribe({
                providerInstanceId: INSTANCE,
                audioAttachmentId: audio.attachmentId,
              }),
            ),
          ).toBe(expected);
          expect(audio.exists()).toBe(false);
        }
        expect(yield* Ref.get(harness.calls)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("keeps the upload when the named source can't transcribe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        expect(
          yield* reason(
            service.transcribe({
              providerInstanceId: OTHER_INSTANCE,
              audioAttachmentId: audio.attachmentId,
            }),
          ),
        ).toBe("sourceUnavailable");
        expect(audio.exists()).toBe(true);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refuses a source whose checked login can't transcribe, before any vendor call", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        const input = { providerInstanceId: INSTANCE, audioAttachmentId: audio.attachmentId };
        yield* Ref.set(harness.transcriptionStatus, {
          status: "unavailable",
          reason: "unsupportedLogin",
        });
        expect(yield* reason(service.transcribe(input))).toBe("unsupportedLogin");

        yield* Ref.set(harness.transcriptionStatus, undefined);
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "not checked yet" }));
        expect(yield* service.transcribe({ ...input, retry: true })).toEqual({
          text: "not checked yet",
        });
        expect(yield* Ref.get(harness.calls)).toHaveLength(1);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("sends the thread's project, branch and single-word skills as keyterms", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_500 }));
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "ok" }));
        yield* service.transcribe({
          providerInstanceId: INSTANCE,
          audioAttachmentId: audio.attachmentId,
          language: "nb-NO",
          context: { threadId: THREAD },
        });

        const [call] = yield* Ref.get(harness.calls);
        expect(call?.language).toBe("no");
        expect(call?.durationMs).toBe(1_500);
        expect(call?.keyterms.slice(0, 4)).toEqual([
          "Supaterm",
          "supaterm",
          "voice",
          "transcription",
        ]);
        expect(call?.keyterms).toContain("worktree");
        expect(call?.keyterms).toContain("thermos");
        expect(call?.keyterms).not.toContain("machine");
        expect(call?.keyterms).not.toContain("kstack");
        expect(call?.keyterms.some((term) => term.includes("emil"))).toBe(false);
        expect(call?.keyterms.some((term) => term.includes("security"))).toBe(false);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refuses a language the backend can't transcribe", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const audio = yield* upload(wav({ durationMs: 1_000 }));
        expect(
          yield* reason(
            service.transcribe({
              providerInstanceId: INSTANCE,
              audioAttachmentId: audio.attachmentId,
              language: "tlh",
            }),
          ),
        ).toBe("unsupportedLanguage");
        expect(yield* Ref.get(harness.calls)).toHaveLength(0);
      }).pipe(Effect.provide(harness.layer));
    }),
  );

  it.effect("refuses new work once 64 vendor outcomes are live, until the oldest expires", () =>
    Effect.gen(function* () {
      const harness = yield* makeHarness;
      yield* Effect.gen(function* () {
        const service = yield* Transcription.Transcription;
        const transcribeNew = Effect.gen(function* () {
          const audio = yield* upload(wav({ durationMs: 500 }));
          return yield* service.transcribe({
            providerInstanceId: INSTANCE,
            audioAttachmentId: audio.attachmentId,
          });
        });
        for (let index = 0; index < 3; index++) {
          expect(
            yield* reason(
              service.transcribe({
                providerInstanceId: INSTANCE,
                audioAttachmentId: createPendingAttachmentId(".wav"),
              }),
            ),
          ).toBe("audioMissing");
        }
        for (let index = 0; index < 64; index++) {
          yield* Queue.offer(harness.responses, Effect.succeed({ text: `${index}` }));
          yield* transcribeNew;
        }
        const refused = yield* Effect.flip(transcribeNew);
        expect(refused.reason).toBe("rateLimited");
        expect(refused.retryAfterMs).toBe(10 * 60_000);

        yield* TestClock.adjust(TEN_MINUTES);
        yield* Queue.offer(harness.responses, Effect.succeed({ text: "room again" }));
        expect(yield* transcribeNew).toEqual({ text: "room again" });
      }).pipe(Effect.provide(harness.layer));
    }),
  );
});
