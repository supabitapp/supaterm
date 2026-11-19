import type { EnvironmentConnectionPhase } from "@supaterm/client-runtime/connection";
import {
  AuthProvidersManageScope,
  type EnvironmentId,
  type ProjectId,
  type ProjectSettingsOverrides,
  type ProviderInstanceId,
  resolveProjectProviderInstanceEnabled,
  sessionGrantsScope,
  type ServerSettings,
  type SessionGrantInput,
} from "@supaterm/contracts";

export interface ProviderEnvironmentOptionLike {
  readonly environmentId: EnvironmentId;
  readonly label: string;
}

export function isProviderSettingsEnvironmentAvailable(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
}) {
  return input.connectionPhase === "connected" && input.hasServerConfig;
}

export function buildProviderEnvironmentOptions<T extends ProviderEnvironmentOptionLike>(
  environments: ReadonlyArray<T>,
  primaryEnvironmentId: EnvironmentId | null,
  environmentIds?: readonly EnvironmentId[],
) {
  const allowed = environmentIds ? new Set(environmentIds) : null;
  return environments
    .filter((environment) => !allowed || allowed.has(environment.environmentId))
    .toSorted((left, right) => {
      const leftIsPrimary = left.environmentId === primaryEnvironmentId;
      const rightIsPrimary = right.environmentId === primaryEnvironmentId;
      if (leftIsPrimary !== rightIsPrimary) {
        return leftIsPrimary ? -1 : 1;
      }
      return (
        left.label.localeCompare(right.label) ||
        String(left.environmentId).localeCompare(String(right.environmentId))
      );
    });
}

export function resolveSelectedProviderEnvironmentId(
  environments: ReadonlyArray<ProviderEnvironmentOptionLike>,
  selectedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
) {
  if (
    selectedEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === selectedEnvironmentId)
  ) {
    return selectedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    environments.some((environment) => environment.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return environments[0]?.environmentId ?? null;
}

export type ProviderEnvironmentAccess =
  | { readonly kind: "editable" }
  | { readonly kind: "loading"; readonly reason: "config" | "permissions" }
  | { readonly kind: "read-only" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "error" };

export type ProviderOperateAccess = "granted" | "denied" | "pending";

export function resolveRemoteOperateAccess(input: {
  readonly session: SessionGrantInput | null;
  readonly isPending: boolean;
  readonly hasError: boolean;
}) {
  if (input.hasError) return "denied";
  if (input.session === null) return input.isPending ? "pending" : "denied";
  return sessionGrantsScope(input.session, AuthProvidersManageScope) ? "granted" : "denied";
}

/** Send providerInstances even when empty; omission preserves the stored map for older clients. */

export function buildProviderInstanceOverridePatch(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
  projectIds: readonly ProjectId[],
  instanceId: ProviderInstanceId,
  value: boolean | undefined,
) {
  const patch: Record<ProjectId, ProjectSettingsOverrides | null> = {};
  for (const projectId of projectIds) {
    const current = settings.projectSettingsOverrides[projectId];
    const instances = { ...current?.providerInstances };
    const instance = { ...instances[instanceId] };
    if (value === undefined) delete instance.enabled;
    else instance.enabled = value;
    if (Object.keys(instance).length > 0) instances[instanceId] = instance;
    else delete instances[instanceId];

    const { providerInstances: _omit, ...rest } = current ?? {};
    const nextEntry: ProjectSettingsOverrides = { ...rest, providerInstances: instances };
    patch[projectId] =
      Object.keys(rest).length === 0 && Object.keys(instances).length === 0 ? null : nextEntry;
  }
  return patch;
}

export function resolveProjectProviderOverride(
  settings: Pick<ServerSettings, "providerInstances" | "projectSettingsOverrides">,
  projectIds: readonly ProjectId[],
  instanceId: ProviderInstanceId,
) {
  const values = projectIds.map(
    (id) => settings.projectSettingsOverrides[id]?.providerInstances?.[instanceId]?.enabled,
  );
  const effective = projectIds.map((id) =>
    resolveProjectProviderInstanceEnabled(settings, id, instanceId),
  );
  return {
    value: values[0],
    valueMixed: values.some((value) => value !== values[0]),
    hasOverride: values.some((value) => value !== undefined),
    effectiveEnabled: effective[0] ?? false,
    mixed: effective.some((value) => value !== effective[0]),
  };
}

export function classifyProviderEnvironmentAccess(input: {
  readonly connectionPhase: EnvironmentConnectionPhase;
  readonly hasServerConfig: boolean;
  readonly operateAccess: ProviderOperateAccess;
}) {
  if (input.connectionPhase === "error") {
    return { kind: "error" } satisfies ProviderEnvironmentAccess;
  }
  if (input.connectionPhase !== "connected") {
    return { kind: "unavailable" } satisfies ProviderEnvironmentAccess;
  }
  if (!input.hasServerConfig) {
    return { kind: "loading", reason: "config" } satisfies ProviderEnvironmentAccess;
  }
  if (input.operateAccess === "pending") {
    return { kind: "loading", reason: "permissions" } satisfies ProviderEnvironmentAccess;
  }
  if (input.operateAccess === "denied") {
    return { kind: "read-only" } satisfies ProviderEnvironmentAccess;
  }
  return { kind: "editable" } satisfies ProviderEnvironmentAccess;
}
