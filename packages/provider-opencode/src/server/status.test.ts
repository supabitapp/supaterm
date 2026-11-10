import * as NodeAssert from "node:assert/strict";
import * as NodeSqlite from "node:sqlite";

import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Schema from "effect/Schema";
import * as Tracer from "effect/Tracer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { beforeEach } from "vite-plus/test";

import { OpenCodeSettings } from "../settings.ts";
import * as OpenCodeRuntime from "./OpenCodeRuntime.ts";
import {
  checkOpenCodeProviderStatus,
  loadOpenCode2Workspace,
  type OpenCode2Model,
  type OpenCode2Workspace,
} from "./status.ts";
import { readOpenCodeGoUsageLimits } from "./usageLimits.ts";
import { probeOpenCodeRuntime } from "./versionProbe.ts";
import {
  OPENCODE_1_RESPONSES,
  OPENCODE_2_RESPONSES,
  replayOpenCodeServer,
} from "./probeResponses.fixture.ts";
const decodeOpenCodeSettings = Schema.decodeSync(OpenCodeSettings);

const DEFAULT_VERSION_STDOUT = "opencode v2.0.18\n";

it.effect("reads Go limits with the instance's XDG credentials and preserves reset times", () =>
  Effect.gen(function* () {
    const resetsAt = "2026-09-17T12:00:00.000Z";
    const limits = yield* readOpenCodeGoUsageLimits({
      enabled: true,
      serverUrl: "",
      environment: { XDG_DATA_HOME: "/instance/data", OPENCODE_API_KEY: "env-key" },
    }).pipe(
      Effect.provideService(
        FileSystem.FileSystem,
        FileSystem.makeNoop({
          readFileString: (path) => {
            NodeAssert.equal(path, "/instance/data/opencode/auth.json");
            return Effect.succeed(
              JSON.stringify({ "opencode-go": { type: "api", key: "instance-key" } }),
            );
          },
        }),
      ),
      Effect.provideService(
        HttpClient.HttpClient,
        HttpClient.make((request) => {
          NodeAssert.equal(request.url, "https://opencode.ai/zen/go/v1/usage");
          NodeAssert.equal(request.headers.authorization, "Bearer instance-key");
          return Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                usage: {
                  rolling: { percent: 0, resetsAt },
                  weekly: { percent: 10, resetsAt },
                  monthly: { percent: 125, resetsAt },
                },
              }),
            ),
          );
        }),
      ),
      Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
    );
    NodeAssert.equal(limits.unavailable, undefined);
    NodeAssert.equal(
      limits.credentialFingerprint,
      "aba48e85c981a8edc1c9fb4575121accc7235fa55d0f8689f66f153de5566a37",
    );
    NodeAssert.deepEqual(
      limits.windows.map(({ kind, usedPercent, resetsAt: reset }) => ({
        kind,
        usedPercent,
        reset,
      })),
      [
        { kind: "session", usedPercent: 0, reset: resetsAt },
        { kind: "weekly", usedPercent: 10, reset: resetsAt },
        { kind: "monthly", usedPercent: 100, reset: resetsAt },
      ],
    );
  }),
);

