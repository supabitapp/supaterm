// @effect-diagnostics nodeBuiltinImport:off - cleanup uses Node's retrying rm, which the FileSystem service does not expose.
import * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { type ServerProvider } from "@supaterm/contracts";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Cause from "effect/Cause";
import * as Fiber from "effect/Fiber";
import * as Logger from "effect/Logger";
import * as Result from "effect/Result";
import * as TestClock from "effect/testing/TestClock";
import { ClaudeSettings } from "@supaterm/contracts";
import * as NodeFSP from "node:fs/promises";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import {
  buildClaudeCapabilitiesProbeQueryOptions,
  probeClaudeCapabilities,
  probeClaudeWorkspaceSnapshot,
} from "./ClaudeProvider.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", { spy: true });

const decodeClaudeSettings = Schema.decodeSync(ClaudeSettings);

it("drops strict MCP mode, and only that, next to an administrator's managed-mcp.json", () => {
  const options = buildClaudeCapabilitiesProbeQueryOptions({
    executablePath: "/usr/bin/claude",
    abortController: new AbortController(),
    environment: { HOME: "/home/user" },
    cwd: undefined,
    managedMcpConfig: true,
  });

  // Claude exits before initializing when handed --strict-mcp-config here.
  assert.equal(options.strictMcpConfig, undefined);
  assert.deepEqual(options.mcpServers, {});
  assert.equal(options.env?.ENABLE_CLAUDEAI_MCP_SERVERS, "false");
});

it.layer(NodeServices.layer)("Claude capability probe SDK boundary", (it) => {
  it.effect("serializes strict no-MCP options and still resolves account capabilities", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "supaterm-claude-probe-sdk-" });
      const executablePath = yield* path.fromFileUrl(
        new URL("./testing/ClaudeCapabilitiesProbe.fixture.mjs", import.meta.url),
      );
      const invocationPath = path.join(tempDir, "invocation.json");
      // The probe aborts the SDK without awaiting the child's exit, and on
      // Windows a directory that is still some process's cwd cannot be
      // removed. Keep the workspace outside the scoped directory and let it
      // go with a retrying removal once the child has gone.
      const workspaceCwd = yield* fs.makeTempDirectory({ prefix: "supaterm-claude-probe-cwd-" });
      // Node's own retry rather than an Effect schedule: it.effect runs on a
      // TestClock, so a scheduled retry would wait for time nobody advances.
      yield* Effect.addFinalizer(() =>
        Effect.promise(() =>
          NodeFSP.rm(workspaceCwd, {
            recursive: true,
            force: true,
            maxRetries: 20,
            retryDelay: 250,
          }).catch(() => undefined),
        ),
      );

      const capabilities = yield* probeClaudeCapabilities(
        decodeClaudeSettings({ binaryPath: executablePath }),
        {
          ...process.env,
          SUPATERM_PROBE_INVOCATION_PATH: invocationPath,
          ENABLE_CLAUDEAI_MCP_SERVERS: "true",
        },
        workspaceCwd,
      );

      assert.deepEqual(capabilities, {
        email: "dev@example.com",
        fastModeDisabledReason: "extra_usage_disabled",
        subscriptionType: "pro",
        tokenSource: "oauth",
        apiKeySource: undefined,
        apiProvider: undefined,
        slashCommands: [
          {
            name: "review",
            description: "Review changes",
            input: { hint: "[path]" },
          },
        ],
        usage: {
          rate_limits_available: true,
          rate_limits: { five_hour: { utilization: 12, resets_at: "2026-07-18T14:39:00Z" } },
        },
        usageCheckedAt: "1970-01-01T00:00:00.000Z",
      });

      const invocation = JSON.parse(yield* fs.readFileString(invocationPath)) as {
        readonly args: ReadonlyArray<string>;
        readonly cwd: string;
        readonly connectorEnv: string;
        readonly mcpConfig: unknown;
      };
      assert.equal(invocation.cwd, yield* fs.realPath(workspaceCwd));
      assert.equal(invocation.connectorEnv, "false");
      assert.equal(invocation.args.includes("--strict-mcp-config"), true);
      assert.equal(invocation.args.includes("--mcp-config"), false);
      assert.equal(invocation.mcpConfig, undefined);

      assert.equal(invocation.args.includes("--setting-sources=user,project,local"), true);

      const settingsFlagIndex = invocation.args.indexOf("--settings");
      assert.notEqual(settingsFlagIndex, -1);
      const flagSettings = JSON.parse(invocation.args[settingsFlagIndex + 1] ?? "{}") as {
        readonly disableAllHooks?: boolean;
      };
      assert.equal(flagSettings.disableAllHooks, true);
    }).pipe(Effect.scoped),
  );
});

it.effect("preserves the timeout cause, logs its deadline, and aborts the SDK query", () => {
  const messages: Array<unknown> = [];
  const logger = Logger.make<unknown, void>(({ message }) => {
    messages.push(message);
  });
  return Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    let abortSignal: AbortSignal | undefined;
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(({ options }) => {
      abortSignal = options?.abortController?.signal;
      return {
        initializationResult: () => {
          Deferred.doneUnsafe(started, Effect.void);
          return new Promise(() => {});
        },
      } as ReturnType<typeof ClaudeSdk.query>;
    });
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const probe = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
    ).pipe(Effect.result, Effect.forkChild);
    yield* Deferred.await(started);
    yield* TestClock.adjust("25 seconds");
    const result = yield* Fiber.join(probe);
    assert.equal(Result.isFailure(result), true);
    if (Result.isFailure(result)) assert.equal(Cause.isTimeoutError(result.failure), true);
    assert.equal(abortSignal?.aborted, true);
    assert.deepEqual(messages, [
      ["Claude capability probe failed.", { errorTag: "TimeoutError", timeoutMs: 25_000 }],
    ]);
  }).pipe(Effect.scoped, Effect.provide([NodeServices.layer, Logger.layer([logger])]));
});

it.effect("records an SDK failure without exposing the rejection message", () => {
  const messages: Array<unknown> = [];
  const logger = Logger.make<unknown, void>(({ message }) => {
    messages.push(message);
  });
  return Effect.gen(function* () {
    const query = vi.spyOn(ClaudeSdk, "query").mockImplementation(
      () =>
        ({
          initializationResult: () => Promise.reject(new TypeError("secret-sdk-output")),
        }) as ReturnType<typeof ClaudeSdk.query>,
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => query.mockRestore()));
    const result = yield* probeClaudeCapabilities(
      decodeClaudeSettings({ binaryPath: "claude" }),
    ).pipe(Effect.result);
    assert.equal(Result.isFailure(result), true);
    if (Result.isFailure(result)) assert.equal(result.failure._tag, "UnknownError");
    assert.deepEqual(messages, [["Claude capability probe failed.", { errorTag: "UnknownError" }]]);
    assert.equal(JSON.stringify(messages).includes("secret-sdk-output"), false);
  }).pipe(Effect.scoped, Effect.provide([NodeServices.layer, Logger.layer([logger])]));
});

it.effect("reports a deleted worktree's scan as finished, not pending", () =>
  Effect.gen(function* () {
    const snapshot = yield* probeClaudeWorkspaceSnapshot(
      decodeClaudeSettings({}),
      { skills: [], slashCommands: [] } as unknown as ServerProvider,
      "/nonexistent/supaterm-deleted-worktree",
      { HOME: "/nonexistent/supaterm-home" },
    );
    assert.strictEqual(snapshot.slashCommandsPending, false);
  }).pipe(Effect.provide(NodeServices.layer)),
);
