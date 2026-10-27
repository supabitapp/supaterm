// @effect-diagnostics nodeBuiltinImport:off -- the Keychain service name is a sha256 the CLI computes synchronously.
import * as NodeCrypto from "node:crypto";

import { TranscriptionError } from "@supaterm/contracts";
import { spawnAndCollect } from "@supaterm/provider-core/server/snapshotProbe";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";

const SECURITY = "/usr/bin/security";
const SECURITY_TIMEOUT = "2 seconds";
const KEYCHAIN_ITEM_NOT_FOUND = 44;
const KEYCHAIN_LOCKED = 36;
const ACCOUNT_PATTERN = /^[a-zA-Z0-9._-]+$/;

const Credentials = Schema.fromJsonString(
  Schema.Struct({
    claudeAiOauth: Schema.optional(
      Schema.Struct({
        accessToken: Schema.optional(Schema.String),
        expiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
      }),
    ),
  }),
);
const decodeCredentials = Schema.decodeUnknownOption(Credentials);

const hashSuffix = (directory: string) =>
  `-${NodeCrypto.createHash("sha256").update(directory.normalize("NFC")).digest("hex").slice(0, 8)}`;

/** The Keychain item the CLI stores its login in, for the environment it runs with. */
export function claudeKeychainService(environment: NodeJS.ProcessEnv): string {
  const secureStorageDir = environment.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  const configDir = environment.CLAUDE_CONFIG_DIR;
  const suffix =
    secureStorageDir !== undefined
      ? secureStorageDir
        ? hashSuffix(secureStorageDir)
        : ""
      : configDir
        ? hashSuffix(configDir)
        : "";
  return `Claude Code-credentials${suffix}`;
}

export function claudeKeychainAccount(
  environment: NodeJS.ProcessEnv,
  username: string | null,
): string {
  const account = environment.USER || username || "";
  return ACCOUNT_PATTERN.test(account) ? account : "claude-code-user";
}

const readKeychain = Effect.fnUntraced(function* (environment: NodeJS.ProcessEnv) {
  if ((yield* HostProcess.Platform) !== "darwin") return Option.none<string>();
  const account = claudeKeychainAccount(environment, yield* HostProcess.Username);
  const result = yield* spawnAndCollect(
    SECURITY,
    ChildProcess.make(SECURITY, [
      "find-generic-password",
      "-a",
      account,
      "-w",
      "-s",
      claudeKeychainService(environment),
    ]),
  ).pipe(Effect.scoped, Effect.timeoutOption(SECURITY_TIMEOUT), Effect.result);
  if (Result.isFailure(result)) return Option.none<string>();
  if (Option.isNone(result.success) || result.success.value.code === KEYCHAIN_LOCKED) {
    return yield* new TranscriptionError({ reason: "credentialsLocked" });
  }
  const { code, stdout } = result.success.value;
  if (code === 0) return Option.some(stdout);
  if (code !== KEYCHAIN_ITEM_NOT_FOUND) {
    yield* Effect.logWarning("Reading the Claude login from the Keychain failed.", {
      exitCode: code,
    });
  }
  return Option.none<string>();
});

/**
 * Reads the subscription login the way the Claude CLI does: its token
 * variable, then the macOS Keychain through `security` (the item trusts that
 * tool, so this never prompts), then `.credentials.json`. Only the CLI
 * refreshes the token, so an expired one means signing in again.
 */
export const readClaudeOAuthToken = Effect.fn("readClaudeOAuthToken")(function* (input: {
  /** The environment the instance's CLI runs with. */
  readonly environment: NodeJS.ProcessEnv;
  readonly configDir: string;
}) {
  const fromEnvironment = input.environment.CLAUDE_CODE_OAUTH_TOKEN?.trim();
  if (fromEnvironment) return fromEnvironment;

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const keychain = yield* readKeychain(input.environment);
  const stored = Option.isSome(keychain)
    ? keychain
    : yield* fileSystem
        .readFileString(path.join(input.configDir, ".credentials.json"))
        .pipe(Effect.option);

  const oauth = Option.getOrUndefined(
    Option.flatMap(stored, (value) => decodeCredentials(value.trim())),
  )?.claudeAiOauth;
  const accessToken = oauth?.accessToken?.trim();
  if (!accessToken) return yield* new TranscriptionError({ reason: "signedOut" });
  if (typeof oauth?.expiresAt === "number" && oauth.expiresAt <= (yield* Clock.currentTimeMillis)) {
    return yield* new TranscriptionError({ reason: "signedOut" });
  }
  return accessToken;
});
