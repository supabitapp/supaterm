import {
  DICTATION_MAX_CLIP_BYTES,
  DICTATION_MAX_DURATION_MS,
  EnvironmentId,
  ORCHESTRATION_PROTOCOL_VERSION,
  PROVIDER_SEND_TURN_MAX_FILE_BYTES,
  type ExecutionEnvironmentDescriptor,
} from "@supaterm/contracts";
import * as HostProcess from "@supaterm/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import packageJson from "../../package.json" with { type: "json" };
import { resolveServerInstallation } from "../cli/invocation.ts";
import { resolveServerSelfUpdateCapability } from "../service/selfUpdate.ts";
import { resolveServiceLauncherMode } from "../service/serviceLauncherClient.ts";
import * as ServerConfig from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import { resolveServerEnvironmentLabel } from "./ServerEnvironmentLabel.ts";
import { detectServerEnvironmentMachineKind } from "./ServerEnvironmentMachine.ts";

export class ServerEnvironmentIdPersistenceError extends Schema.TaggedError<ServerEnvironmentIdPersistenceError>()(
  "ServerEnvironmentIdPersistenceError",
  {
    operation: Schema.Literals(["check", "read", "write", "initialize"]),
    environmentIdPath: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    if (this.operation === "initialize") {
      return `Server environment ID file is missing or empty after initialization at '${this.environmentIdPath}'.`;
    }
    return `Server environment ID ${this.operation} failed at '${this.environmentIdPath}'.`;
  }
}

export class ServerEnvironment extends Context.Service<
  ServerEnvironment,
  {
    readonly getEnvironmentId: Effect.Effect<EnvironmentId>;
    readonly getDescriptor: Effect.Effect<ExecutionEnvironmentDescriptor>;
  }
>()("supaterm/environment/ServerEnvironment") {}

export class ServerEnvironmentIdentity extends Context.Service<
  ServerEnvironmentIdentity,
  {
    readonly getEnvironmentId: Effect.Effect<EnvironmentId>;
  }
>()("supaterm/environment/ServerEnvironment/ServerEnvironmentIdentity") {}

function platformOs(platform: NodeJS.Platform): ExecutionEnvironmentDescriptor["platform"]["os"] {
  switch (platform) {
    case "darwin":
      return "darwin";
    case "linux":
      return "linux";
    case "win32":
      return "windows";
    default:
      return "unknown";
  }
}

function platformArch(
  architecture: NodeJS.Architecture,
): ExecutionEnvironmentDescriptor["platform"]["arch"] {
  switch (architecture) {
    case "arm64":
      return "arm64";
    case "x64":
      return "x64";
    default:
      return "other";
  }
}

const makeIdentity = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const crypto = yield* Crypto.Crypto;

  const readPersistedEnvironmentId = Effect.gen(function* () {
    const exists = yield* fileSystem.exists(serverConfig.environmentIdPath).pipe(
      Effect.mapError(
        (cause) =>
          new ServerEnvironmentIdPersistenceError({
            operation: "check",
            environmentIdPath: serverConfig.environmentIdPath,
            cause,
          }),
      ),
    );
    if (!exists) {
      return null;
    }

    const raw = yield* fileSystem.readFileString(serverConfig.environmentIdPath).pipe(
      Effect.map((value) => value.trim()),
      Effect.mapError(
        (cause) =>
          new ServerEnvironmentIdPersistenceError({
            operation: "read",
            environmentIdPath: serverConfig.environmentIdPath,
            cause,
          }),
      ),
    );

    return raw.length > 0 ? raw : null;
  });

  const persistEnvironmentId = Effect.fn("ServerEnvironmentIdentity.persistEnvironmentId")(
    function* (value: string, mode: "create" | "recover") {
      const destinationPath =
        mode === "recover"
          ? `${serverConfig.environmentIdPath}.recovery`
          : serverConfig.environmentIdPath;
      const tempPath = yield* fileSystem.makeTempFileScoped({
        directory: serverConfig.stateDir,
        prefix: ".environment-id-",
      });
      yield* fileSystem.writeFileString(tempPath, `${value}\n`);
      // Publish the completed file without replacing an ID created by another process.
      yield* fileSystem.link(tempPath, destinationPath).pipe(
        Effect.catchIf(
          (cause) => cause.reason._tag === "AlreadyExists",
          () => Effect.void,
        ),
      );
      if (mode === "recover") {
        // Keep the recovery ID so delayed initializers also publish the same winner.
        yield* fileSystem.remove(tempPath);
        yield* fileSystem.copyFile(destinationPath, tempPath);
        yield* fileSystem.rename(tempPath, serverConfig.environmentIdPath);
      }
    },
    Effect.scoped,
    Effect.mapError(
      (cause) =>
        new ServerEnvironmentIdPersistenceError({
          operation: "write",
          environmentIdPath: serverConfig.environmentIdPath,
          cause,
        }),
    ),
  );

  const environmentIdRaw = yield* Effect.gen(function* () {
    const persisted = yield* readPersistedEnvironmentId;
    if (persisted) {
      return persisted;
    }

    const generated = yield* crypto.randomUUIDv4();
    yield* persistEnvironmentId(generated, "create");
    let winner = yield* readPersistedEnvironmentId;
    if (winner === null) {
      yield* persistEnvironmentId(generated, "recover");
      winner = yield* readPersistedEnvironmentId;
    }
    if (winner === null) {
      return yield* new ServerEnvironmentIdPersistenceError({
        operation: "initialize",
        environmentIdPath: serverConfig.environmentIdPath,
      });
    }
    return winner;
  });

  const environmentId = EnvironmentId.make(environmentIdRaw);
  return ServerEnvironmentIdentity.of({
    getEnvironmentId: Effect.succeed(environmentId),
  });
});

