import type { RunResult } from "@cursor/sdk";
import { ProviderInstanceId, TextGenerationError } from "@supaterm/contracts";
import { CursorSettings } from "../settings.ts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { createModelSelection } from "@supaterm/shared/model";
import { beforeEach } from "vite-plus/test";

import { makeCursorTextGeneration } from "./textGeneration.ts";
import * as CursorSdk from "./CursorSdk.ts";

const defaultResult = {
  id: "run-cursor-text-generation-test",
  status: "finished",
  result: '{"subject":"Add generated commit message","body":"- verify cursor sdk text generation"}',
} satisfies RunResult;

interface FakeAgent {
  readonly close: () => void;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
  readonly send: (prompt: string) => Promise<unknown>;
}

const store = { dispose: async () => {} };
const sdkState = {
  created: new Array<unknown>(),
  prompts: 0,
  closes: 0,
  results: new Array<RunResult>(),
  agents: new Array<() => FakeAgent>(),
};

const close = () => {
  sdkState.closes += 1;
};

const runningAgent = () => ({
  close,
  [Symbol.asyncDispose]: async () => close(),
  send: async () => ({
    status: "running",
    cancel: async () => {},
    wait: async () => {
      sdkState.prompts += 1;
      return sdkState.results.shift() ?? defaultResult;
    },
  }),
});

const fakeSdk = {
  Agent: {
    create: async (options: unknown) => {
      sdkState.created.push(options);
      return (sdkState.agents.shift() ?? runningAgent)();
    },
  },
} as unknown as ReturnType<CursorSdk.CursorSdk["Service"]["load"]>;

const fakeSqlite = {
  SqliteLocalAgentStore: { open: async () => store },
} as unknown as ReturnType<CursorSdk.CursorSdk["Service"]["loadSqlite"]>;

let hasCustomPolicy = false;
const layerFs = FileSystem.layerNoop({
  exists: () => Effect.succeed(hasCustomPolicy),
  makeTempDirectoryScoped: () => Effect.succeed("/isolated-text-generation"),
});
const layerTest = Layer.succeed(
  CursorSdk.CursorSdk,
  CursorSdk.CursorSdk.of({ load: () => fakeSdk, loadSqlite: () => fakeSqlite }),
).pipe(Layer.provideMerge(Layer.merge(layerFs, Path.layer)));

const decodeCursorSettings = Schema.decodeSync(CursorSettings);
const cursorSettings = decodeCursorSettings({ enabled: true });

beforeEach(() => {
  hasCustomPolicy = false;
  sdkState.created.length = 0;
  sdkState.prompts = 0;
  sdkState.closes = 0;
  sdkState.results.length = 0;
  sdkState.agents.length = 0;
});

