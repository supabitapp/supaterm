// @effect-diagnostics nodeBuiltinImport:off -- Socket trust checks need native lstat ownership, permissions, and socket-type metadata before writing credentials.
// @effect-diagnostics globalTimers:off -- The Node socket client owns its response deadline and clears it on every completion path.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";

import {
  DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
  DESKTOP_APP_ACTIVATION_TIMEOUT_MS,
  DesktopAppActivationSuccess,
  DesktopAppConnectionAdded,
  DesktopAppActivationErrorCode,
  DesktopAppActivationResponse,
  type DesktopAppActivationPlatform,
  type DesktopAppActivationRequest,
} from "@supaterm/contracts";
import { resolveRemotePairingTarget } from "@supaterm/shared/remote";
import { resolveDesktopAppControlAddress } from "@supaterm/shared/desktopAppControl";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Argument, Command } from "effect/cli";

import { expandHomePath, resolveBaseDir } from "../os-jank.ts";
import { baseDirFlag } from "./config.ts";

const CLI_RESPONSE_MARGIN_MS = 2_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const isDesktopAppActivationResponse = Schema.is(DesktopAppActivationResponse);
const isWorkspaceOpened = Schema.is(DesktopAppActivationSuccess);
const isConnectionAdded = Schema.is(DesktopAppConnectionAdded);

export class DesktopAppSshUnsupportedError extends Schema.TaggedError<DesktopAppSshUnsupportedError>()(
  "DesktopAppSshUnsupportedError",
  {},
) {
  override get message(): string {
    return "`supaterm app` only controls a desktop app on the same machine. It cannot run over SSH.";
  }
}

export class DesktopAppPlatformUnsupportedError extends Schema.TaggedError<DesktopAppPlatformUnsupportedError>()(
  "DesktopAppPlatformUnsupportedError",
  { platform: Schema.String },
) {
  override get message(): string {
    return `\`supaterm app\` is not supported on ${this.platform}.`;
  }
}

export class DesktopAppUnreachableError extends Schema.TaggedError<DesktopAppUnreachableError>()(
  "DesktopAppUnreachableError",
  {
    candidateAddresses: Schema.Array(Schema.String),
    requestId: Schema.String,
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Could not reach the Supaterm desktop app. Start or update the desktop app on this machine, then run `supaterm app` again. A running Supaterm server is not enough.";
  }
}

