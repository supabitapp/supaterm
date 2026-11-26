import type { RuntimeMode } from "@supaterm/contracts";
import {
  type IconComponent,
  LockIcon,
  LockOpenIcon,
  PenLineIcon,
  ShieldCheckIcon,
} from "@supaterm/icons";
import { msg } from "gt-react";

export const runtimeModeConfig: Record<
  RuntimeMode,
  { label: string; description: string; icon: IconComponent }
> = {
  "approval-required": {
    label: msg("Supervised"),
    description: msg("Ask before commands and file changes."),
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: msg("Auto-accept edits"),
    description: msg("Auto-approve edits, ask before other actions."),
    icon: PenLineIcon,
  },
  auto: {
    label: msg("Auto"),
    description: msg("Supported providers approve routine actions; others still ask."),
    icon: ShieldCheckIcon,
  },
  "full-access": {
    label: msg("Full access"),
    description: msg("Allow commands and edits without prompts."),
    icon: LockOpenIcon,
  },
};

export const runtimeModeOptions = Object.keys(runtimeModeConfig) as RuntimeMode[];

/**
 * The modes a draft's send can run in. A multi-model send gives every thread the draft's mode
 * and only that thread's provider narrows it, so the composer offers what any of them supports.
 */
export function draftSupportedRuntimeModes(
  activeProviderModes: ReadonlyArray<RuntimeMode> | undefined,
  multipleModelSelections: ReadonlyArray<{ readonly instanceId: string }> | null,
  providers: ReadonlyArray<{
    readonly instanceId: string;
    readonly supportedRuntimeModes?: ReadonlyArray<RuntimeMode> | undefined;
  }>,
) {
  if (multipleModelSelections === null || multipleModelSelections.length === 0) {
    return activeProviderModes;
  }
  const supported = multipleModelSelections.map(
    (selection) =>
      providers.find((provider) => provider.instanceId === selection.instanceId)
        ?.supportedRuntimeModes ?? [],
  );
  // A provider that reports no modes supports them all.
  if (supported.some((modes) => modes.length === 0)) return undefined;
  return runtimeModeOptions.filter((mode) => supported.some((modes) => modes.includes(mode)));
}
