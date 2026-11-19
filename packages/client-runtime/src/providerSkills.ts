import {
  type EnvironmentId,
  isProviderWorkspaceSnapshotCurrent,
  isProviderWorkspaceSnapshotPending,
  PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
} from "@supaterm/contracts";
import { Atom } from "effect/reactivity";

import { deadlineStore } from "./clock.ts";
import { type AtomCommand, runAtomCommand } from "./state/runtime.ts";

export type ProviderSkillSourceKind = "app" | "repo" | "project" | "personal" | "system" | "other";

function normalizePathSeparators(pathValue: string) {
  return pathValue.replaceAll("\\", "/");
}

export function dedupeProviderSkillsByName(skills: ReadonlyArray<ServerProviderSkill>) {
  const seenNames = new Set<string>();
  return skills.filter((skill) => {
    const normalizedName = skill.name.trim().toLowerCase();
    if (seenNames.has(normalizedName)) {
      return false;
    }
    seenNames.add(normalizedName);
    return true;
  });
}

/**
 * Exclude disabled and agent-only skills (Claude Code's `user-invocable: false`).
 * Skills the agent cannot start on its own can still be invoked by users in the provider's native form.
 */
export function isProviderSkillUserInvocable(
  skill: Pick<ServerProviderSkill, "enabled" | "userInvocable">,
) {
  return skill.enabled && skill.userInvocable !== false;
}

export function getProviderSkillsForSlashMenu(
  skills: ReadonlyArray<ServerProviderSkill>,
  showSkillsInSlashMenu: boolean,
) {
  return showSkillsInSlashMenu
    ? dedupeProviderSkillsByName(skills.filter(isProviderSkillUserInvocable))
    : [];
}

export function getProviderSlashCommandsForSlashMenu(
  slashCommands: ReadonlyArray<ServerProviderSlashCommand>,
  visibleSkills: ReadonlyArray<ServerProviderSkill>,
) {
  const skillNames = new Set(visibleSkills.map((skill) => skill.name.trim().toLowerCase()));
  return slashCommands.filter((command) => !skillNames.has(command.name.trim().toLowerCase()));
}

export function resolveProviderSkillSourceKind(skill: Pick<ServerProviderSkill, "path" | "scope">) {
  const normalizedPath = normalizePathSeparators(skill.path);
  if (normalizedPath.includes("/.codex/plugins/") || normalizedPath.includes("/.agents/plugins/")) {
    return "app";
  }

  const normalizedScope = skill.scope?.trim().toLowerCase();
  switch (normalizedScope) {
    case "repo":
    case "repository":
      return "repo";
    case "project":
    case "workspace":
    case "local":
      return "project";
    case "user":
    case "personal":
      return "personal";
    case "system":
      return "system";
    case undefined:
    case "":
      return "other";
    default:
      return "other";
  }
}

function resolveProviderWorkspaceSnapshot(
  provider: ServerProvider,
  cwd: string | null | undefined,
) {
  if (!cwd) return undefined;
  return provider.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd);
}

export function hasCompleteProviderWorkspaceSnapshot(
  provider: ServerProvider | null | undefined,
  cwd: string | null | undefined,
) {
  const snapshot = provider && resolveProviderWorkspaceSnapshot(provider, cwd);
  return Boolean(snapshot && !isProviderWorkspaceSnapshotPending(snapshot));
}

function hasCurrentProviderWorkspaceSnapshot(
  provider: ServerProvider | null | undefined,
  cwd: string | null | undefined,
  nowMs: number,
) {
  const snapshot = provider && resolveProviderWorkspaceSnapshot(provider, cwd);
  return Boolean(
    snapshot &&
    !isProviderWorkspaceSnapshotPending(snapshot) &&
    isProviderWorkspaceSnapshotCurrent(snapshot, nowMs),
  );
}

export function resolveProviderSkillsForCwd(
  provider: ServerProvider,
  cwd: string | null | undefined,
) {
  return resolveProviderWorkspaceSnapshot(provider, cwd)?.skills ?? provider.skills;
}

export function resolveProviderSlashCommandsForCwd(
  provider: ServerProvider,
  cwd: string | null | undefined,
) {
  return resolveProviderWorkspaceSnapshot(provider, cwd)?.slashCommands ?? provider.slashCommands;
}

function resolveProviderModelsForCwd(provider: ServerProvider, cwd: string | null | undefined) {
  return resolveProviderWorkspaceSnapshot(provider, cwd)?.models ?? provider.models;
}

