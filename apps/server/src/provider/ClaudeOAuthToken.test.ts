import * as NodeServices from "@effect/platform-node/NodeServices";
import * as HostProcess from "@supaterm/shared/HostProcess";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { ChildProcessSpawner } from "effect/process";

import {
  claudeKeychainAccount,
  claudeKeychainService,
  readClaudeOAuthToken,
} from "./ClaudeOAuthToken.ts";

const credentials = (accessToken: string, expiresAt?: number) =>
  JSON.stringify({ claudeAiOauth: { accessToken, ...(expiresAt ? { expiresAt } : {}) } });

const securityProcess = (result: {
  readonly code: number;
  readonly stdout?: string;
  readonly exitCode?: Effect.Effect<ChildProcessSpawner.ExitCode>;
}) =>
  Effect.gen(function* () {
    const commands = yield* Ref.make<ReadonlyArray<ReadonlyArray<string>>>([]);
    const spawner = ChildProcessSpawner.make((command) =>
      Ref.update(commands, (current) => [
        ...current,
        [
          (command as { command: string }).command,
          ...(command as { args: ReadonlyArray<string> }).args,
        ],
      ]).pipe(
        Effect.as(
          ChildProcessSpawner.makeHandle({
            pid: ChildProcessSpawner.ProcessId(1),
            exitCode: result.exitCode ?? Effect.succeed(ChildProcessSpawner.ExitCode(result.code)),
            isRunning: Effect.succeed(false),
            kill: () => Effect.void,
            unref: Effect.succeed(Effect.void),
            stdin: Sink.drain,
            stdout: Stream.encodeText(Stream.make(result.stdout ?? "")),
            stderr: Stream.empty,
            all: Stream.empty,
            getInputFd: () => Sink.drain,
            getOutputFd: () => Stream.empty,
          }),
        ),
      ),
    );
    return { commands, spawner };
  });

const configDirWith = (contents: string | undefined) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const configDir = yield* fs.makeTempDirectoryScoped();
    if (contents !== undefined) {
      yield* fs.writeFileString(path.join(configDir, ".credentials.json"), contents);
    }
    return configDir;
  });

const readOn = (
  platform: NodeJS.Platform,
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
  input: Parameters<typeof readClaudeOAuthToken>[0],
) =>
  readClaudeOAuthToken(input).pipe(
    Effect.provideService(HostProcess.Platform, platform),
    Effect.provideService(HostProcess.Username, "khoi"),
    Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner),
  );

describe("claudeKeychainService", () => {
  it("matches the CLI's item name for each config directory setup", () => {
    expect(claudeKeychainService({})).toBe("Claude Code-credentials");
    expect(claudeKeychainService({ CLAUDE_CONFIG_DIR: "/Users/khoi/.claude-work" })).toBe(
      "Claude Code-credentials-5c87cf20",
    );
    expect(claudeKeychainService({ CLAUDE_CONFIG_DIR: "/tmp/café" })).toBe(
      claudeKeychainService({ CLAUDE_CONFIG_DIR: "/tmp/café" }),
    );
    expect(
      claudeKeychainService({ CLAUDE_CONFIG_DIR: "/a", CLAUDE_SECURESTORAGE_CONFIG_DIR: "" }),
    ).toBe("Claude Code-credentials");
    expect(
      claudeKeychainService({ CLAUDE_CONFIG_DIR: "/a", CLAUDE_SECURESTORAGE_CONFIG_DIR: "/b" }),
    ).toBe("Claude Code-credentials-9812b0b9");
  });
});

describe("claudeKeychainAccount", () => {
  it("uses USER, then the OS user, and the CLI's fallback for unusual names", () => {
    expect(claudeKeychainAccount({ USER: "dev" }, "khoi")).toBe("dev");
    expect(claudeKeychainAccount({}, "khoi")).toBe("khoi");
    expect(claudeKeychainAccount({}, "Khôi Nguyễn")).toBe("claude-code-user");
    expect(claudeKeychainAccount({}, null)).toBe("claude-code-user");
  });
});

describe("readClaudeOAuthToken", () => {
  it.effect("prefers the CLI's token variable without touching the Keychain", () =>
    Effect.gen(function* () {
      const { commands, spawner } = yield* securityProcess({ code: 0 });
      const configDir = yield* configDirWith(credentials("from-file"));
      expect(
        yield* readOn("darwin", spawner, {
          environment: { CLAUDE_CODE_OAUTH_TOKEN: " setup-token " },
          configDir,
        }),
      ).toBe("setup-token");
      expect(yield* Ref.get(commands)).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads the Keychain item through security on macOS", () =>
    Effect.gen(function* () {
      const { commands, spawner } = yield* securityProcess({
        code: 0,
        stdout: `${credentials("from-keychain")}\n`,
      });
      const configDir = yield* configDirWith(credentials("from-file"));
      expect(yield* readOn("darwin", spawner, { environment: { USER: "khoi" }, configDir })).toBe(
        "from-keychain",
      );
      expect(yield* Ref.get(commands)).toEqual([
        [
          "/usr/bin/security",
          "find-generic-password",
          "-a",
          "khoi",
          "-w",
          "-s",
          "Claude Code-credentials",
        ],
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("falls back to .credentials.json when the Keychain has no item", () =>
    Effect.gen(function* () {
      const { spawner } = yield* securityProcess({ code: 44 });
      const configDir = yield* configDirWith(credentials("from-file"));
      expect(yield* readOn("darwin", spawner, { environment: {}, configDir })).toBe("from-file");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reports a locked keychain instead of a sign-out", () =>
    Effect.gen(function* () {
      const { spawner } = yield* securityProcess({ code: 36 });
      const configDir = yield* configDirWith(credentials("from-file"));
      const error = yield* Effect.flip(readOn("darwin", spawner, { environment: {}, configDir }));
      expect(error.reason).toBe("credentialsLocked");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("reads only the file on other platforms", () =>
    Effect.gen(function* () {
      const { commands, spawner } = yield* securityProcess({ code: 0 });
      const configDir = yield* configDirWith(credentials("from-file"));
      expect(yield* readOn("linux", spawner, { environment: {}, configDir })).toBe("from-file");
      expect(yield* Ref.get(commands)).toHaveLength(0);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("signs out when there is no login or it has expired", () =>
    Effect.gen(function* () {
      const { spawner } = yield* securityProcess({ code: 44 });
      yield* TestClock.setTime(Date.parse("2026-10-27T12:00:00.000Z"));
      for (const contents of [
        undefined,
        "{}",
        credentials("old", Date.parse("2026-10-27T11:00:00.000Z")),
      ]) {
        const configDir = yield* configDirWith(contents);
        const error = yield* Effect.flip(readOn("linux", spawner, { environment: {}, configDir }));
        expect(error.reason).toBe("signedOut");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
