// @effect-diagnostics nodeBuiltinImport:off -- The integration fixture binds the same platform socket or named pipe as the CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeEvents from "node:events";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import type { DesktopAppActivationRequest } from "@supaterm/contracts";
import { resolveDesktopAppControlAddress } from "@supaterm/shared/desktopAppControl";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as NetService from "@supaterm/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as TestConsole from "effect/testing/TestConsole";
import { Command } from "effect/cli";
import { describe, expect } from "vite-plus/test";

import { makeCli } from "../binCli.ts";
import { PersistedServerRuntimeState } from "../serverRuntimeState.ts";

const liveProcess = Effect.acquireRelease(
  Effect.promise(async () => {
    const child = NodeChildProcess.spawn(process.execPath, ["-e", "process.stdin.resume()"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    await NodeEvents.EventEmitter.once(child, "spawn");
    return child;
  }),
  (child) =>
    Effect.promise(async () => {
      const exited = NodeEvents.EventEmitter.once(child, "exit");
      child.kill();
      await exited;
    }),
);

const encodeRuntimeState = Schema.encodeEffect(Schema.fromJsonString(PersistedServerRuntimeState));

const runCli = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  Command.runWith(makeCli(), { version: "0.0.0" })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NetService.layer,
        TestConsole.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      ),
    ),
  );

const pathExists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.stat(path).then(
      () => true,
      () => false,
    ),
  );

async function startFakeDesktop(input: {
  readonly baseDir: string;
  readonly stateSubdirectory?: "userdata" | "dev";
  readonly platform: NodeJS.Platform;
  readonly userId: number | undefined;
  readonly reply?: (request: DesktopAppActivationRequest) => unknown;
}) {
  const target = resolveDesktopAppControlAddress({
    stateDir: NodePath.join(input.baseDir, input.stateSubdirectory ?? "userdata"),
    platform: input.platform,
    tempDir: NodeOS.tmpdir(),
    userId: input.userId,
    joinPath: NodePath.join,
  });
  if (target.directory !== null) {
    await NodeFSP.mkdir(target.directory, { recursive: true, mode: 0o700 });
    await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const received: DesktopAppActivationRequest[] = [];
  const server = NodeNet.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline)) as DesktopAppActivationRequest;
      received.push(request);
      const response = input.reply
        ? input.reply(request)
        : {
            version: 1,
            requestId: request.requestId,
            ok: true,
            projectId: "project-1",
            threadId: `thread-${received.length}`,
          };
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(target.address, resolve);
  });

  if (target.directory !== null) await NodeFSP.chmod(target.address, 0o600);

  return {
    address: target.address,
    received,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (target.directory !== null) {
        await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

const fakeDesktop = Effect.fn(function* (
  input: Omit<Parameters<typeof startFakeDesktop>[0], "platform" | "userId">,
) {
  const platform = yield* HostProcess.Platform;
  const userId = yield* HostProcess.UserId;
  return yield* Effect.acquireRelease(
    Effect.promise(() => startFakeDesktop({ ...input, platform, userId })),
    (server) => Effect.promise(() => server.close()),
  );
});

const withTempDirectory = <A, E, R>(
  prefix: string,
  use: (root: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix))),
    use,
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );

