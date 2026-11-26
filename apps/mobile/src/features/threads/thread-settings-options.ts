import {
  clampManagedRuntimeMode,
  managedRuntimeModeDenial,
  type AuthMcpClientAccess,
  type ManagedPolicySummary,
  type ProviderOptionDescriptor,
  type RuntimeMode,
} from "@supaterm/contracts";
import { firstManagedDenial } from "@supaterm/client-runtime/managed-policy";

/**
 * The slider holds reasoning levels only. Prompt-injected values (ultrathink and
 * friends) are typed into the prompt, never picked, and ultracode is a real option
 * but a workflow trigger that stays reachable through the full choice list.
 */
const NON_LEVEL_OPTION_IDS: ReadonlySet<string> = new Set(["ultracode"]);

export const RUNTIME_MODE_CHOICES: ReadonlyArray<{
  readonly mode: RuntimeMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "approval-required",
    label: "Supervised",
    description: "Ask before commands and file changes.",
  },
  {
    mode: "auto-accept-edits",
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
  },
  {
    mode: "auto",
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
  },
  {
    mode: "full-access",
    label: "Full access",
    description: "Allow commands and edits without prompts.",
  },
];

/** What a link lets agents do on the linked machine: read-only, then the runtime modes. */
export const LINK_ACCESS_CHOICES: ReadonlyArray<{
  readonly access: AuthMcpClientAccess;
  readonly label: string;
  readonly description: string;
}> = [
  {
    access: "read-only",
    label: "Read only",
    description: "Read projects and threads. Cannot start, message or change anything.",
  },
  ...RUNTIME_MODE_CHOICES.map((choice) => ({ ...choice, access: choice.mode })),
];

export const linkAccessLabel = (access: AuthMcpClientAccess): string =>
  LINK_ACCESS_CHOICES.find((choice) => choice.access === access)?.label ?? access;

export function runtimeModeChoicesForSupportedModes(
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
) {
  return supportedRuntimeModes && supportedRuntimeModes.length > 0
    ? RUNTIME_MODE_CHOICES.filter((choice) => supportedRuntimeModes.includes(choice.mode))
    : RUNTIME_MODE_CHOICES;
}

export type RuntimeModeChoice = (typeof RUNTIME_MODE_CHOICES)[number] & {
  readonly disabledReason?: string;
};

/**
 * Marks modes above a managed runtime ceiling. A control acting on several environments is
 * managed when any of them is, so the first target that refuses a mode supplies its reason.
 */
export function withManagedRuntimeModeLimits(
  choices: ReadonlyArray<RuntimeModeChoice>,
  policies: ReadonlyArray<ManagedPolicySummary | undefined>,
): ReadonlyArray<RuntimeModeChoice> {
  return choices.map((choice) => {
    const reason = firstManagedDenial(policies, (policy) =>
      managedRuntimeModeDenial(policy, choice.mode),
    );
    return reason === undefined ? choice : { ...choice, disabledReason: reason };
  });
}

/**
 * A new thread's mode: the draft's choice unless the managed ceiling refuses it, then the
 * default held to the ceiling. A pending task's default is the mode it was queued with, which
 * can predate the ceiling.
 */
export function resolveNewThreadRuntimeMode(
  draftMode: RuntimeMode | undefined,
  defaultMode: RuntimeMode,
  policy: ManagedPolicySummary | undefined,
): RuntimeMode {
  if (draftMode !== undefined && managedRuntimeModeDenial(policy, draftMode) === undefined) {
    return draftMode;
  }
  return clampManagedRuntimeMode(policy, defaultMode) ?? defaultMode;
}

/**
 * Why a thread's mode is above its environment's managed ceiling, where the server refuses
 * every turn, and the broadest mode its provider supports that it can switch down to.
 */
export function managedRuntimeModeSwitch(
  policy: ManagedPolicySummary | undefined,
  runtimeMode: RuntimeMode,
  supportedRuntimeModes: ReadonlyArray<RuntimeMode> | undefined,
): { readonly denial: string; readonly target: RuntimeModeChoice | undefined } | undefined {
  const denial = managedRuntimeModeDenial(policy, runtimeMode);
  if (denial === undefined) return undefined;
  const choices = runtimeModeChoicesForSupportedModes(supportedRuntimeModes);
  const target = clampManagedRuntimeMode(
    policy,
    runtimeMode,
    choices.map((choice) => choice.mode),
  );
  return { denial, target: choices.find((choice) => choice.mode === target) };
}

export function compatibleRuntimeModeForChoices(
  runtimeMode: RuntimeMode,
  choices: ReadonlyArray<{ readonly mode: RuntimeMode }>,
): RuntimeMode {
  return choices.some((choice) => choice.mode === runtimeMode)
    ? runtimeMode
    : (choices[0]?.mode ?? runtimeMode);
}

export { selectableProviderOptionChoices as selectableChoices } from "@supaterm/client-runtime/model-traits";

/** Maps the current effort to a stop without substituting a different level. */
export function reasoningSliderOptions(
  descriptor: Extract<ProviderOptionDescriptor, { type: "select" }>,
  currentValue: string | boolean | undefined,
) {
  const injected = new Set(descriptor.promptInjectedValues ?? []);
  const choices = descriptor.options.filter(
    (option) => !injected.has(option.id) && !NON_LEVEL_OPTION_IDS.has(option.id),
  );
  const selectedIndex = choices.findIndex((choice) => choice.id === currentValue);
  return selectedIndex < 0 ? null : { choices, selectedIndex };
}
