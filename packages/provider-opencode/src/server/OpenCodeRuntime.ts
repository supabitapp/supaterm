import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as P from "effect/Predicate";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { signalProcessGroup } from "@supaterm/provider-core/server/processGroup";
import { isWindowsCommandNotFound } from "@supaterm/provider-core/server/snapshotProbe";
import * as OpenCodeServerLedger from "./OpenCodeServerLedger.ts";
import { collectStreamAsString } from "@supaterm/provider-core/server/snapshotProbe";
import * as NetService from "@supaterm/shared/Net";
import { AgentScope } from "@supaterm/shared/AgentScope";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { resolveSpawnCommand } from "@supaterm/shared/shell";
const encodeUnknownJsonStringExit = Schema.encodeUnknownExit(Schema.fromJsonString(Schema.Unknown));
const OPENCODE_EMPTY_CONFIG_CONTENT = "{}";

export const MINIMUM_OPENCODE_VERSION = "2.0.18";

function resolveOpenCodeConfigContent(
  inputEnvironment: Readonly<Record<string, string | undefined>> | undefined,
  inheritedEnvironment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return (
    inputEnvironment?.OPENCODE_CONFIG_CONTENT ??
    inheritedEnvironment.OPENCODE_CONFIG_CONTENT ??
    OPENCODE_EMPTY_CONFIG_CONTENT
  );
}

const DEFAULT_OPENCODE_SERVER_TIMEOUT_MS = 30_000;
const DEFAULT_HOSTNAME = "127.0.0.1";
const OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS = 64 * 1024;
const OPENCODE_SERVER_EXIT_DRAIN_TIMEOUT = "500 millis";
export interface OpenCodeServerProcess {
  readonly url: string;
  readonly version: string;
  readonly isRunning: Effect.Effect<boolean>;
  readonly exitCode: Effect.Effect<number, never>;
}

const OPENCODE_RUNTIME_ERROR_TAG = "OpenCodeRuntimeError";
export class OpenCodeRuntimeError extends Data.TaggedError(OPENCODE_RUNTIME_ERROR_TAG)<{
  readonly operation: string;
  readonly cause?: unknown;
  readonly detail: string;
  readonly reason?: OpenCodeStartupFailureReason;
}> {}

export type OpenCodeStartupFailureReason = "databaseLocked";

function classifyStartupExit(stderr: string): OpenCodeStartupFailureReason | undefined {
  return /SQLITE_BUSY|database is locked/i.test(stderr) ? "databaseLocked" : undefined;
}

export const isOpenCodeRuntimeError = (u: unknown): u is OpenCodeRuntimeError =>
  P.isTagged(u, OPENCODE_RUNTIME_ERROR_TAG);

function encodeJsonStringForDiagnostics(input: unknown): string | undefined {
  const result = encodeUnknownJsonStringExit(input);
  return Exit.isSuccess(result) ? result.value : undefined;
}

export function openCodeRuntimeErrorDetail(cause: unknown): string {
  if (isOpenCodeRuntimeError(cause)) return cause.detail;
  if (cause instanceof Error) {
    const message = cause.message;
    if (typeof message === "string") {
      const trimmedMessage = message.trim();
      if (trimmedMessage.length > 0) return trimmedMessage;
    }
  }
  if (cause && typeof cause === "object") {
    const anyCause = cause as Record<string, unknown>;
    const status = (anyCause.response as { status?: number } | undefined)?.status;
    const body = anyCause.error ?? anyCause.data ?? anyCause.body;
    const encodedBody = encodeJsonStringForDiagnostics(body ?? cause);
    if (encodedBody) {
      return `status=${status ?? "?"} body=${encodedBody}`;
    }
  }
  return String(cause);
}

export interface OpenCodeCommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export interface ParsedOpenCodeModelSlug {
  readonly providerID: string;
  readonly modelID: string;
}