describe("supaterm server command safety", () => {
  it.effect("rejects unknown command words without creating a home or project", () =>
    withTempDirectory("supaterm-cli-unknown-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "home");
        for (const word of [
          "account",
          "login",
          "clients",
          "conenct",
          "package.json",
          "C:new-project",
        ]) {
          const error = yield* runCli([word, "--base-dir", baseDir]).pipe(
            Effect.provideService(HostProcess.Platform, "linux"),
            Effect.flip,
          );
          expect(String(error)).toContain(`Unknown command "${word}"`);
          expect(yield* pathExists(word)).toBe(word === "package.json");
          expect(yield* pathExists(baseDir)).toBe(false);
        }
      }),
    ),
  );

  it.effect("shows help without creating state", () =>
    withTempDirectory("supaterm-cli-help-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "home");
        const help = yield* runCli(["help"], { SUPATERM_HOME: baseDir }).pipe(Effect.flip);
        expect(help).toMatchObject({ _tag: "ShowHelp", commandPath: ["supaterm"], errors: [] });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("refuses manual startup over a live server before creating directories", () =>
    withTempDirectory("supaterm-cli-running-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "home");
        const stateDir = NodePath.join(baseDir, "userdata");
        const statePath = NodePath.join(stateDir, "server-runtime.json");
        const child = yield* liveProcess;
        assert(child.pid !== undefined);
        const record = yield* encodeRuntimeState({
          version: 1,
          pid: child.pid,
          port: 3773,
          origin: "http://127.0.0.1:3773",
          startedAt: "2026-10-01T00:00:00.000Z",
          serviceManaged: true,
        });
        yield* Effect.promise(() => NodeFSP.mkdir(stateDir, { recursive: true }));
        yield* Effect.promise(() => NodeFSP.writeFile(statePath, record));
        const newDirectory = NodePath.join(root, "new-project");
        const platform = yield* HostProcess.Platform;
        for (const args of [
          [],
          ["start"],
          ["."],
          ["node_modules"],
          ["C:new-project"],
          [newDirectory],
          ["start", newDirectory],
        ]) {
          const error = yield* runCli(args, { SUPATERM_HOME: baseDir }).pipe(
            Effect.provideService(
              HostProcess.Platform,
              args[0] === "C:new-project" ? "win32" : platform,
            ),
            Effect.flip,
          );
          expect(String(error)).toContain("A Supaterm server is already running");
          expect(yield* Effect.promise(() => NodeFSP.readFile(statePath, "utf8"))).toBe(record);
          expect(yield* pathExists(newDirectory)).toBe(false);
          expect(yield* Effect.promise(() => NodeFSP.readdir(stateDir))).toEqual([
            "server-runtime.json",
          ]);
        }
      }),
    ),
  );
});

