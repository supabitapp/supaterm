import {
  isManagedSettingPath,
  type ManagedPolicySummary,
  type ProviderDriverKind,
} from "@supaterm/contracts";
import { cliReleaseChannelOf } from "@supaterm/shared/cliRelease";
import { mFallback, msg } from "gt-i18n";
import type { MFunctionType } from "gt-i18n/types";

import { managedNightlyDeniedMessage, managedUpdatesDenial } from "./contractLabels.ts";

/** The reason a control the policy pins shows: "Managed by Example Corp." */
export function managedByMessage(organization: string, resolve: MFunctionType = mFallback): string {
  return resolve(msg("Managed by {organization}.", { organization }));
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

/** The first target policy that locks any of `paths`. */
export function managedSettingLock(
  policies: Iterable<ManagedPolicySummary | undefined>,
  paths: ReadonlyArray<string>,
): ManagedPolicySummary | undefined {
  for (const policy of policies) {
    if (policy !== undefined && paths.some((path) => isManagedSettingPath(policy, path))) {
      return policy;
    }
  }
  return undefined;
}

/** Why a control writing any of `paths` is locked on one of the target environments. */
export function managedSettingDenial(
  policies: Iterable<ManagedPolicySummary | undefined>,
  paths: ReadonlyArray<string>,
  resolve: MFunctionType = mFallback,
): string | undefined {
  const lock = managedSettingLock(policies, paths);
  return lock === undefined ? undefined : managedByMessage(lock.organization, resolve);
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
  resolve: MFunctionType = mFallback,
): ManagedInstanceLocks | undefined {
  const paths = policy?.limits?.providers?.lockedInstanceFields?.[driver];
  if (policy === undefined || paths === undefined || paths.length === 0) return undefined;
  const fieldsUnder = (prefix: string) =>
    new Set(paths.flatMap((path) => (path.startsWith(prefix) ? [path.slice(prefix.length)] : [])));
  return {
    configKeys: fieldsUnder("config."),
    environmentNames: fieldsUnder("environment."),
    wholeEnvironment: paths.includes("environment"),
    reason: managedByMessage(policy.organization, resolve),
  };
}

/**
 * Why a server's policy refuses moving it to `targetVersion`; the server refuses with the same
 * message. `targetVersion` is undefined when the server picks its own version, as desktop apps do.
 */
export function managedServerUpdateDenial(
  policy: ManagedPolicySummary | undefined,
  targetVersion: string | undefined,
  resolve: MFunctionType = mFallback,
): string | undefined {
  return (
    managedUpdatesDenial(policy, resolve) ??
    (policy !== undefined &&
    policy.limits?.updates?.allowNightly === false &&
    targetVersion !== undefined &&
    cliReleaseChannelOf(targetVersion) !== "stable"
      ? managedNightlyDeniedMessage(policy.organization, resolve)
      : undefined)
  );
}
