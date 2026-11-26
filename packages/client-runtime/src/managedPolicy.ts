import {
  isManagedSettingPath,
  managedNightlyDeniedMessage,
  managedUpdatesDenial,
  type ManagedPolicySummary,
  type ProviderDriverKind,
} from "@supaterm/contracts";
import { cliReleaseChannelOf } from "@supaterm/shared/cliRelease";

/** The reason a control the policy pins shows: "Managed by Example Corp." */
export function managedByMessage(organization: string): string {
  return `Managed by ${organization}.`;
}

/**
 * Why a control acting on several environments is unavailable: the first denial any target's
 * policy gives, since one refusing target refuses the whole action.
 */
export function firstManagedDenial(
  policies: Iterable<ManagedPolicySummary | undefined>,
  deny: (policy: ManagedPolicySummary | undefined) => string | undefined,
): string | undefined {
  for (const policy of policies) {
    const denial = deny(policy);
    if (denial !== undefined) return denial;
  }
  return undefined;
}

/** Why a control writing any of `paths` is locked on one of the target environments. */
export function managedSettingDenial(
  policies: Iterable<ManagedPolicySummary | undefined>,
  paths: ReadonlyArray<string>,
): string | undefined {
  if (paths.length === 0) return undefined;
  return firstManagedDenial(policies, (policy) =>
    policy !== undefined && paths.some((path) => isManagedSettingPath(policy, path))
      ? managedByMessage(policy.organization)
      : undefined,
  );
}

export interface ManagedInstanceLocks {
  /** Keys inside the instance's `config` users cannot change. */
  readonly configKeys: ReadonlySet<string>;
  /** Environment variables users cannot edit, rename, or remove. */
  readonly environmentNames: ReadonlySet<string>;
  /** Under a runtime-mode ceiling every variable is the administrator's, not only named ones. */
  readonly wholeEnvironment: boolean;
  readonly reason: string;
}

/** What the policy pins on instances of `driver`, or undefined when nothing is. */
export function managedInstanceLocks(
  policy: ManagedPolicySummary | undefined,
  driver: ProviderDriverKind,
): ManagedInstanceLocks | undefined {
  const paths = policy?.limits?.providers?.lockedInstanceFields?.[driver];
  if (policy === undefined || paths === undefined || paths.length === 0) return undefined;
  const fieldsUnder = (prefix: string) =>
    new Set(paths.flatMap((path) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : [])));
  return {
    configKeys: fieldsUnder("config."),
    environmentNames: fieldsUnder("environment."),
    wholeEnvironment: paths.includes("environment"),
    reason: managedByMessage(policy.organization),
  };
}

/**
 * Why a server's policy refuses moving it to `targetVersion`; the server refuses with the same
 * message. `targetVersion` is undefined when the server picks its own version, as desktop apps do.
 */
export function managedServerUpdateDenial(
  policy: ManagedPolicySummary | undefined,
  targetVersion: string | undefined,
): string | undefined {
  return (
    managedUpdatesDenial(policy) ??
    (policy !== undefined &&
    policy.limits?.updates?.allowNightly === false &&
    targetVersion !== undefined &&
    cliReleaseChannelOf(targetVersion) !== "stable"
      ? managedNightlyDeniedMessage(policy.organization)
      : undefined)
  );
}