it.effect(
  "uses the selected public Console key for Go limits, falling back only on auth rejection",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dataHome = yield* fs.makeTempDirectoryScoped();
      yield* fs.makeDirectory(`${dataHome}/opencode`);
      yield* fs.writeFileString(
        `${dataHome}/opencode/auth.json`,
        JSON.stringify({ "opencode-go": { type: "api", key: "go-key" } }),
      );
      const database = yield* Effect.acquireRelease(
        Effect.sync(() => new NodeSqlite.DatabaseSync(`${dataHome}/opencode/opencode.db`)),
        (database) => Effect.sync(() => database.close()),
      );
      database.exec(
        "CREATE TABLE credential (id text PRIMARY KEY, integration_id text, value text, active integer, time_created integer, time_updated integer)",
      );
      const insert = database.prepare("INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?)");
      const window = { percent: 1, resetsAt: "2026-09-17T12:00:00.000Z" };
      const consoleKey = { type: "key", key: "console-key" };
      const fingerprints = new Map([
        ["console-key", "3e45cfde9158185930d4cc7020a4e390895574fd54bd8f9631d23a336bbf94f0"], // gitleaks:allow
        ["go-key", "d0e590e93fc9bd9353f2b993c0c287391cae505da2a78cb698b75418d2f5367e"], // gitleaks:allow
        ["inline-key", "85649de18e63305548b6407e185f708483727ee6189cc4bc9512ddb17e23e776"], // gitleaks:allow
      ]);
      for (const {
        consoleRow = consoleKey,
        active = 1,
        consoleStatus = 200,
        inline = false,
        databaseFile,
        requested,
      } of [
        {
          consoleRow: { ...consoleKey, metadata: { server: "https://opencode.ai/console" } },
          requested: ["console-key"],
        },
        { consoleStatus: 401, requested: ["console-key", "go-key"] },
        { consoleStatus: 403, requested: ["console-key", "go-key"] },
        { consoleStatus: 500, requested: ["console-key"] },
        { active: 0, requested: ["go-key"] },
        {
          consoleRow: {
            type: "oauth",
            methodID: "device",
            access: "token",
            refresh: "refresh",
            expires: 0,
          },
          requested: ["go-key"],
        },
        {
          consoleRow: { ...consoleKey, metadata: { server: "https://console.example" } },
          requested: ["go-key"],
        },
        { inline: true, requested: ["inline-key"] },
        { databaseFile: "selected.db", requested: ["console-key"] },
        { databaseFile: ":memory:", requested: ["go-key"] },
        { active: null, requested: ["console-key"] },
      ]) {
        database.exec("DELETE FROM credential");
        insert.run("cred_selected", "opencode", JSON.stringify(consoleRow), active, 2, 2);
        // Legacy selections follow creation order, even when an older key was updated later.
        insert.run(
          "cred_older",
          "opencode",
          JSON.stringify({ type: "key", key: "old-key" }),
          active === null ? null : 0,
          1,
          9,
        );
        insert.run("cred_other", "other", JSON.stringify(consoleKey), 1, 10, 10);
        if (databaseFile === "selected.db") {
          yield* fs.writeFile(
            `${dataHome}/opencode/selected.db`,
            yield* fs.readFile(`${dataHome}/opencode/opencode.db`),
          );
          database
            .prepare("UPDATE credential SET value = ? WHERE id = 'cred_selected'")
            .run(JSON.stringify({ type: "key", key: "old-key" }));
        }
        const before = yield* fs.readFile(`${dataHome}/opencode/opencode.db`);
        const authorizations: string[] = [];
        const limits = yield* readOpenCodeGoUsageLimits({
          enabled: true,
          serverUrl: "",
          environment: {
            XDG_DATA_HOME: dataHome,
            ...(databaseFile !== undefined ? { OPENCODE_DB: databaseFile } : {}),
            ...(inline
              ? { OPENCODE_AUTH_CONTENT: '{"opencode-go":{"type":"api","key":"inline-key"}}' }
              : {}),
          },
        }).pipe(
          Effect.provideService(
            HttpClient.HttpClient,
            HttpClient.make((request) => {
              NodeAssert.equal(request.url, "https://opencode.ai/zen/go/v1/usage");
              const key = (request.headers.authorization ?? "").replace("Bearer ", "");
              authorizations.push(key);
              // The legacy key is expired in the regression; it only works in fallback scenarios.
              const status =
                key === "console-key" ? consoleStatus : requested.includes(key) ? 200 : 401;
              return Effect.succeed(
                HttpClientResponse.fromWeb(
                  request,
                  Response.json(
                    { usage: { rolling: window, weekly: window, monthly: window } },
                    { status },
                  ),
                ),
              );
            }),
          ),
        );
        NodeAssert.deepEqual(authorizations, requested);
        NodeAssert.deepEqual(yield* fs.readFile(`${dataHome}/opencode/opencode.db`), before);
        NodeAssert.equal(
          limits.unavailable?.reason,
          consoleStatus === 500 ? "probeFailed" : undefined,
        );
        NodeAssert.equal(limits.windows.length, consoleStatus === 500 ? 0 : 3);
        NodeAssert.equal(
          limits.credentialFingerprint,
          consoleStatus === 500 ? undefined : fingerprints.get(requested.at(-1)!),
        );
      }
    }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("prefers the selected stored Go key over the auth.json key OpenCode 2 imported", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dataHome = yield* fs.makeTempDirectoryScoped();
    yield* fs.makeDirectory(`${dataHome}/opencode`);
    yield* fs.writeFileString(
      `${dataHome}/opencode/auth.json`,
      JSON.stringify({ "opencode-go": { type: "api", key: "imported-key" } }),
    );
    const database = yield* Effect.acquireRelease(
      Effect.sync(() => new NodeSqlite.DatabaseSync(`${dataHome}/opencode/opencode.db`)),
      (database) => Effect.sync(() => database.close()),
    );
    database.exec(
      "CREATE TABLE credential (id text PRIMARY KEY, integration_id text, value text, active integer, time_created integer, time_updated integer)",
    );
    const insert = database.prepare("INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(
      "cred_imported",
      "opencode-go",
      JSON.stringify({ type: "key", key: "imported-key" }),
      0,
      1,
      2,
    );
    insert.run(
      "cred_replaced",
      "opencode-go",
      JSON.stringify({ type: "key", key: "replaced-key" }),
      1,
      2,
      2,
    );
    const window = { percent: 1, resetsAt: "2026-09-17T12:00:00.000Z" };
    for (const { replacedStatus, requested } of [
      { replacedStatus: 200, requested: ["replaced-key"] },
      { replacedStatus: 401, requested: ["replaced-key", "imported-key"] },
    ]) {
      const authorizations: string[] = [];
      const limits = yield* readOpenCodeGoUsageLimits({
        enabled: true,
        serverUrl: "",
        environment: { XDG_DATA_HOME: dataHome },
      }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) => {
            const key = (request.headers.authorization ?? "").replace("Bearer ", "");
            authorizations.push(key);
            const status = key === "replaced-key" ? replacedStatus : 200;
            return Effect.succeed(
              HttpClientResponse.fromWeb(
                request,
                Response.json(
                  { usage: { rolling: window, weekly: window, monthly: window } },
                  { status },
                ),
              ),
            );
          }),
        ),
      );
      NodeAssert.deepEqual(authorizations, requested);
      NodeAssert.equal(limits.unavailable, undefined);
      NodeAssert.equal(limits.windows.length, 3);
    }
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
);