export class DesktopAppRequestFailedError extends Schema.TaggedError<DesktopAppRequestFailedError>()(
  "DesktopAppRequestFailedError",
  {
    code: DesktopAppActivationErrorCode,
    requestId: Schema.String,
    workspaceRoot: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Supaterm could not open ${this.workspaceRoot} (${this.code}).`;
  }
}

export class DesktopAppConnectionUnavailableError extends Schema.TaggedError<DesktopAppConnectionUnavailableError>()(
  "DesktopAppConnectionUnavailableError",
  { requestId: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not complete the connection request. Start or update the desktop app on this machine. If pairing already started, it may still finish; check Settings → Connections before retrying.";
  }
}

export class DesktopAppConnectionFailedError extends Schema.TaggedError<DesktopAppConnectionFailedError>()(
  "DesktopAppConnectionFailedError",
  { requestId: Schema.String, code: DesktopAppActivationErrorCode, cause: Schema.Defect() },
) {
  override get message(): string {
    switch (this.code) {
      case "invalid-request":
        return "This Supaterm desktop app cannot add connections from the command line. Update the desktop app.";
      case "renderer-unavailable":
        return "The desktop window is unavailable. Wait for the app to finish starting and try again.";
      case "request-timeout":
        return "The connection request timed out. It may still finish; check Settings → Connections before retrying.";
      case "connection-save-failed":
        return "Supaterm could not save the connection. Check secure storage and try pairing again.";
      case "pairing-failed":
        return "Supaterm could not pair with the environment. Check its address and use a fresh pairing link.";
      default:
        return "Supaterm could not complete the connection request. Check Settings → Connections before retrying.";
    }
  }
}

export class DesktopAppPairingLinkInvalidError extends Schema.TaggedError<DesktopAppPairingLinkInvalidError>()(
  "DesktopAppPairingLinkInvalidError",
  {},
) {
  override get message(): string {
    return "The pairing link is invalid. Use the full URL from Settings → Connections or `supaterm pair`.";
  }
}

export class DesktopAppConnectionPlatformUnsupportedError extends Schema.TaggedError<DesktopAppConnectionPlatformUnsupportedError>()(
  "DesktopAppConnectionPlatformUnsupportedError",
  {},
) {
  override get message(): string {
    return "Adding connections from the command line requires macOS or Linux. On Windows, paste the pairing link in Settings → Connections.";
  }
}

async function verifyDesktopAppControlSocket(address: string, userId: number | undefined) {
  if (userId === undefined) throw new Error("Could not verify the desktop socket owner.");
  const [directory, socket] = await Promise.all([
    NodeFSP.lstat(NodePath.dirname(address)),
    NodeFSP.lstat(address),
  ]);
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    directory.uid !== userId ||
    (directory.mode & 0o077) !== 0 ||
    !socket.isSocket() ||
    socket.isSymbolicLink() ||
    socket.uid !== userId ||
    (socket.mode & 0o077) !== 0
  ) {
    throw new Error("The desktop control socket is not private to the current user.");
  }
}

function isDesktopPlatform(platform: NodeJS.Platform): platform is DesktopAppActivationPlatform {
  return platform === "darwin" || platform === "linux" || platform === "win32";
}

function sendDesktopAppActivationRequest(input: {
  readonly address: string;
  readonly fallbackAddress?: string;
  readonly request: DesktopAppActivationRequest;
  readonly timeoutMs: number;
  readonly verifyEndpoint?: (address: string) => Promise<void>;
}): Promise<DesktopAppActivationResponse> {
  return new Promise((resolve, reject) => {
    const socket = NodeNet.createConnection(input.address);
    socket.setEncoding("utf8");
    let buffer = "";
    let settled = false;
    let connected = false;

    const finish = (
      result:
        | { readonly type: "success"; readonly response: DesktopAppActivationResponse }
        | { readonly type: "failure"; readonly error: Error },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      if (result.type === "success") resolve(result.response);
      else reject(result.error);
    };

    const timeout = setTimeout(() => {
      finish({
        type: "failure",
        error: new Error("The desktop app did not respond in time."),
      });
    }, input.timeoutMs);

    socket.once("connect", () => {
      connected = true;
      void (input.verifyEndpoint?.(input.address) ?? Promise.resolve()).then(
        () => {
          if (!settled) socket.write(`${JSON.stringify(input.request)}\n`);
        },
        (error: Error) => finish({ type: "failure", error }),
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({ type: "failure", error: new Error("The desktop app response is too large.") });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(buffer.slice(0, newline));
      } catch {
        finish({
          type: "failure",
          error: new Error("The desktop app response is not valid JSON."),
        });
        return;
      }
      if (!isDesktopAppActivationResponse(parsed)) {
        finish({ type: "failure", error: new Error("The desktop app response is invalid.") });
        return;
      }
      if (parsed.requestId !== input.request.requestId) {
        finish({
          type: "failure",
          error: new Error("The desktop app response did not match this request."),
        });
        return;
      }
      finish({ type: "success", response: parsed });
    });
    socket.once("error", (error: NodeJS.ErrnoException) => {
      if (
        !settled &&
        !connected &&
        input.fallbackAddress !== undefined &&
        (error.code === "ENOENT" || error.code === "ECONNREFUSED")
      ) {
        settled = true;
        clearTimeout(timeout);
        socket.destroy();
        resolve(
          sendDesktopAppActivationRequest({
            address: input.fallbackAddress,
            request: input.request,
            timeoutMs: input.timeoutMs,
            ...(input.verifyEndpoint === undefined ? {} : { verifyEndpoint: input.verifyEndpoint }),
          }),
        );
        return;
      }
      finish({ type: "failure", error });
    });
    socket.once("end", () => {
      finish({ type: "failure", error: new Error("The desktop app closed the connection.") });
    });
  });
}

const appEnvironment = Config.all({
  supatermHome: Config.String("SUPATERM_HOME").pipe(
    Config.option,
    Config.map(Option.getOrUndefined),
  ),
  sshConnection: Config.String("SSH_CONNECTION").pipe(Config.option),
  sshTty: Config.String("SSH_TTY").pipe(Config.option),
});

const resolveDesktopApp = Effect.fn("cli.app.resolveDesktopApp")(function* (
  baseDirFlagValue: Option.Option<string>,
) {
  const environment = yield* appEnvironment;
  const hostPlatform = yield* HostProcess.Platform;
  if (Option.isSome(environment.sshConnection) || Option.isSome(environment.sshTty)) {
    return yield* new DesktopAppSshUnsupportedError({});
  }
  if (!isDesktopPlatform(hostPlatform)) {
    return yield* new DesktopAppPlatformUnsupportedError({ platform: hostPlatform });
  }

  const path = yield* Path.Path;
  const configuredBaseDir = Option.getOrUndefined(baseDirFlagValue) ?? environment.supatermHome;
  const baseDir = yield* resolveBaseDir(configuredBaseDir);
  const allowDevFallback = Option.isNone(baseDirFlagValue) && !environment.supatermHome?.trim();
  const userId = yield* HostProcess.UserId;
  const resolveAddress = (stateSubdirectory: "userdata" | "dev") =>
    resolveDesktopAppControlAddress({
      stateDir: path.join(baseDir, stateSubdirectory),
      platform: hostPlatform,
      tempDir: NodeOS.tmpdir(),
      userId,
      joinPath: path.join,
    }).address;
  const crypto = yield* Crypto.Crypto;
  const requestId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
  const address = resolveAddress("userdata");
  const fallbackAddress = allowDevFallback ? resolveAddress("dev") : undefined;
  return {
    platform: hostPlatform,
    requestId,
    address,
    ...(fallbackAddress === undefined ? {} : { fallbackAddress }),
  };
});

const runAppCommand = Effect.fn("cli.app")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly workspaceRoot: Option.Option<string>;
}) {
  const desktop = yield* resolveDesktopApp(flags.baseDir);
  const path = yield* Path.Path;
  const rawWorkspaceRoot =
    Option.getOrUndefined(flags.workspaceRoot) ?? (yield* HostProcess.WorkingDirectory);
  const workspaceRoot = path.resolve(yield* expandHomePath(rawWorkspaceRoot));
  const response = yield* Effect.tryPromise({
    try: () =>
      sendDesktopAppActivationRequest({
        ...desktop,
        timeoutMs: DESKTOP_APP_ACTIVATION_TIMEOUT_MS["open-workspace"] + CLI_RESPONSE_MARGIN_MS,
        request: {
          version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
          requestId: desktop.requestId,
          type: "open-workspace",
          workspaceRoot,
          platform: desktop.platform,
        },
      }),
    catch: (cause) =>
      new DesktopAppUnreachableError({
        candidateAddresses:
          desktop.fallbackAddress === undefined
            ? [desktop.address]
            : [desktop.address, desktop.fallbackAddress],
        requestId: desktop.requestId,
        workspaceRoot,
        cause,
      }),
  });
  if (!response.ok) {
    return yield* new DesktopAppRequestFailedError({
      code: response.code,
      requestId: response.requestId,
      workspaceRoot,
      cause: response,
    });
  }
  if (!isWorkspaceOpened(response)) {
    return yield* new DesktopAppRequestFailedError({
      code: "invalid-request",
      requestId: response.requestId,
      workspaceRoot,
      cause: response,
    });
  }
  yield* Console.log(`Opened ${workspaceRoot} in Supaterm.`);
});

const addConnectionCommand = Command.make("add", {
  baseDir: baseDirFlag,
  pairingUrl: Argument.String("pairing-link").pipe(
    Argument.withDescription("Full pairing URL from Settings → Connections or `supaterm pair`."),
  ),
}).pipe(
  Command.withDescription("Pair and save a connection in the running local desktop app."),
  Command.withHandler(
    Effect.fn("cli.app.connection.add")(function* (flags) {
      const pairingUrl = flags.pairingUrl.trim();
      yield* Effect.try({
        try: () => resolveRemotePairingTarget({ pairingUrl }),
        catch: () => new DesktopAppPairingLinkInvalidError({}),
      });
      const platform = yield* HostProcess.Platform;
      if (platform === "win32") return yield* new DesktopAppConnectionPlatformUnsupportedError({});
      const desktop = yield* resolveDesktopApp(flags.baseDir);
      const userId = yield* HostProcess.UserId;
      const response = yield* Effect.tryPromise({
        try: () =>
          sendDesktopAppActivationRequest({
            ...desktop,
            timeoutMs: DESKTOP_APP_ACTIVATION_TIMEOUT_MS["add-connection"] + CLI_RESPONSE_MARGIN_MS,
            verifyEndpoint: (address) => verifyDesktopAppControlSocket(address, userId),
            request: {
              version: DESKTOP_APP_ACTIVATION_PROTOCOL_VERSION,
              requestId: desktop.requestId,
              type: "add-connection",
              pairingUrl,
            },
          }),
        catch: (cause) =>
          new DesktopAppConnectionUnavailableError({ requestId: desktop.requestId, cause }),
      });
      if (!response.ok) {
        return yield* new DesktopAppConnectionFailedError({
          code: response.code,
          requestId: response.requestId,
          cause: response,
        });
      }
      if (!isConnectionAdded(response)) {
        return yield* new DesktopAppConnectionFailedError({
          code: "invalid-request",
          requestId: response.requestId,
          cause: response,
        });
      }
      yield* Console.log(`Connection is available in Supaterm (${response.environmentId}).`);
    }),
  ),
);

const connectionCommand = Command.make("connection").pipe(
  Command.withDescription("Manage connections in the running local desktop app."),
  Command.withSubcommands([addConnectionCommand]),
);

export const appCommand = Command.make("app", {
  baseDir: baseDirFlag,
  workspaceRoot: Argument.String("path").pipe(
    Argument.withDescription("Project directory. Default: current directory."),
    Argument.optional,
  ),
}).pipe(
  Command.withDescription("Open a project or manage connections in the running local desktop app."),
  Command.withHandler(runAppCommand),
  Command.withSubcommands([connectionCommand]),
);
