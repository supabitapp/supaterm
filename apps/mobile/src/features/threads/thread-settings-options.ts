import type {
  AuthMcpClientAccess,
  ProviderOptionDescriptor,
  RuntimeMode,
} from "@supaterm/contracts";

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