it.effect("does not read local credentials for external or disabled OpenCode instances", () =>
  Effect.gen(function* () {
    for (const settings of [
      { enabled: true, serverUrl: "https://remote.example" },
      { enabled: false, serverUrl: "" },
    ]) {
      const limits = yield* readOpenCodeGoUsageLimits({ ...settings, environment: {} }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            readFileString: () => Effect.die("unexpected credential read"),
          }),
        ),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make(() => Effect.die("unexpected usage request")),
        ),
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      NodeAssert.equal(limits.unavailable?.reason, "unsupported");
    }
  }),
);

it.effect("keeps Go entitlement absence distinct from failed or malformed usage responses", () =>
  Effect.gen(function* () {
    for (const [status, reason] of [
      [403, "unsupported"],
      [401, "probeFailed"],
      [200, "probeFailed"],
    ] as const) {
      const limits = yield* readOpenCodeGoUsageLimits({
        enabled: true,
        serverUrl: "",
        environment: {
          OPENCODE_AUTH_CONTENT: '{"opencode-go":{"type":"api","key":"inline-key"}}',
        },
      }).pipe(
        Effect.provideService(
          FileSystem.FileSystem,
          FileSystem.makeNoop({
            readFileString: () => Effect.die("inline credentials must bypass disk"),
          }),
        ),
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}, { status }))),
          ),
        ),
        Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      );
      NodeAssert.equal(limits.unavailable?.reason, reason);
      NodeAssert.equal(limits.credentialFingerprint, undefined);
      NodeAssert.deepEqual(limits.windows, []);
    }
  }),
);

const runtimeMock = {
  state: {
    runVersionError: null as Error | null,
    versionStdout: DEFAULT_VERSION_STDOUT,
  },
  reset() {
    this.state.runVersionError = null;
    this.state.versionStdout = DEFAULT_VERSION_STDOUT;
  },
};

