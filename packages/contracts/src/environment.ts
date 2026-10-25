import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import {
  EnvironmentId,
  ForwardCompatibleOptional,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";

export const ORCHESTRATION_PROTOCOL_VERSION = 2;
export const ORCHESTRATION_PROTOCOL_VERSION_TEXT = "2";
export const ORCHESTRATION_PROTOCOL_QUERY_PARAM = "orchestrationProtocol";
export const ORCHESTRATION_PROTOCOL_HEADER = "x-supaterm-orchestration-protocol";

export const ExecutionEnvironmentPlatformOs = Schema.Literals([
  "darwin",
  "linux",
  "windows",
  "unknown",
]);
export type ExecutionEnvironmentPlatformOs = typeof ExecutionEnvironmentPlatformOs.Type;

export const ExecutionEnvironmentPlatformArch = Schema.Literals(["arm64", "x64", "other"]);
export type ExecutionEnvironmentPlatformArch = typeof ExecutionEnvironmentPlatformArch.Type;

export const ENVIRONMENT_MACHINE_KINDS = [
  "server",
  "cloud",
  "linux",
  "desktop",
  "laptop",
  "mac-mini",
  "mac-studio",
] as const;
export const EnvironmentMachineKind = Schema.Literals(ENVIRONMENT_MACHINE_KINDS);
export type EnvironmentMachineKind = typeof EnvironmentMachineKind.Type;
export const isEnvironmentMachineKind = Schema.is(EnvironmentMachineKind);

export const ExecutionEnvironmentPlatform = Schema.Struct({
  os: ExecutionEnvironmentPlatformOs.pipe(
    Schema.catchDecoding(() => Effect.succeedSome("unknown" as const)),
  ),
  arch: ExecutionEnvironmentPlatformArch.pipe(
    Schema.catchDecoding(() => Effect.succeedSome("other" as const)),
  ),
  machine: ForwardCompatibleOptional(EnvironmentMachineKind),
});

/**
 * Lives here (not settings.ts) so orchestration contracts can reference it
 * without an import cycle.
 */
export const ThreadEnvMode = Schema.Literals(["local", "worktree"]);
export type ThreadEnvMode = typeof ThreadEnvMode.Type;

export const WorktreeSubmodules = Schema.Literals(["recursive", "top-level", "none"]);
export type WorktreeSubmodules = typeof WorktreeSubmodules.Type;
export type ExecutionEnvironmentPlatform = typeof ExecutionEnvironmentPlatform.Type;

/** How a server can replace itself with another version when asked over RPC.
    "boot-service" restarts through the launcher-backed boot service.
    "desktop-app" means the supervising desktop app updated and relaunched
    itself, bringing the server back with it. */
export const ServerSelfUpdateMethod = Schema.Literals(["boot-service", "desktop-app"]);
export type ServerSelfUpdateMethod = typeof ServerSelfUpdateMethod.Type;

export const ServerInstallation = Schema.Union([
  Schema.Struct({ kind: Schema.Literals(["npx", "pnpm-dlx", "bunx"]) }),
  Schema.Struct({ kind: Schema.Literal("npm-global"), prefix: TrimmedNonEmptyString }),
]);
export type ServerInstallation = typeof ServerInstallation.Type;

export const ServerSelfUpdateCapability = Schema.Literals(["boot-service", "desktop-managed"]);
export type ServerSelfUpdateCapability = typeof ServerSelfUpdateCapability.Type;

export const ExecutionEnvironmentCapabilities = Schema.Struct({
  /** Largest file a client may upload for a turn. */
  fileAttachments: Schema.optionalKey(
    Schema.Struct({
      maxUploadBytes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    }),
  ),
  /** The update path clients should offer for this server. Absent on
      servers that must be relaunched manually (dev checkouts, Windows
      foreground runs). */
  serverSelfUpdate: ForwardCompatibleOptional(ServerSelfUpdateCapability),
  threadStop: Schema.optionalKey(Schema.Boolean),
  /** The server accepts queued-run.start, which sends one held message now. */
  queuedRunStart: Schema.optionalKey(Schema.Boolean),
  /** Manual commands must update this install, not the host's default global prefix. */
  serverInstallation: ForwardCompatibleOptional(ServerInstallation),
  serverSelfUpdateProgress: Schema.optionalKey(Schema.Boolean),
  ignoredFileListing: Schema.optionalKey(Schema.Boolean),
  /** thread.fork accepts sideChat and the live source point. Older servers
      would drop sideChat and create an ordinary fork. */
  sideChats: Schema.optionalKey(Schema.Boolean),
  /** The desktop app supervising this server can be driven over RPC:
      server.updateServer runs its check -> download -> relaunch. Absent on
      servers the desktop app does not supervise, where clients tell the user
      to update the app on that machine. */
  desktopAppUpdate: Schema.optionalKey(Schema.Boolean),
});
export type ExecutionEnvironmentCapabilities = typeof ExecutionEnvironmentCapabilities.Type;

/**
 * Clients decode this before comparing protocol versions, so its closed sets must read a newer
 * server's values instead of failing: a decode failure here hides the "update" message.
 */
export const ExecutionEnvironmentDescriptor = Schema.Struct({
  environmentId: EnvironmentId,
  label: TrimmedNonEmptyString,
  platform: ExecutionEnvironmentPlatform,
  serverVersion: TrimmedNonEmptyString,
  orchestrationProtocolVersion: Schema.Int,
  relayEndpoint: Schema.optionalKey(Schema.String),
  relayUrl: Schema.optionalKey(Schema.String),
  capabilities: ExecutionEnvironmentCapabilities,
});
export type ExecutionEnvironmentDescriptor = typeof ExecutionEnvironmentDescriptor.Type;

export const RepositoryIdentityLocator = Schema.Struct({
  source: Schema.Literal("git-remote"),
  remoteName: TrimmedNonEmptyString,
  remoteUrl: TrimmedNonEmptyString,
});
export type RepositoryIdentityLocator = typeof RepositoryIdentityLocator.Type;

export const RepositoryOrigin = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  remoteUrl: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
});
export type RepositoryOrigin = typeof RepositoryOrigin.Type;

export const RepositoryIdentity = Schema.Struct({
  canonicalKey: TrimmedNonEmptyString,
  locator: RepositoryIdentityLocator,
  webUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** Work tree root, or the git dir for a bare repository. */
  rootPath: Schema.optionalKey(TrimmedNonEmptyString),
  displayName: Schema.optionalKey(TrimmedNonEmptyString),
  provider: Schema.optionalKey(TrimmedNonEmptyString),
  owner: Schema.optionalKey(TrimmedNonEmptyString),
  name: Schema.optionalKey(TrimmedNonEmptyString),
  origin: Schema.optionalKey(RepositoryOrigin),
});
export type RepositoryIdentity = typeof RepositoryIdentity.Type;

export function repositoryGroupingKeyOf(identity: RepositoryIdentity): string {
  return identity.origin?.canonicalKey ?? identity.canonicalKey;
}

export function repositoryGroupingDisplayNameOf(identity: RepositoryIdentity): string | undefined {
  return identity.origin
    ? (identity.origin.displayName ?? identity.origin.canonicalKey)
    : identity.displayName;
}

export const ScopedProjectRef = Schema.Struct({
  environmentId: EnvironmentId,
  projectId: ProjectId,
});
export type ScopedProjectRef = typeof ScopedProjectRef.Type;

export const ScopedThreadRef = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
});
export type ScopedThreadRef = typeof ScopedThreadRef.Type;