export class OpenCodeRuntime extends Context.Service<
  OpenCodeRuntime,
  {
    readonly startOpenCodeServerProcess: (input: {
      readonly binaryPath: string;
      readonly directory: string;
      readonly environment?: NodeJS.ProcessEnv;
      readonly port?: number;
      readonly verify: (url: string) => Effect.Effect<string, OpenCodeRuntimeError>;
    }) => Effect.Effect<OpenCodeServerProcess, OpenCodeRuntimeError, Scope.Scope>;

    readonly runOpenCodeCommand: (input: {
      readonly binaryPath: string;
      readonly args: ReadonlyArray<string>;
      readonly environment?: NodeJS.ProcessEnv;
    }) => Effect.Effect<OpenCodeCommandResult, OpenCodeRuntimeError>;
  }
>()("@supaterm/provider-opencode/server/OpenCodeRuntime") {}

function parseServerUrlFromOutput(output: string): string | null {
  for (const line of output.split("\n")) {
    const match = line.match(/server listening on\s+(https?:\/\/[^\s]+)/i);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function parseOpenCodeModelSlug(
  slug: string | null | undefined,
): ParsedOpenCodeModelSlug | null {
  if (typeof slug !== "string") {
    return null;
  }

  const trimmed = slug.trim();
  const separator = trimmed.indexOf("/");
  if (separator <= 0 || separator === trimmed.length - 1) {
    return null;
  }

  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  };
}

function ensureRuntimeError(
  operation: OpenCodeRuntimeError["operation"],
  detail: string,
  cause: unknown,
): OpenCodeRuntimeError {
  return isOpenCodeRuntimeError(cause)
    ? cause
    : new OpenCodeRuntimeError({ operation, detail, cause });
}

const makeOpenCodeRuntime = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const netService = yield* NetService.NetService;
  const hostPlatform = yield* HostProcess.Platform;
  const serverLedger = yield* OpenCodeServerLedger.OpenCodeServerLedger;
  const agentScope = yield* AgentScope;

  const resolveCommand = (command: string, args: ReadonlyArray<string>, env?: NodeJS.ProcessEnv) =>
    resolveSpawnCommand(command, args, { ...(env ? { env } : {}), bypassNpmShim: true });

  const runOpenCodeCommand: OpenCodeRuntime["Service"]["runOpenCodeCommand"] = Effect.fn(
    "OpenCodeRuntime.runOpenCodeCommand",
  )(
    function* (input) {
      const spawnCommand = yield* resolveCommand(input.binaryPath, input.args, input.environment);
      const child = yield* spawner.spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          detached: hostPlatform !== "win32",
          shell: spawnCommand.shell,
          ...(input.environment ? { env: input.environment } : { extendEnv: true }),
        }),
      );
      const terminateCommandGroup =
        hostPlatform === "win32"
          ? child.kill({ killSignal: "SIGKILL" }).pipe(Effect.asVoid)
          : Effect.sync(() => {
              try {
                signalProcessGroup(Number(child.pid), "SIGKILL");
              } catch {}
            });
      yield* Effect.addFinalizer(() => terminateCommandGroup.pipe(Effect.ignore));
      const [stdout, stderr, code] = yield* Effect.all(
        [collectStreamAsString(child.stdout), collectStreamAsString(child.stderr), child.exitCode],
        { concurrency: "unbounded" },
      );
      const exitCode = Number(code);
      if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
        return yield* new OpenCodeRuntimeError({
          operation: "runOpenCodeCommand",
          detail: `spawn ${input.binaryPath} ENOENT`,
        });
      }
      return {
        stdout,
        stderr,
        code: exitCode,
      } satisfies OpenCodeCommandResult;
    },
    (effect, input) =>
      effect.pipe(
        Effect.scoped,
        Effect.mapError((cause) =>
          ensureRuntimeError(
            "runOpenCodeCommand",
            `Failed to execute '${input.binaryPath} ${input.args.join(" ")}': ${openCodeRuntimeErrorDetail(cause)}`,
            cause,
          ),
        ),
      ),
  );

  const startServerAttempt: OpenCodeRuntime["Service"]["startOpenCodeServerProcess"] = Effect.fn(
    "OpenCodeRuntime.startServerAttempt",
  )(function* (input) {
    const runtimeScope = yield* Scope.Scope;

    const port =
      input.port ??
      (yield* netService.findAvailablePort(0).pipe(
        Effect.mapError(
          (cause) =>
            new OpenCodeRuntimeError({
              operation: "startOpenCodeServerProcess",
              detail: `Failed to find available port: ${openCodeRuntimeErrorDetail(cause)}`,
              cause,
            }),
        ),
      ));
    const args = ["serve", `--hostname=${DEFAULT_HOSTNAME}`, `--port=${port}`];
    const launch = yield* agentScope.wrap({
      command: input.binaryPath,
      args,
      name: "opencode",
      env: input.environment,
      shared: true,
    });
    const spawnCommand = yield* resolveCommand(launch.command, launch.args, input.environment);

    // Scopes close in reverse order. Forking this before the group kill is
    // registered forgets the ledger entry only once the group is stopped.
    const ledgerScope = yield* Scope.fork(runtimeScope);
    const child = yield* spawner
      .spawn(
        ChildProcess.make(spawnCommand.command, spawnCommand.args, {
          detached: hostPlatform !== "win32",
          shell: spawnCommand.shell,
          env: {
            ...input.environment,
            // The value is set explicitly (rather than relying on inheritance) because
            // `extendEnv` is false whenever `input.environment` is provided.
            OPENCODE_CONFIG_CONTENT: resolveOpenCodeConfigContent(input.environment),
          },
          extendEnv: input.environment === undefined,
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new OpenCodeRuntimeError({
              operation: "startOpenCodeServerProcess",
              detail: `Failed to spawn OpenCode server process: ${openCodeRuntimeErrorDetail(cause)}`,
              cause,
            }),
        ),
      );

    const killOpenCodeProcessGroup = (signal: NodeJS.Signals) =>
      hostPlatform === "win32"
        ? child.kill({ killSignal: signal, forceKillAfter: "1 second" }).pipe(Effect.asVoid)
        : Effect.sync(() => {
            try {
              signalProcessGroup(Number(child.pid), signal);
            } catch {}
          });
    const terminateChild = killOpenCodeProcessGroup("SIGTERM").pipe(
      Effect.andThen(Effect.sleep("1 second")),
      Effect.andThen(killOpenCodeProcessGroup("SIGKILL")),
      Effect.ignore,
    );

    yield* Scope.addFinalizer(runtimeScope, terminateChild);
    const forgetServer = yield* serverLedger.track({ pid: Number(child.pid), port, args });
    yield* Scope.addFinalizer(ledgerScope, forgetServer);

    const stdoutRef = yield* Ref.make<string | null>("");
    const stderrRef = yield* Ref.make<string | null>("");
    const readyDeferred = yield* Deferred.make<string, OpenCodeRuntimeError>();

    const setReadyFromStdoutChunk = (chunk: string) =>
      Ref.modify(stdoutRef, (stdout) => {
        if (stdout === null) {
          return [null, null] as const;
        }
        const nextStdout = `${stdout}${chunk}`;
        return [
          parseServerUrlFromOutput(nextStdout),
          nextStdout.slice(-OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS),
        ] as const;
      }).pipe(
        Effect.flatMap((parsed) =>
          parsed ? Deferred.succeed(readyDeferred, parsed).pipe(Effect.ignore) : Effect.void,
        ),
      );

    const stdoutFiber = yield* child.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach(setReadyFromStdoutChunk),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );
    const stderrFiber = yield* child.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Ref.update(stderrRef, (stderr) =>
          stderr === null
            ? null
            : `${stderr}${chunk}`.slice(-OPENCODE_SERVER_STARTUP_MAX_OUTPUT_CHARS),
        ),
      ),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const exitFiber = yield* child.exitCode.pipe(
      Effect.flatMap((code) =>
        Effect.gen(function* () {
          // Allow trailing diagnostics to drain, but descendants can keep pipes open.
          const drained = yield* Fiber.joinAll([stdoutFiber, stderrFiber]).pipe(
            Effect.timeoutOption(OPENCODE_SERVER_EXIT_DRAIN_TIMEOUT),
          );
          if (Option.isNone(drained)) {
            yield* Fiber.interruptAll([stdoutFiber, stderrFiber]);
          }
          const stdout = (yield* Ref.get(stdoutRef)) ?? "";
          const stderr = (yield* Ref.get(stderrRef)) ?? "";
          const exitCode = Number(code);
          const reason = classifyStartupExit(stderr);
          yield* Deferred.fail(
            readyDeferred,
            new OpenCodeRuntimeError({
              operation: "startOpenCodeServerProcess",
              ...(reason ? { reason } : {}),
              detail: [
                `OpenCode server exited before startup completed (code: ${String(exitCode)}).`,
                stdout.trim() ? `stdout:\n${stdout.trim()}` : null,
                stderr.trim() ? `stderr:\n${stderr.trim()}` : null,
              ]
                .filter(Boolean)
                .join("\n\n"),
              cause: { exitCode, stdout, stderr },
            }),
          ).pipe(Effect.ignore);
        }),
      ),
      Effect.ignore,
      Effect.forkIn(runtimeScope),
    );

    const readyExit = yield* Effect.exit(
      Deferred.await(readyDeferred).pipe(Effect.timeoutOption(DEFAULT_OPENCODE_SERVER_TIMEOUT_MS)),
    );

    if (Exit.isFailure(readyExit) || Option.isNone(readyExit.value)) {
      yield* Fiber.interruptAll([stdoutFiber, stderrFiber, exitFiber]).pipe(Effect.ignore);
    }

    if (Exit.isFailure(readyExit)) {
      const squashed = Cause.squash(readyExit.cause);
      return yield* ensureRuntimeError(
        "startOpenCodeServerProcess",
        `Failed while waiting for OpenCode server startup: ${openCodeRuntimeErrorDetail(squashed)}`,
        squashed,
      );
    }

    const readyOption = readyExit.value;
    if (Option.isNone(readyOption)) {
      return yield* new OpenCodeRuntimeError({
        operation: "startOpenCodeServerProcess",
        detail: `Timed out waiting for OpenCode server start after ${DEFAULT_OPENCODE_SERVER_TIMEOUT_MS}ms.`,
      });
    }

    // Keep draining both pipes until the process scope closes. Stopping the
    // readers can block OpenCode when its output buffers fill. Startup output
    // is no longer needed, so discard later output instead of retaining it.
    yield* Ref.set(stdoutRef, null);
    yield* Ref.set(stderrRef, null);

    const url = readyOption.value;
    const version = yield* input.verify(url);

    return {
      url,
      version,
      isRunning: child.isRunning.pipe(Effect.orElseSucceed(() => false)),
      exitCode: child.exitCode.pipe(
        Effect.map(Number),
        Effect.orElseSucceed(() => 0),
      ),
    } satisfies OpenCodeServerProcess;
  });

  const startOpenCodeServerProcess: OpenCodeRuntime["Service"]["startOpenCodeServerProcess"] =
    Effect.fn("OpenCodeRuntime.startOpenCodeServerProcess")(function* (input) {
      const ownerScope = yield* Scope.Scope;
      const attempt = Effect.gen(function* () {
        const attemptScope = yield* Scope.fork(ownerScope);
        return yield* startServerAttempt(input).pipe(
          Effect.provideService(Scope.Scope, attemptScope),
          Effect.onExit((exit) =>
            Exit.isFailure(exit) ? Scope.close(attemptScope, exit) : Effect.void,
          ),
        );
      });

      return yield* attempt.pipe(
        Effect.retry({
          times: 3,
          schedule: Schedule.spaced("250 millis"),
          while: (error) => error.reason === "databaseLocked",
        }),
      );
    });

  return {
    startOpenCodeServerProcess,
    runOpenCodeCommand,
  } satisfies OpenCodeRuntime["Service"];
});

export const layer = Layer.effect(OpenCodeRuntime, makeOpenCodeRuntime).pipe(
  Layer.provide(NetService.layer),
);