const OpenCodeRuntimeTestDouble: OpenCodeRuntime.OpenCodeRuntime["Service"] = {
  startOpenCodeServerProcess: () => Effect.die("A status check must not start a server"),
  runOpenCodeCommand: () =>
    runtimeMock.state.runVersionError
      ? Effect.fail(
          new OpenCodeRuntime.OpenCodeRuntimeError({
            operation: "runOpenCodeCommand",
            detail: runtimeMock.state.runVersionError.message,
            cause: runtimeMock.state.runVersionError,
          }),
        )
      : Effect.succeed({ stdout: runtimeMock.state.versionStdout, stderr: "", code: 0 }),
};

beforeEach(() => {
  runtimeMock.reset();
});

const makeOpenCodeSettings = (overrides?: Partial<OpenCodeSettings>): OpenCodeSettings =>
  decodeOpenCodeSettings({
    enabled: true,
    binaryPath: "opencode",
    serverUrl: "",
    serverPassword: "",
    customModels: [],
    ...overrides,
  });

const checkProvider = (
  settings: OpenCodeSettings,
  server = replayOpenCodeServer(OPENCODE_2_RESPONSES, settings.serverPassword),
  openCode2Models: Effect.Effect<
    ReadonlyArray<OpenCode2Model>,
    OpenCodeRuntime.OpenCodeRuntimeError
  > = Effect.succeed([]),
) =>
  checkOpenCodeProviderStatus(
    settings,
    probeOpenCodeRuntime(settings).pipe(
      Effect.provideService(HttpClient.HttpClient, server),
      Effect.provideService(OpenCodeRuntime.OpenCodeRuntime, OpenCodeRuntimeTestDouble),
    ),
    openCode2Models,
  );

const checkServerProbeFailure = (serverUrl: string, detail: string) =>
  checkOpenCodeProviderStatus(
    makeOpenCodeSettings({ serverUrl }),
    Effect.fail(
      new OpenCodeRuntime.OpenCodeRuntimeError({ operation: "probeOpenCodeServer", detail }),
    ),
    Effect.succeed([]),
  );

