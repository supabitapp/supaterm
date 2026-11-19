import type { ModelSelection } from "@supaterm/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@supaterm/shared/model";

export function getCodexServiceTierOptionValue(modelSelection: ModelSelection | null | undefined) {
  return (
    getModelSelectionStringOptionValue(modelSelection, "serviceTier") ??
    (getModelSelectionBooleanOptionValue(modelSelection, "fastMode") === true ? "fast" : undefined)
  );
}