/** Providers keep their identity unless the cwd has its own catalog. */
export function resolveProvidersForCwd<P extends ServerProvider>(
  providers: ReadonlyArray<P>,
  cwd: string | null | undefined,
) {
  const resolved = providers.map((provider) => {
    const models = resolveProviderModelsForCwd(provider, cwd);
    return models === provider.models ? provider : { ...provider, models };
  });
  return resolved.every((provider, index) => provider === providers[index]) ? providers : resolved;
}

const WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS = 10_000;
const WORKSPACE_SNAPSHOT_MAX_ATTEMPTS = 3;

export interface ProviderWorkspaceSnapshotRefreshState {
  /**
   * When the last scan was requested. A request inside the TTL is not
   * repeated, so a client clock ahead of the server's cannot loop rescans.
   */
  readonly requestedAt: number | null;
  /** A failed scan is not retried before this time. */
  readonly retryNotBefore: number | null;
  /** Failed scans within the current request TTL. */
  readonly failedAttempts: number;
  readonly hadSnapshot: boolean;
  /** The server published a partial snapshot and is still discovering. */
  readonly snapshotPending: boolean;
}

const initialProviderWorkspaceSnapshotRefreshState: ProviderWorkspaceSnapshotRefreshState = {
  requestedAt: null,
  retryNotBefore: null,
  failedAttempts: 0,
  hadSnapshot: false,
  snapshotPending: false,
};

function planProviderWorkspaceSnapshotRefresh(
  previous: ProviderWorkspaceSnapshotRefreshState,
  provider: ServerProvider | null | undefined,
  cwd: string,
  now: number,
) {
  const hasSnapshot = hasCompleteProviderWorkspaceSnapshot(provider, cwd);
  const snapshot = provider && resolveProviderWorkspaceSnapshot(provider, cwd);
  const pending = Boolean(snapshot && isProviderWorkspaceSnapshotPending(snapshot));
  const lost = previous.hadSnapshot && !hasSnapshot;
  const requestedAt = lost ? null : previous.requestedAt;
  const retryNotBefore =
    lost || (previous.retryNotBefore !== null && now >= previous.retryNotBefore)
      ? null
      : previous.retryNotBefore;
  const state = {
    requestedAt,
    retryNotBefore,
    failedAttempts:
      lost || (requestedAt !== null && now - requestedAt >= PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS)
        ? 0
        : previous.failedAttempts,
    hadSnapshot: hasSnapshot,
    snapshotPending: pending,
  };
  const refresh =
    (requestedAt === null || now - requestedAt >= PROVIDER_WORKSPACE_SNAPSHOT_TTL_MS) &&
    !hasCurrentProviderWorkspaceSnapshot(provider, cwd, now) &&
    retryNotBefore === null;
  if (refresh) {
    return { state: { ...state, requestedAt: now }, refresh: true, recheckAt: null };
  }
  return { state, refresh: false, recheckAt: pending ? retryNotBefore : null };
}

function failProviderWorkspaceSnapshotRefresh(
  state: ProviderWorkspaceSnapshotRefreshState,
  requestedAt: number,
  now: number,
  cooldownMs = WORKSPACE_SNAPSHOT_RETRY_COOLDOWN_MS,
) {
  if (state.requestedAt !== requestedAt) return state;
  const failedAttempts = state.failedAttempts + 1;
  if (failedAttempts >= WORKSPACE_SNAPSHOT_MAX_ATTEMPTS) return { ...state, failedAttempts };
  return {
    ...state,
    requestedAt: null,
    retryNotBefore: cooldownMs === 0 ? null : now + cooldownMs,
    failedAttempts,
  };
}

/**
 * A scan is in flight, or the server is still discovering, for a cwd without a
 * complete snapshot, so its skills and commands may still arrive. A failed scan
 * clears `requestedAt`, and exhausted attempts end it, so this cannot stay true
 * for a scan that will not finish.
 */
export function isProviderWorkspaceSnapshotScanning(
  state: ProviderWorkspaceSnapshotRefreshState | undefined,
) {
  return (
    state !== undefined &&
    (state.requestedAt !== null || state.snapshotPending) &&
    !state.hadSnapshot &&
    state.failedAttempts < WORKSPACE_SNAPSHOT_MAX_ATTEMPTS
  );
}

function resolveWorkspaceSnapshotStatus(provider: ServerProvider | undefined, cwd: string) {
  const snapshot = provider && resolveProviderWorkspaceSnapshot(provider, cwd);
  if (!snapshot) return "absent";
  return isProviderWorkspaceSnapshotPending(snapshot) ? "pending" : "complete";
}