describe("supaterm app", () => {
  it.effect("rejects SSH before it tries to reach a desktop app", () =>
    withTempDirectory("supaterm-app-ssh-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-supaterm-home");
        const error = yield* runCli(["app", "--base-dir", baseDir], {
          SSH_CONNECTION: "client server",
        }).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "DesktopAppSshUnsupportedError",
          message:
            "`supaterm app` only controls a desktop app on the same machine. It cannot run over SSH.",
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("rejects unsupported platforms without creating state", () =>
    withTempDirectory("supaterm-app-platform-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-supaterm-home");
        const error = yield* runCli(["app", "--base-dir", baseDir]).pipe(
          Effect.provideService(HostProcess.Platform, "freebsd"),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: "DesktopAppPlatformUnsupportedError",
          platform: "freebsd",
          message: "`supaterm app` is not supported on freebsd.",
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("does not create state when only a server or no desktop app is running", () =>
    withTempDirectory("supaterm-app-missing-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-supaterm-home");
        const error = yield* runCli(["app", "--base-dir", baseDir]).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "DesktopAppUnreachableError",
          candidateAddresses: [expect.any(String)],
          workspaceRoot: yield* HostProcess.WorkingDirectory,
          message: expect.stringContaining("Could not reach the Supaterm desktop app."),
          cause: { code: "ENOENT" },
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("uses SUPATERM_HOME or --base-dir and sends the default or explicit path", () =>
    withTempDirectory("supaterm-app-command-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "supaterm-home");
        const explicitPath = NodePath.join(root, "project");
        const platform = yield* HostProcess.Platform;
        const workingDirectory = yield* HostProcess.WorkingDirectory;
        const desktop = yield* fakeDesktop({ baseDir });

        yield* runCli(["app"], { SUPATERM_HOME: baseDir });
        yield* runCli(["app", explicitPath, "--base-dir", baseDir]);

        expect(
          desktop.received.map((request) =>
            request.type === "open-workspace" ? request.workspaceRoot : null,
          ),
        ).toEqual([workingDirectory, explicitPath]);
        expect(
          desktop.received.every(
            (request) => request.type === "open-workspace" && request.platform === platform,
          ),
        ).toBe(true);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("prefers the installed desktop app when a dev desktop is also running", () =>
    withTempDirectory("supaterm-app-preferred-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, ".supaterm");
        const desktop = yield* fakeDesktop({ baseDir });
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        yield* runCli(["app"]);

        expect(desktop.received).toHaveLength(1);
        expect(development.received).toHaveLength(0);
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, root), Effect.scoped),
    ),
  );

  it.effect("finds the dev desktop when the default desktop socket is absent", () =>
    withTempDirectory("supaterm-app-dev-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, ".supaterm");
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        yield* runCli(["app"]);
        yield* runCli(["app"], { SUPATERM_HOME: "   " });

        expect(development.received).toHaveLength(2);
        expect(yield* pathExists(baseDir)).toBe(false);
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, root), Effect.scoped),
    ),
  );

  it.effect("never searches a dev state directory for an explicit Supaterm home", () =>
    withTempDirectory("supaterm-app-explicit-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, ".supaterm");
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        const flagError = yield* runCli(["app", "--base-dir", baseDir]).pipe(Effect.flip);
        const envError = yield* runCli(["app"], { SUPATERM_HOME: baseDir }).pipe(Effect.flip);

        expect(flagError).toMatchObject({ _tag: "DesktopAppUnreachableError" });
        expect(envError).toMatchObject({ _tag: "DesktopAppUnreachableError" });
        expect(development.received).toHaveLength(0);
      }).pipe(Effect.provideService(HostProcess.HomeDirectory, root), Effect.scoped),
    ),
  );

  it.effect.each(["failure", "invalid"] as const)(
    "never falls back after the default desktop sends a %s response",
    (responseKind) =>
      withTempDirectory("supaterm-app-response-test-", (root) =>
        Effect.gen(function* () {
          const baseDir = NodePath.join(root, ".supaterm");
          const desktop = yield* fakeDesktop({
            baseDir,
            reply: (request) =>
              responseKind === "failure"
                ? {
                    version: 1,
                    requestId: request.requestId,
                    ok: false,
                    code: "project-create-failed",
                    message: "The project path is not available.",
                  }
                : { invalid: true },
          });
          const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

          const error = yield* runCli(["app"]).pipe(Effect.flip);

          expect(desktop.received).toHaveLength(1);
          expect(development.received).toHaveLength(0);
          if (responseKind === "failure") {
            expect(error).toMatchObject({
              _tag: "DesktopAppRequestFailedError",
              code: "project-create-failed",
              requestId: desktop.received[0]?.requestId,
              workspaceRoot: yield* HostProcess.WorkingDirectory,
              message: expect.stringContaining("project-create-failed"),
              cause: {
                ok: false,
                code: "project-create-failed",
                message: "The project path is not available.",
              },
            });
          } else {
            expect(error).toMatchObject({
              _tag: "DesktopAppUnreachableError",
              cause: { message: "The desktop app response is invalid." },
            });
          }
        }).pipe(Effect.provideService(HostProcess.HomeDirectory, root), Effect.scoped),
      ),
  );
});

describe("desktop connection platform support", () => {
  it.effect("refuses to send pairing credentials to an unverified Windows pipe", () =>
    Effect.gen(function* () {
      const error = yield* runCli([
        "app",
        "connection",
        "add",
        "https://remote.example/pair#token=secret",
      ]).pipe(Effect.provideService(HostProcess.Platform, "win32"), Effect.flip);
      expect(error).toMatchObject({ _tag: "DesktopAppConnectionPlatformUnsupportedError" });
    }),
  );
});