describe("CursorTextGeneration", () => {
  it.effect("resolves the browser credential for every request after an account change", () =>
    Effect.gen(function* () {
      let apiKey = "first-browser-key";
      const generation = yield* makeCursorTextGeneration(
        cursorSettings,
        {},
        Effect.sync(() => apiKey),
      );
      const input = {
        cwd: process.cwd(),
        branch: "feature/cursor",
        stagedSummary: "M file.ts",
        stagedPatch: "diff",
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "auto"),
      };
      yield* generation.generateCommitMessage(input);
      expect(sdkState.created.at(-1)).toMatchObject({ apiKey: "first-browser-key" });
      apiKey = "second-browser-key";
      yield* generation.generateCommitMessage(input);
      expect(sdkState.created.at(-1)).toMatchObject({ apiKey: "second-browser-key" });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("continues in the temp directory when the SDK cannot sandbox", () =>
    Effect.gen(function* () {
      sdkState.agents.push(() => ({
        close,
        [Symbol.asyncDispose]: async () => close(),
        send: async () => {
          throw new Error(
            "Local SDK sandboxing was requested, but sandboxing is not supported in this environment. Disable local.sandboxOptions.enabled or remove ~/.cursor/sandbox.json to run without sandboxing.",
          );
        },
      }));
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {
        CURSOR_API_KEY: "test-cursor-key",
      });

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "feature/cursor-text-generation",
        stagedSummary: "M apps/server/src/textGeneration/CursorTextGeneration.ts",
        stagedPatch: "diff --git a/apps/server/src/textGeneration/CursorTextGeneration.ts",
        modelSelection: createModelSelection(ProviderInstanceId.make("cursor"), "composer-2"),
      });

      expect(generated.subject).toBe("Add generated commit message");
      expect(sdkState.created).toHaveLength(2);
      expect(sdkState.created[0]).toMatchObject({
        local: { sandboxOptions: { enabled: true } },
      });
      expect(sdkState.created[1]).toMatchObject({
        local: {
          cwd: "/isolated-text-generation",
          store,
          autoReview: false,
          sandboxOptions: { enabled: false },
          settingSources: [],
          enableAgentRetries: true,
        },
      });
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("accepts json objects with extra assistant text around them", () =>
    Effect.gen(function* () {
      sdkState.results.push({
        id: "run-cursor-text-generation-test",
        status: "finished",
        result:
          'Sure, here is the JSON:\n```json\n{\n  "subject": "Update README dummy comment with attribution and date",\n  "body": ""\n}\n```\nDone.',
      });
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {
        CURSOR_API_KEY: "test-cursor-key",
      });

      const generated = yield* textGeneration.generateCommitMessage({
        cwd: process.cwd(),
        branch: "feature/cursor-noisy-json",
        stagedSummary: "M README.md",
        stagedPatch: "diff --git a/README.md b/README.md",
        modelSelection: {
          instanceId: ProviderInstanceId.make("cursor"),
          model: "composer-2",
        },
      });

      expect(generated.subject).toBe("Update README dummy comment with attribution and date");
      expect(generated.body).toBe("");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("generates thread titles through Cursor SDK text generation", () =>
    Effect.gen(function* () {
      sdkState.results.push({
        id: "run-cursor-title-generation-test",
        status: "finished",
        result: '{"title":"\\"Trim reconnect spinner status after resume.\\""}',
      });
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {
        CURSOR_API_KEY: "test-cursor-key",
      });

      const generated = yield* textGeneration.generateThreadTitle({
        cwd: process.cwd(),
        message: "Fix the reconnect spinner after a resumed session.",
        modelSelection: {
          instanceId: ProviderInstanceId.make("cursor"),
          model: "composer-2",
        },
      });

      expect(generated.title).toBe("Trim reconnect spinner status after resume.");
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect.each([
    {
      status: "error",
      error: { message: "Raw Cursor usage text", code: "PRO_USER_USAGE_LIMIT" },
      detail:
        "Cursor usage limit reached. Try again later or choose another text-generation provider.",
    },
    {
      status: "error",
      error: { message: "Raw Cursor backend text", code: "internal" },
      detail: "Cursor SDK request finished with an error.",
    },
    { status: "cancelled", error: undefined, detail: "Cursor SDK request was cancelled." },
  ] as const)(
    "rejects a $status Cursor SDK run ($error.code) that includes valid title JSON",
    ({ status, error, detail }) =>
      Effect.gen(function* () {
        const promptResult = {
          id: "run-cursor-partial-title-test",
          status,
          result: '{"title":"Partial title from a failed run."}',
          ...(error ? { error } : {}),
        } satisfies RunResult;
        sdkState.results.push(promptResult);
        const generation = yield* makeCursorTextGeneration(cursorSettings, {
          CURSOR_API_KEY: "test-cursor-key",
        });
        const failure = yield* Effect.flip(
          generation.generateThreadTitle({
            cwd: process.cwd(),
            message: "Fix the reconnect spinner after a resumed session.",
            modelSelection: {
              instanceId: ProviderInstanceId.make("cursor"),
              model: "composer-2",
            },
          }),
        );
        expect(failure).toBeInstanceOf(TextGenerationError);
        expect(failure.operation).toBe("generateThreadTitle");
        expect(failure.detail).toBe(detail);
        expect(failure.message).not.toContain("Raw Cursor");
        expect(failure.cause).toBe(error);
        expect(sdkState.closes).toBe(1);
      }).pipe(Effect.provide(layerTest)),
  );

  it.effect("fails closed when ambient sandbox policy can expand write access", () =>
    Effect.gen(function* () {
      hasCustomPolicy = true;
      const generation = yield* makeCursorTextGeneration(cursorSettings, { CURSOR_API_KEY: "key" });
      const failure = yield* Effect.flip(
        generation.generateThreadTitle({
          cwd: "/real-workspace",
          message: "Title",
          modelSelection: { instanceId: ProviderInstanceId.make("cursor"), model: "composer-2" },
        }),
      );
      expect(failure.detail).toContain("custom ~/.cursor/sandbox.json");
      expect(sdkState.prompts).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );

  it.effect("requires CURSOR_API_KEY before calling the SDK", () =>
    Effect.gen(function* () {
      const textGeneration = yield* makeCursorTextGeneration(cursorSettings, {});

      const error = yield* Effect.flip(
        textGeneration.generateCommitMessage({
          cwd: process.cwd(),
          branch: "feature/cursor-api-key",
          stagedSummary: "M README.md",
          stagedPatch: "diff --git a/README.md b/README.md",
          modelSelection: {
            instanceId: ProviderInstanceId.make("cursor"),
            model: "composer-2",
          },
        }),
      );

      expect(error.detail).toBe("Sign in with Cursor or add CURSOR_API_KEY in provider settings.");
      expect(sdkState.prompts).toBe(0);
    }).pipe(Effect.provide(layerTest)),
  );
});
