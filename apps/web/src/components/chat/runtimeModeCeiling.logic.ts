import {
  clampManagedRuntimeMode,
  type ManagedPolicySummary,
  type RuntimeMode,
} from "@supaterm/contracts";
import { managedRuntimeModeDenial } from "@supaterm/client-runtime/contract-labels";

import { m, type MessageResolver } from "~/i18n/messages";

/**
 * The composer's modes under an administrator's ceiling: modes above it stay listed, disabled
 * with the reason. A thread or draft already above it would be refused, so `denial` blocks the
 * send and `fallback` is the broadest offered mode left.
 */
export function capRuntimeModeOptions<Option extends { readonly mode: RuntimeMode }>(
  policy: ManagedPolicySummary | undefined,
  options: ReadonlyArray<Option>,
  mode: RuntimeMode,
  resolve: MessageResolver = m,
): {
  readonly options: ReadonlyArray<Option & { readonly disabledReason?: string }>;
  readonly denial: string | undefined;
  readonly fallback: RuntimeMode | undefined;
} {
  if (policy?.limits?.maxRuntimeMode === undefined) {
    return { options, denial: undefined, fallback: undefined };
  }
  const denial = managedRuntimeModeDenial(policy, mode, resolve);
  return {
    options: options.map((option) => {
      const disabledReason = managedRuntimeModeDenial(policy, option.mode, resolve);
      return disabledReason === undefined ? option : { ...option, disabledReason };
    }),
    denial,
    fallback:
      denial === undefined
        ? undefined
        : clampManagedRuntimeMode(
            policy,
            mode,
            options.map((option) => option.mode),
          ),
  };
}
