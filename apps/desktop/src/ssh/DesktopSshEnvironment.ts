import type {
  DesktopDiscoveredSshHost,
  DesktopSshEnvironmentBootstrap,
  DesktopSshEnvironmentTarget,
} from "@supaterm/contracts";
import { CLI_RELEASE_BASE_URL_ENV } from "@supaterm/shared/cliRelease";
import * as NetService from "@supaterm/shared/Net";
import * as SshAuth from "@supaterm/ssh/auth";
import { resolveSshTarget } from "@supaterm/ssh/command";
import { discoverSshHosts } from "@supaterm/ssh/config";
import {
  SshCommandError,
  SshHostDiscoveryError,
  SshInvalidTargetError,
  SshLaunchError,
  SshPairingError,
  SshPasswordPromptError,
  SshReadinessError,
} from "@supaterm/ssh/errors";
import * as SshTunnel from "@supaterm/ssh/tunnel";
import * as Context from "effect/Context";
import type * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as HttpClient from "effect/http/HttpClient";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Option from "effect/Option";
import serverPackageJson from "../../../server/package.json" with { type: "json" };

import type * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

import * as DesktopSshPasswordPrompts from "./DesktopSshPasswordPrompts.ts";

export type DesktopSshEnvironmentRuntimeServices =
  | ChildProcessSpawner.ChildProcessSpawner
  | Digest.Digest
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | NetService.NetService;

export type DesktopSshEnvironmentOperationError =
  | SshCommandError
  | SshInvalidTargetError
  | SshLaunchError
  | SshPairingError
  | SshReadinessError
  | SshPasswordPromptError
  | NetService.NetError;

export type DesktopSshEnvironmentDiscoverError = SshHostDiscoveryError;

export class DesktopSshEnvironment extends Context.Service<
  DesktopSshEnvironment,
  {
    readonly discoverHosts: (input?: {
      readonly homeDir?: string;
    }) => Effect.Effect<readonly DesktopDiscoveredSshHost[], DesktopSshEnvironmentDiscoverError>;
    readonly resolveHost: (
      alias: string,
    ) => Effect.Effect<DesktopSshEnvironmentTarget, SshCommandError | SshInvalidTargetError>;
    readonly ensureEnvironment: (
      target: DesktopSshEnvironmentTarget,
      options?: { readonly issuePairingToken?: boolean },
    ) => Effect.Effect<DesktopSshEnvironmentBootstrap, DesktopSshEnvironmentOperationError>;
    readonly disconnectEnvironment: (
      target: DesktopSshEnvironmentTarget,
    ) => Effect.Effect<void, DesktopSshEnvironmentOperationError>;
    readonly closeAllTunnels: Effect.Effect<void>;
  }
>()("@supaterm/desktop/ssh/DesktopSshEnvironment") {}

export interface DesktopSshEnvironmentLayerOptions {
  readonly resolveCliRunner?: Effect.Effect<SshTunnel.RemoteSupatermRunnerOptions>;
  readonly resolveLauncherId?: Effect.Effect<string | null>;
}

export const resolveDesktopSshCliRunner = (
  environment: DesktopEnvironment.DesktopEnvironment["Service"],
  env: NodeJS.ProcessEnv,
) => {
  const devRemoteEntryPath = Option.getOrUndefined(environment.devRemoteSupatermServerEntryPath);
  if (environment.isDevelopment && devRemoteEntryPath !== undefined) {
    return {
      nodeScriptPath: devRemoteEntryPath,
      nodeEngineRange: serverPackageJson.engines.node,
    };
  }
  const releaseBaseUrl = env[CLI_RELEASE_BASE_URL_ENV]?.trim() || undefined;
  return {
    archiveVersion: environment.appVersion,
    ...(releaseBaseUrl === undefined ? {} : { releaseBaseUrl }),
  };
};

export const readOrCreateLauncherId = Effect.fn("desktop.ssh.readOrCreateLauncherId")(
  function* (filePath: string) {
    const fileSystem = yield* FileSystem.FileSystem;
    const random = yield* SecureRandom.SecureRandom;
    const stored = yield* fileSystem.readFileString(filePath).pipe(
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(""),
      ),
    );
    if (/^[0-9a-f]{32}$/u.test(stored.trim())) return stored.trim();
    const launcherId = (yield* random.uuidV4()).replace(/-/g, "");
    yield* fileSystem.writeFileString(filePath, `${launcherId}\n`);
    return launcherId;
  },
  Effect.orElseSucceed(() => null),
);