interface ProviderWorkspaceSnapshotRefreshTarget {
  readonly environmentId: EnvironmentId;
  readonly instanceId: ProviderInstanceId;
  readonly cwd: string;
}

/**
 * Keeps one environment/provider/cwd workspace snapshot fresh while mounted:
 * reading scans when it is missing or stale, and refreshing re-checks (the
 * composer does as the user types). It owns the retry timer, so the timer dies
 * with the last subscriber.
 */
export function createProviderWorkspaceSnapshotRefreshAtomFamily(input: {
  readonly providers: (
    environmentId: EnvironmentId,
  ) => Atom.Atom<ReadonlyArray<ServerProvider> | null>;
  readonly refreshProviders: AtomCommand<
    {
      readonly environmentId: EnvironmentId;
      readonly input: { readonly instanceId: ProviderInstanceId; readonly cwd: string };
    },
    { readonly providers: ReadonlyArray<ServerProvider> },
    unknown
  >;
}) {
  const family = Atom.family((target: ProviderWorkspaceSnapshotRefreshTarget) => {
    const { environmentId, instanceId, cwd } = target;
    const key = `${environmentId}:${instanceId}:${cwd}`;
    const findProvider = (providers: ReadonlyArray<ServerProvider> | null) =>
      providers?.find((provider) => provider.instanceId === instanceId);
    const statusAtom = Atom.make((get) =>
      resolveWorkspaceSnapshotStatus(findProvider(get(input.providers(environmentId))), cwd),
    ).pipe(Atom.withLabel(`provider-workspace-snapshot-status:${key}`));
    type Update = (
      state: ProviderWorkspaceSnapshotRefreshState,
    ) => ProviderWorkspaceSnapshotRefreshState;
    const refreshAtom: Atom.Writable<ProviderWorkspaceSnapshotRefreshState, Update> = Atom.writable(
      (get) => {
        get(statusAtom);
        const provider = findProvider(get.once(input.providers(environmentId)));
        // @effect-diagnostics-next-line globalDate:off
        const now = Date.now();
        const previous = get.self<ProviderWorkspaceSnapshotRefreshState>();
        const plan = planProviderWorkspaceSnapshotRefresh(
          previous._tag === "Some" ? previous.value : initialProviderWorkspaceSnapshotRefreshState,
          provider,
          cwd,
          now,
        );
        if (plan.recheckAt !== null) {
          get.addFinalizer(deadlineStore(plan.recheckAt).subscribe(() => get.refreshSelf()));
        }
        if (!plan.refresh) return plan.state;
        const registry = get.registry;
        const retry = (cooldownMs?: number) => {
          const node = registry.getNodes().get(refreshAtom);
          if (node === undefined || node.canBeRemoved) return;
          registry.set(refreshAtom, (state) =>
            // @effect-diagnostics-next-line globalDate:off
            failProviderWorkspaceSnapshotRefresh(state, now, Date.now(), cooldownMs),
          );
        };
        const retryLater = () => retry();
        void runAtomCommand(
          registry,
          input.refreshProviders,
          { environmentId, input: { instanceId, cwd } },
          { reportFailure: false },
        ).then((result) => {
          const refreshedProvider =
            result._tag === "Success" ? findProvider(result.value.providers) : undefined;
          const snapshot =
            refreshedProvider && resolveProviderWorkspaceSnapshot(refreshedProvider, cwd);
          // @effect-diagnostics-next-line globalDate:off
          const completedAt = Date.now();
          const refreshed =
            hasCompleteProviderWorkspaceSnapshot(refreshedProvider, cwd) &&
            (hasCurrentProviderWorkspaceSnapshot(refreshedProvider, cwd, completedAt) ||
              snapshot?.checkedAt !==
                (provider && resolveProviderWorkspaceSnapshot(provider, cwd))?.checkedAt);
          if (!refreshed) return retryLater();
          const held = findProvider(registry.get(input.providers(environmentId)));
          if (!hasCompleteProviderWorkspaceSnapshot(held, cwd)) retry(0);
        }, retryLater);
        return plan.state;
      },
      (ctx, update: Update) => {
        ctx.setSelf(update(ctx.get(refreshAtom)));
        ctx.refreshSelf();
      },
    ).pipe(Atom.withLabel(`provider-workspace-snapshot-refresh:${key}`));
    return refreshAtom;
  });
  return (target: ProviderWorkspaceSnapshotRefreshTarget) =>
    family({ environmentId: target.environmentId, instanceId: target.instanceId, cwd: target.cwd });
}
