import type { OrchestrationMessageContext } from "@supaterm/contracts";
import { assistantCitationLabel } from "@supaterm/shared/assistantCitations";
import type { ComposerInlineToken } from "@supaterm/shared/composerInlineTokens";

import {
  composerChipSizeSuffix,
  contextChipAccent,
  contextChipIcon,
  contextChipPresentation,
  contextRecordFileName,
} from "./composerChipPresentation";
import { composerContextEditorTokens } from "./composerContext";
import { contextChipIconUri } from "./contextChipIconSource";
import type { MobileThemeVariables } from "./mobileTheme";

function basename(path: string): string {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separator >= 0 ? path.slice(separator + 1) : path;
}

type ComposerEditorToken = ReturnType<typeof composerContextEditorTokens>[number];

function chipLabel(
  token: ComposerEditorToken,
  available: boolean,
  skillLabels: ReadonlyMap<string, string>,
): string {
  switch (token.type) {
    case "skill":
      return skillLabels.get(token.value) ?? token.value;
    case "context":
      return available ? token.label : `${token.label} · unavailable`;
    case "citation":
      return assistantCitationLabel(token.citation);
    case "mention":
      return basename(token.value);
  }
}

export function composerEditorChips(input: {
  readonly text: string;
  readonly tokens: readonly ComposerInlineToken[];
  readonly skillLabels: ReadonlyMap<string, string>;
  readonly context: OrchestrationMessageContext | undefined;
  readonly theme: MobileThemeVariables;
  readonly textColor: string;
}) {
  return composerContextEditorTokens(input.text, input.tokens, input.skillLabels).map((token) => {
    const record =
      token.type === "context"
        ? input.context?.records.find((record) => record.contextId === token.contextId)
        : undefined;
    const presentation = contextChipPresentation(
      token.type === "context" ? token.kind : token.type,
      record,
    );
    const icon = contextChipIcon(
      presentation,
      token.type === "mention" ? token.value : contextRecordFileName(record),
    );
    return {
      // The Android editor routes chip taps only for the token types it knows.
      type: token.type === "citation" ? "context" : token.type,
      source: token.source,
      start: token.start,
      end: token.end,
      accent: contextChipAccent(presentation.accent, input.theme, input.textColor),
      label: chipLabel(token, record !== undefined, input.skillLabels),
      detail: token.type === "context" ? composerChipSizeSuffix(record) : "",
      iconUri: contextChipIconUri(icon),
      tintsIcon: icon.kind === "chip",
    };
  });
}