/** @public */
export const make = Effect.gen(function* () {
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const identity = yield* ServerEnvironmentIdentity;
  const hostPlatform = yield* HostProcess.Platform;
  const hostArchitecture = yield* HostProcess.Architecture;
  const environmentId = yield* identity.getEnvironmentId;
  const cwdBaseName = path.basename(serverConfig.cwd).trim();
  const label = yield* resolveServerEnvironmentLabel({ cwdBaseName });
  const machine = yield* detectServerEnvironmentMachineKind();
  const launcher = yield* resolveServiceLauncherMode();
  const serverSelfUpdate = resolveServerSelfUpdateCapability({
    desktopManaged: serverConfig.mode === "desktop",
    launcherManaged: launcher.managed,
  });
  const serverInstallation = serverSelfUpdate === null ? yield* resolveServerInstallation : null;
  // Static is correct: the control fd is known at bootstrap, and the desktop
  // app and its bundled server ship in one artifact, so a present fd means the
  // app speaks the requestDesktopUpdate protocol.

  const desktopAppUpdate =
    serverSelfUpdate === "desktop-managed" && serverConfig.desktopTelemetryControlFd !== undefined;

  const descriptor: ExecutionEnvironmentDescriptor = {
    environmentId,
    label,
    platform: {
      os: platformOs(hostPlatform),
      arch: platformArch(hostArchitecture),
      ...(machine === null ? {} : { machine }),
    },
    serverVersion: packageJson.version,
    orchestrationProtocolVersion: ORCHESTRATION_PROTOCOL_VERSION,
    capabilities: {
      fileAttachments: { maxUploadBytes: PROVIDER_SEND_TURN_MAX_FILE_BYTES },
      threadStop: true,
      ignoredFileListing: true,
      ...(serverSelfUpdate === null ? {} : { serverSelfUpdate }),
      ...(serverInstallation === null ? {} : { serverInstallation }),
      ...(serverSelfUpdate === "boot-service" || desktopAppUpdate
        ? { serverSelfUpdateProgress: true }
        : {}),
      ...(desktopAppUpdate ? { desktopAppUpdate: true } : {}),
      dictation: {
        maxClipBytes: DICTATION_MAX_CLIP_BYTES,
        maxDurationMs: DICTATION_MAX_DURATION_MS,
      },
    },
  };

  return ServerEnvironment.of({
    getEnvironmentId: Effect.succeed(environmentId),
    getDescriptor: Effect.succeed(descriptor),
  });
});

export const layerIdentity = Layer.effect(ServerEnvironmentIdentity, makeIdentity);

/**
 * ServerEnvironment is acquired from persisted filesystem and host-process
 * state. It intentionally has no fallback Layer.succeed value: callers must
 * provide the external platform services and a ServerConfig.
 */
export const layer = Layer.effect(ServerEnvironment, make).pipe(
  Layer.provideMerge(layerIdentity),
  Layer.provide(ProcessRunner.layer),
);