describe("checkOpenCodeProviderStatus", () => {
  it.effect.each(["version", "models", "empty"] as const)(
    "records %s discovery failures in the existing trace and logger",
    (failure) =>
      Effect.gen(function* () {
        const cause = new Error("discovery connection reset");
        if (failure === "version") runtimeMock.state.runVersionError = cause;
        const spans: Array<Tracer.NativeSpan> = [];
        yield* checkProvider(
          makeOpenCodeSettings({ serverPassword: "private-password" }),
          undefined,
          failure === "models"
            ? Effect.fail(
                new OpenCodeRuntime.OpenCodeRuntimeError({
                  operation: "model.list",
                  detail: "model list failed",
                  cause,
                }),
              )
            : Effect.succeed([]),
        ).pipe(
          Effect.provideService(
            Tracer.Tracer,
            Tracer.make({
              span: (options) => {
                const span = new Tracer.NativeSpan(options);
                spans.push(span);
                return span;
              },
            }),
          ),
          Effect.provide(Logger.layer([Logger.tracerLogger], { mergeWithExisting: false })),
        );

        const diagnostics = spans.flatMap((span) =>
          span.events
            .filter(([name]) => name === "OpenCode discovery failed")
            .map((event) => ({ span, event })),
        );
        NodeAssert.equal(diagnostics.length, 1);
        const {
          span,
          event: [, timestamp, attributes],
        } = diagnostics[0]!;
        NodeAssert.equal(attributes.provider, "opencode");
        NodeAssert.equal(attributes.phase, failure === "empty" ? "models" : failure);
        NodeAssert.equal(attributes.outcome, failure === "empty" ? "empty" : "failed");
        NodeAssert.equal(attributes.serverMode, "managed");
        NodeAssert.equal(attributes["effect.logLevel"], "WARN");
        NodeAssert.ok(timestamp >= 0n);
        NodeAssert.ok(span.traceId.length > 0);
        NodeAssert.equal(span.attributes.get("discovery.outcome"), attributes.outcome);
        if (failure !== "empty") {
          NodeAssert.match(String(attributes["effect.cause"]), /discovery connection reset/);
        }
        NodeAssert.ok(!JSON.stringify(attributes).includes("private-password"));
      }),
  );

  it.effect("lists a local OpenCode 2 binary's models in Full access only", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings(),
        undefined,
        Effect.succeed([
          { providerID: "opencode", id: "big-pickle", name: "Big Pickle", variants: [] },
          {
            providerID: "opencode",
            id: "space-bunny-free",
            name: "Space Bunny Free",
            variants: [{ id: "low" }, { id: "medium" }, { id: "high" }],
          },
        ]),
      );

      NodeAssert.equal(snapshot.status, "ready");
      NodeAssert.equal(snapshot.version, "2.0.18");
      NodeAssert.equal("installedVersion" in snapshot, false);
      NodeAssert.deepEqual(snapshot.supportedRuntimeModes, [
        "approval-required",
        "auto-accept-edits",
        "auto",
        "full-access",
      ]);
      NodeAssert.equal(snapshot.showInteractionModeToggle, true);
      NodeAssert.deepEqual(
        snapshot.slashCommands.map((command) => command.name),
        ["compact"],
      );
      NodeAssert.deepEqual(
        snapshot.models.map((model) => model.slug),
        ["opencode/big-pickle", "opencode/space-bunny-free"],
      );
      const variant = snapshot.models.find((model) => model.slug === "opencode/space-bunny-free")
        ?.capabilities?.optionDescriptors?.[0];
      NodeAssert.deepEqual(
        variant?.type === "select" ? variant.options.map((option) => option.id) : [],
        ["low", "medium", "high"],
      );
      NodeAssert.equal(
        variant?.type === "select"
          ? variant.options.find((option) => option.isDefault === true)?.id
          : undefined,
        "medium",
      );
    }),
  );

  it.effect("marks older releases of a family and deprecated models as legacy", () =>
    Effect.gen(function* () {
      const releases = [
        ["opencode", "opus-4-5", "claude-opus", "2025-11-24", "active"],
        ["opencode", "opus-5-5", "claude-opus", "2026-09-22", "active"],
        ["opencode", "opus-preview", "claude-opus", "2026-10-01", "deprecated"],
        ["opencode", "flash", "flash", "2026-09-10", "active"],
        ["opencode", "flash-free", "flash", "2026-09-10", "active"],
        ["opencode", "big-pickle", undefined, "2025-10-17", "active"],
        ["openrouter", "opus-4-5", "claude-opus", "2025-11-24", "active"],
      ] as const;
      const legacySlugs = (
        models: ReadonlyArray<{ readonly slug: string; readonly isLegacy?: boolean | undefined }>,
      ) => models.flatMap((model) => (model.isLegacy ? [model.slug] : [])).toSorted();
      const expected = ["opencode/opus-4-5", "opencode/opus-preview"];

      const openCode2 = yield* checkProvider(
        makeOpenCodeSettings(),
        undefined,
        Effect.succeed(
          releases.map(([providerID, id, family, releaseDate, status]) => ({
            providerID,
            id,
            name: id,
            variants: [],
            family,
            released: Date.parse(releaseDate),
            deprecated: status === "deprecated",
          })),
        ),
      );
      NodeAssert.deepEqual(legacySlugs(openCode2.models), expected);
    }),
  );

  it.effect("reports a failed OpenCode 2 model list without the server's response", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings(),
        undefined,
        Effect.fail(
          new OpenCodeRuntime.OpenCodeRuntimeError({
            operation: "model.list",
            detail: 'status=500 body={"token":"leaked-response-body"}',
          }),
        ),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.message, "OpenCode could not load its model list.");
      NodeAssert.deepEqual(
        snapshot.slashCommands.map((command) => command.name),
        ["compact"],
      );
    }),
  );

  it.effect.each([
    { name: "a local binary", settings: {} },
    {
      name: "a configured server",
      settings: { serverUrl: "http://127.0.0.1:9999", serverPassword: "secret-password" },
    },
  ])("reports OpenCode 1.x from $name as installed and unsupported", ({ settings }) =>
    Effect.gen(function* () {
      runtimeMock.state.versionStdout = "1.18.32\n";
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings(settings),
        replayOpenCodeServer(OPENCODE_1_RESPONSES, "secret-password"),
        Effect.die("OpenCode 1.x must not load the OpenCode 2 model list"),
      );

      NodeAssert.equal(snapshot.installed, true);
      NodeAssert.equal(snapshot.version, "1.18.32");
      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode 1.x is no longer supported. Install OpenCode 2 with `npm install -g @opencode/cli`, then refresh provider status.",
      );
      NodeAssert.deepEqual(snapshot.models, []);
    }),
  );
});