describe.skipIf(HostProcess.Platform.defaultValue() === "win32")(
  "supaterm app connection add",
  () => {
    const pairingUrl = "https://remote.example/pair#token=secret-pairing-token";

    it.effect("sends pairing to the desktop and keeps credentials out of output", () =>
      withTempDirectory("supaterm-app-pair-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({
            baseDir,
            reply: (request) => ({
              version: 1,
              requestId: request.requestId,
              ok: true,
              result: "connection-added",
              environmentId: "remote-environment",
            }),
          });
          yield* runCli(["app", "connection", "add", pairingUrl, "--base-dir", baseDir]);
          expect(desktop.received).toEqual([
            {
              version: 1,
              requestId: expect.any(String),
              type: "add-connection",
              pairingUrl,
            },
          ]);
          const output = (yield* TestConsole.logLines).join("\n");
          expect(output).toContain("Connection is available in Supaterm (remote-environment).");
          expect(output).not.toContain("secret-pairing-token");
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("rejects a malformed link without contacting the desktop or exposing it", () =>
      withTempDirectory("supaterm-app-bad-pair-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({ baseDir });
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            "https://remote.example/pair#secret-pairing-token",
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DesktopAppPairingLinkInvalidError" });
          expect(JSON.stringify(error)).not.toContain("secret-pairing-token");
          expect(desktop.received).toHaveLength(0);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("rejects SSH sessions before contacting the desktop", () =>
      withTempDirectory("supaterm-app-pair-ssh-", (baseDir) =>
        Effect.gen(function* () {
          const error = yield* runCli(
            ["app", "connection", "add", pairingUrl, "--base-dir", baseDir],
            { SSH_TTY: "/dev/pts/1" },
          ).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DesktopAppSshUnsupportedError" });
        }),
      ),
    );

    it.effect.each([
      "invalid-request",
      "pairing-failed",
      "connection-save-failed",
      "request-timeout",
    ] as const)("reports a desktop %s response without claiming success", (code) =>
      withTempDirectory("supaterm-app-pair-fail-", (baseDir) =>
        Effect.gen(function* () {
          yield* fakeDesktop({
            baseDir,
            reply: (request) => ({
              version: 1,
              requestId: request.requestId,
              ok: false,
              code,
              message: "Could not complete request.",
            }),
          });
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            pairingUrl,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DesktopAppConnectionFailedError", code });
          if (code === "invalid-request") expect(String(error)).toContain("Update the desktop app");
          if (code === "request-timeout") expect(String(error)).toContain("may still finish");
          expect((yield* TestConsole.logLines).join("\n")).not.toContain("Connection is available");
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("rejects a workspace success response to a connection request", () =>
      withTempDirectory("supaterm-app-pair-wrong-", (baseDir) =>
        Effect.gen(function* () {
          yield* fakeDesktop({ baseDir });
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            pairingUrl,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "DesktopAppConnectionFailedError",
            code: "invalid-request",
          });
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("refuses a socket readable by other users without sending credentials", () =>
      withTempDirectory("supaterm-app-public-socket-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({ baseDir });
          yield* Effect.promise(() => NodeFSP.chmod(desktop.address, 0o660));
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            pairingUrl,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DesktopAppConnectionUnavailableError" });
          expect(desktop.received).toHaveLength(0);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("refuses a symlinked socket without sending credentials", () =>
      withTempDirectory("supaterm-app-symlink-socket-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({ baseDir });
          const realAddress = `${desktop.address}.real`;
          yield* Effect.acquireRelease(
            Effect.promise(async () => {
              await NodeFSP.rename(desktop.address, realAddress);
              await NodeFSP.symlink(realAddress, desktop.address);
            }),
            () =>
              Effect.promise(async () => {
                await NodeFSP.unlink(desktop.address);
                await NodeFSP.rename(realAddress, desktop.address);
              }),
          );
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            pairingUrl,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({ _tag: "DesktopAppConnectionUnavailableError" });
          expect(desktop.received).toHaveLength(0);
        }).pipe(Effect.scoped),
      ),
    );

    it.effect("refuses a socket owned by a different user without sending the link", () =>
      withTempDirectory("supaterm-app-untrusted-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({ baseDir });
          const error = yield* runCli([
            "app",
            "connection",
            "add",
            pairingUrl,
            "--base-dir",
            baseDir,
          ]).pipe(Effect.flip);
          expect(error).toMatchObject({
            _tag: "DesktopAppConnectionUnavailableError",
            cause: { message: "The desktop control socket is not private to the current user." },
          });
          expect(desktop.received).toHaveLength(0);
        }).pipe(Effect.provideService(HostProcess.UserId, Number.MAX_SAFE_INTEGER), Effect.scoped),
      ),
    );

    it.effect("opens a directory named connection with an explicit relative path", () =>
      withTempDirectory("supaterm-app-connection-dir-", (baseDir) =>
        Effect.gen(function* () {
          const desktop = yield* fakeDesktop({ baseDir });
          yield* runCli(["app", "./connection", "--base-dir", baseDir]);
          expect(desktop.received[0]).toMatchObject({
            type: "open-workspace",
            workspaceRoot: NodePath.resolve("connection"),
          });
        }).pipe(Effect.scoped),
      ),
    );
  },
);