function discoverDesktopSshHostsEffect(input?: { readonly homeDir?: string }) {
  return discoverSshHosts(input ?? {});
}

export function isDesktopSshPasswordPromptCancellation(
  error: unknown,
): error is SshPasswordPromptError {
  return (
    error instanceof SshPasswordPromptError &&
    DesktopSshPasswordPrompts.isDesktopSshPasswordPromptCancellation(error.cause)
  );
}

function unexpectedPasswordPromptError(error: never): never {
  throw new Error(`Unhandled desktop SSH password prompt error: ${String(error)}`);
}

function toSshPasswordPromptError(
  cause: DesktopSshPasswordPrompts.DesktopSshPasswordPromptRequestError,
) {
  let message: string;
  switch (cause._tag) {
    case "DesktopSshPromptRequestIdGenerationError":
      message = "Secure randomness is unavailable.";
      break;
    case "DesktopSshPromptWindowUnavailableError":
    case "DesktopSshPromptPresentationError":
      message = "Supaterm window is not available for SSH authentication.";
      break;
    case "DesktopSshPromptTimedOutError":
      message = `SSH authentication timed out for ${cause.destination}.`;
      break;
    case "DesktopSshPromptCancelledError":
      message = `SSH authentication cancelled for ${cause.destination}.`;
      break;
    case "DesktopSshPromptWindowClosedError":
      message = "SSH authentication was cancelled because the app window closed.";
      break;
    case "DesktopSshPromptServiceStoppedError":
      message = "SSH password prompt service stopped.";
      break;
    default:
      return unexpectedPasswordPromptError(cause);
  }
  return new SshPasswordPromptError({ message, cause });
}

const makePasswordPrompt = (
  prompts: DesktopSshPasswordPrompts.DesktopSshPasswordPrompts["Service"],
) => ({
  isAvailable: true,
  request: (request: SshAuth.SshPasswordRequest) =>
    prompts.request(request).pipe(Effect.mapError(toSshPasswordPromptError)),
});

/** @public */
export const make = Effect.gen(function* () {
  const manager = yield* SshTunnel.SshEnvironmentManager;
  const prompts = yield* DesktopSshPasswordPrompts.DesktopSshPasswordPrompts;
  const runtimeContext = yield* Effect.context<DesktopSshEnvironmentRuntimeServices>();
  const passwordPrompt = SshAuth.SshPasswordPrompt.of(makePasswordPrompt(prompts));

  return DesktopSshEnvironment.of({
    discoverHosts: Effect.fn("desktop.ssh.discoverHosts")(function* (input) {
      return yield* discoverDesktopSshHostsEffect(input);
    }, Effect.provide(runtimeContext)),
    resolveHost: Effect.fn("desktop.ssh.resolveHost")(function* (alias) {
      return yield* resolveSshTarget(alias.trim());
    }, Effect.provide(runtimeContext)),
    ensureEnvironment: Effect.fn("desktop.ssh.ensureEnvironment")(
      function* (target, ensureOptions) {
        return yield* manager.ensureEnvironment(target, ensureOptions);
      },
      Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
      Effect.provide(runtimeContext),
    ),
    disconnectEnvironment: Effect.fn("desktop.ssh.disconnectEnvironment")(
      function* (target) {
        return yield* manager.disconnectEnvironment(target);
      },
      Effect.provideService(SshAuth.SshPasswordPrompt, passwordPrompt),
      Effect.provide(runtimeContext),
    ),
    closeAllTunnels: manager.closeAllTunnels,
  });
});

export const layer = (options: DesktopSshEnvironmentLayerOptions = {}) =>
  Layer.effect(DesktopSshEnvironment, make).pipe(
    Layer.provide(
      SshTunnel.SshEnvironmentManager.layer({
        ...(options.resolveCliRunner === undefined
          ? {}
          : { resolveCliRunner: options.resolveCliRunner }),
        ...(options.resolveLauncherId === undefined
          ? {}
          : { resolveLauncherId: options.resolveLauncherId }),
      }),
    ),
  );