describe("checkOpenCodeProviderStatus with configured server URL", () => {
  it.effect.each([
    "401 Unauthorized",
    "403 Forbidden",
    "status=401 body={}",
    "status=403 body={}",
    "HTTP 401",
    "HTTP/1.1 403",
    "Response status code: 401",
    "Response status code: 403",
    "Request failed with status code 401",
    "Request failed with status code 403",
  ])("keeps explicit authentication rejection actionable: %s", (detail) =>
    Effect.gen(function* () {
      const snapshot = yield* checkServerProbeFailure("http://127.0.0.1:9999", detail);

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.auth.status, "unauthenticated");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode server rejected authentication. Check the server URL and password.",
      );
    }),
  );

  it.effect.each([401, 403, 4010, 4030])("keeps connection failures on port %s retryable", (port) =>
    Effect.gen(function* () {
      const serverUrl = `http://127.0.0.1:${port}`;
      const snapshot = yield* checkServerProbeFailure(
        serverUrl,
        `connect ECONNREFUSED 127.0.0.1:${port}`,
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(snapshot.auth.status, "unknown");
      NodeAssert.equal(
        snapshot.message,
        `Couldn't reach the configured OpenCode server at ${serverUrl}. Check that the server is running and the URL is correct.`,
      );
    }),
  );

  it.effect("checks a configured OpenCode 2 server through its own version", () =>
    Effect.gen(function* () {
      const settings = makeOpenCodeSettings({
        serverUrl: "http://127.0.0.1:9999",
        serverPassword: "secret-password",
      });
      const snapshot = yield* checkProvider(
        settings,
        replayOpenCodeServer(OPENCODE_2_RESPONSES, "secret-password"),
      );

      NodeAssert.equal(snapshot.status, "warning");
      NodeAssert.equal(snapshot.version, "2.0.18");
      NodeAssert.equal("installedVersion" in snapshot, false);
      NodeAssert.deepEqual(snapshot.supportedRuntimeModes, [
        "approval-required",
        "auto-accept-edits",
        "auto",
        "full-access",
      ]);
    }),
  );

  it.effect("reports a rejected OpenCode 2 password as an auth error, not a version", () =>
    Effect.gen(function* () {
      const snapshot = yield* checkProvider(
        makeOpenCodeSettings({ serverUrl: "http://127.0.0.1:9999", serverPassword: "wrong" }),
        replayOpenCodeServer(OPENCODE_2_RESPONSES, "secret-password"),
      );

      NodeAssert.equal(snapshot.status, "error");
      NodeAssert.equal(
        snapshot.message,
        "OpenCode server rejected authentication. Check the server URL and password.",
      );
    }),
  );
});

const builtinCommands = [
  { name: "init", description: "guided AGENTS.md setup" },
  { name: "review", description: "review changes [commit|branch|pr], defaults to uncommitted" },
];
const builtinSkills = [
  { id: "opencode", name: "OpenCode", path: "/builtin/opencode.md" },
  { id: "report", name: "Report", path: "/builtin/report.md" },
];
const scanned: OpenCode2Workspace = {
  commands: [...builtinCommands, { name: "hello", description: "Say hello to the workspace" }],
  skills: [
    ...builtinSkills,
    {
      id: "greet",
      name: "greet",
      path: "/work/.opencode/skills/greet/SKILL.md",
      description: "Greets the user with the secret word MANGO.",
    },
  ],
};

it.effect("reads a fresh OpenCode 2 directory again once its scan has ended", () =>
  Effect.gen(function* () {
    const reads: Array<OpenCode2Workspace> = [{ commands: [], skills: [] }, scanned];
    const scanEnded = yield* Deferred.make<void>();
    const load = yield* loadOpenCode2Workspace(
      Effect.sync(() => reads.shift()!),
      Deferred.await(scanEnded),
    ).pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    NodeAssert.equal(reads.length, 1);
    yield* Deferred.succeed(scanEnded, undefined);
    NodeAssert.deepEqual(yield* Fiber.join(load), scanned);
  }),
);
