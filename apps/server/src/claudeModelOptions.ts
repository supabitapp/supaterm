import type { CustomModelSetting, ModelSelection } from "@supaterm/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  readCustomModelEntries,
  resolvePromptInjectedEffort,
} from "@supaterm/shared/model";

import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  getClaudeCatalogModelCapabilities,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  resolveClaudeCatalogModel,
  resolveClaudeModelSlug,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

const CLAUDE_CODE_MODEL_ALIASES = new Set(["opus", "sonnet", "haiku", "fable"]);

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  readonly effort: string | undefined;
  readonly promptEffort: string | undefined;
  readonly settings: {
    readonly alwaysThinkingEnabled?: boolean;
    readonly fastMode: boolean;
    readonly ultracode?: boolean;
  };
  /** The alias of a custom model named like one, which Claude Code would otherwise expand. */
  readonly pinnedAlias: string | undefined;
  readonly queryIdentity: string;
}

export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog?: ClaudeModelCatalog,
  options?: {
    readonly fastModeBlocked?: boolean;
    readonly customModels?: ReadonlyArray<CustomModelSetting>;
  },
): CompiledClaudeModelSelection;
export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
  options: {
    readonly fastModeBlocked?: boolean;
    readonly customModels?: ReadonlyArray<CustomModelSetting>;
  } = {},
) {
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({
    caps: capabilities,
    selections: selection.options,
  });
  const supportsBoolean = (id: string) =>
    descriptors.some((descriptor) => descriptor.type === "boolean" && descriptor.id === id);
  const rawEffort = getModelSelectionStringOptionValue(selection, "effort");
  const resolvedEffort = resolveClaudeCatalogEffort(catalog, selection.model, rawEffort);
  const effort = normalizeClaudeCatalogEffort(catalog, resolvedEffort, selection.model);
  const isCustomModel =
    !catalog.models.some(
      (entry) => entry.model.slug === selection.model && !entry.model.isCustom,
    ) &&
    readCustomModelEntries(options.customModels ?? []).some(
      (entry) => entry.slug === selection.model,
    );
  const fastMode =
    !options.fastModeBlocked &&
    !isCustomModel &&
    supportsBoolean("fastMode") &&
    getModelSelectionBooleanOptionValue(selection, "fastMode") === true;
  const inCatalog = resolveClaudeCatalogModel(catalog, selection.model) !== undefined;
  const thinking =
    !inCatalog || supportsBoolean("thinking")
      ? getModelSelectionBooleanOptionValue(selection, "thinking")
      : undefined;
  const ultracode = descriptors.find((descriptor) => descriptor.id === "ultracode")?.currentValue;
  const settings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    fastMode,
    ...(typeof ultracode === "boolean" ? { ultracode } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  const promptEffort = resolvePromptInjectedEffort(capabilities, rawEffort) ?? undefined;
  const pinnedAlias =
    CLAUDE_CODE_MODEL_ALIASES.has(apiModelId) &&
    resolveClaudeModelSlug(catalog, selection.model) === apiModelId
      ? apiModelId
      : undefined;
  return {
    apiModelId,
    effort,
    promptEffort,
    settings,
    pinnedAlias,
    queryIdentity: JSON.stringify({
      apiModelId,
      effort: effort ?? null,
      settings,
      pinnedAlias: pinnedAlias ?? null,
    }),
  } satisfies CompiledClaudeModelSelection;
}
