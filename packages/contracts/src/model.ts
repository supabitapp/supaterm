import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

export const ProviderOptionDescriptorType = Schema.Literals(["select", "boolean"]);
export type ProviderOptionDescriptorType = typeof ProviderOptionDescriptorType.Type;

export const ProviderOptionChoice = Schema.Struct({
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
  isDefault: Schema.optional(Schema.Boolean),
});
export type ProviderOptionChoice = typeof ProviderOptionChoice.Type;

const ProviderOptionDescriptorBase = {
  id: TrimmedNonEmptyString,
  label: TrimmedNonEmptyString,
  description: Schema.optional(TrimmedNonEmptyString),
} as const;

export const SelectProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("select"),
  options: Schema.Array(ProviderOptionChoice),
  currentValue: Schema.optional(TrimmedNonEmptyString),
  promptInjectedValues: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
});
export type SelectProviderOptionDescriptor = typeof SelectProviderOptionDescriptor.Type;

export const BooleanProviderOptionDescriptor = Schema.Struct({
  ...ProviderOptionDescriptorBase,
  type: Schema.Literal("boolean"),
  currentValue: Schema.optional(Schema.Boolean),
});
export type BooleanProviderOptionDescriptor = typeof BooleanProviderOptionDescriptor.Type;

export const ProviderOptionDescriptor = Schema.Union([
  SelectProviderOptionDescriptor,
  BooleanProviderOptionDescriptor,
]);
export type ProviderOptionDescriptor = typeof ProviderOptionDescriptor.Type;

export const ProviderOptionSelectionValue = Schema.Union([TrimmedNonEmptyString, Schema.Boolean]);
export type ProviderOptionSelectionValue = typeof ProviderOptionSelectionValue.Type;

export const ProviderOptionSelection = Schema.Struct({
  id: TrimmedNonEmptyString,
  value: ProviderOptionSelectionValue,
});
export type ProviderOptionSelection = typeof ProviderOptionSelection.Type;

export const ProviderOptionSelections = Schema.Array(ProviderOptionSelection);
export type ProviderOptionSelections = typeof ProviderOptionSelections.Type;

export const ModelCapabilities = Schema.Struct({
  optionDescriptors: Schema.optional(Schema.Array(ProviderOptionDescriptor)),
});
export type ModelCapabilities = typeof ModelCapabilities.Type;

export const CustomModelEntry = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: Schema.optional(TrimmedNonEmptyString),
  capabilities: Schema.optional(ModelCapabilities),
});
export type CustomModelEntry = typeof CustomModelEntry.Type;

export const CustomModelSetting = Schema.Union([Schema.String, CustomModelEntry]);
export type CustomModelSetting = typeof CustomModelSetting.Type;

const CODEX_DRIVER_KIND = ProviderDriverKind.make("codex");
const CLAUDE_DRIVER_KIND = ProviderDriverKind.make("claudeAgent");
const CURSOR_DRIVER_KIND = ProviderDriverKind.make("cursor");
const GROK_DRIVER_KIND = ProviderDriverKind.make("grok");
const FX_DRIVER_KIND = ProviderDriverKind.make("fx");
const MUSE_DRIVER_KIND = ProviderDriverKind.make("muse");
const PI_DRIVER_KIND = ProviderDriverKind.make("pi");
const ACP_REGISTRY_DRIVER_KIND = ProviderDriverKind.make("acpRegistry");
const OPENCODE_DRIVER_KIND = ProviderDriverKind.make("opencode");

export const DEFAULT_MODEL = "gpt-6-astra";

export const PREFERRED_DEFAULT_CODEX_MODELS: ReadonlyArray<string> = [
  DEFAULT_MODEL,
  "gpt-5.6-sol",
  "gpt-5.6-terra",
];
export const DEFAULT_TEXT_GENERATION_MODEL = "gpt-6-luna";

export const ANTIGRAVITY_DEFAULT_MODEL = "antigravity-default";
export const DEFAULT_TEXT_GENERATION_REASONING_EFFORT = "low";

export const MUSE_DEFAULT_MODEL = "default";

export const DEFAULT_MODEL_BY_PROVIDER: Partial<Record<ProviderDriverKind, string>> = {
  [CODEX_DRIVER_KIND]: DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-opus-5-5",
  [CURSOR_DRIVER_KIND]: "auto",

  [GROK_DRIVER_KIND]: "grok-build",
  [FX_DRIVER_KIND]: "default",
  [MUSE_DRIVER_KIND]: MUSE_DEFAULT_MODEL,
  [ACP_REGISTRY_DRIVER_KIND]: "default",

  [PI_DRIVER_KIND]: "default",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
};

export const DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, string>
> = {
  [CODEX_DRIVER_KIND]: DEFAULT_TEXT_GENERATION_MODEL,
  [ProviderDriverKind.make("antigravity")]: ANTIGRAVITY_DEFAULT_MODEL,
  [CLAUDE_DRIVER_KIND]: "claude-haiku-5-5",
  [CURSOR_DRIVER_KIND]: "composer-2",
  [OPENCODE_DRIVER_KIND]: "openai/gpt-5",
};

export const MODEL_SLUG_ALIASES_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, Record<string, string>>
> = {
  [CODEX_DRIVER_KIND]: {
    "gpt-5-codex": "gpt-5.4",
    "5.4": "gpt-5.4",
    "5.3": "gpt-5.3-codex",
    "gpt-5.3": "gpt-5.3-codex",
    "5.3-spark": "gpt-5.3-codex-spark",
    "gpt-5.3-spark": "gpt-5.3-codex-spark",
  },
  [CLAUDE_DRIVER_KIND]: {},
  [CURSOR_DRIVER_KIND]: {
    composer: "composer-2",
    "composer-1.5": "composer-1.5",
    "composer-1": "composer-1.5",
    "opus-4.6-thinking": "claude-opus-4-6",
    "opus-4.6": "claude-opus-4-6",
    "sonnet-4.6-thinking": "claude-sonnet-4-6",
    "sonnet-4.6": "claude-sonnet-4-6",
    "opus-4.5-thinking": "claude-opus-4-5",
    "opus-4.5": "claude-opus-4-5",
  },
  [OPENCODE_DRIVER_KIND]: {},
};

export const PROVIDER_DISPLAY_NAMES: Partial<Record<ProviderDriverKind, string>> = {
  [ProviderDriverKind.make("antigravity")]: "Antigravity",
  [CODEX_DRIVER_KIND]: "Codex",
  [CLAUDE_DRIVER_KIND]: "Claude",
  [CURSOR_DRIVER_KIND]: "Cursor",
  [GROK_DRIVER_KIND]: "Grok",
  [FX_DRIVER_KIND]: "fx",
  [MUSE_DRIVER_KIND]: "Muse Code",
  [ACP_REGISTRY_DRIVER_KIND]: "ACP Registry",
  [PI_DRIVER_KIND]: "Pi",
  [OPENCODE_DRIVER_KIND]: "OpenCode",
};
