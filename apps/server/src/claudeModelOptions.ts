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
  isClaudeCatalogUltracodeEffort,
  normalizeClaudeCatalogEffort,
  resolveClaudeCatalogApiModelId,
  resolveClaudeCatalogEffort,
  type ClaudeModelCatalog,
} from "./provider/ClaudeModelCatalog.ts";

export interface CompiledClaudeModelSelection {
  readonly apiModelId: string;
  readonly effort: string | undefined;
  readonly promptEffort: string | undefined;
  readonly settings: {
    readonly alwaysThinkingEnabled?: boolean;
    readonly fastMode: boolean;
    readonly ultracode?: boolean;
  };
  readonly queryIdentity: string;
}

export function compileClaudeModelSelection(
  selection: ModelSelection,
  catalog: ClaudeModelCatalog = BUNDLED_CLAUDE_MODEL_CATALOG,
  options: {
    readonly fastModeBlocked?: boolean;
    readonly customModels?: ReadonlyArray<CustomModelSetting>;
  } = {},
): CompiledClaudeModelSelection {
  const capabilities = getClaudeCatalogModelCapabilities(catalog, selection.model);
  const descriptors = getProviderOptionDescriptors({ caps: capabilities });
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
  const thinking = supportsBoolean("thinking")
    ? getModelSelectionBooleanOptionValue(selection, "thinking")
    : undefined;
  const settings = {
    ...(typeof thinking === "boolean" ? { alwaysThinkingEnabled: thinking } : {}),
    fastMode,
    ...(isClaudeCatalogUltracodeEffort(resolvedEffort) ? { ultracode: true } : {}),
  };
  const apiModelId = resolveClaudeCatalogApiModelId(catalog, selection);
  const promptEffort = resolvePromptInjectedEffort(capabilities, rawEffort) ?? undefined;
  return {
    apiModelId,
    effort,
    promptEffort,
    settings,
    queryIdentity: JSON.stringify({ apiModelId, effort: effort ?? null, settings }),
  };
}
