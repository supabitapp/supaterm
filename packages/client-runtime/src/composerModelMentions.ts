import type {
  ModelContextRecord,
  ProviderDriverKind,
  ProviderInstanceId,
  ServerProvider,
} from "@supaterm/contracts";
import { modelContextRecord } from "@supaterm/shared/composerContextReferences";
import { normalizeSearchQuery } from "@supaterm/shared/searchRanking";

import { rankModelPickerSearch } from "./modelSearch.ts";

const COMPOSER_MODEL_RESULT_LIMIT = 5;

export interface ComposerModelCandidate {
  readonly instanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
  readonly providerName: string;
  readonly model: string;
  readonly name: string;
  readonly shortName?: string | undefined;
  readonly subProvider?: string | undefined;
}

export interface ComposerModelItem {
  readonly id: string;
  readonly type: "model";
  readonly record: ModelContextRecord;
  readonly label: string;
  readonly description: string;
}

/** Only a provider delegate_task accepts: on, installed, signed in, and not failing. */
export function isMentionableProvider(
  provider: Pick<ServerProvider, "installed" | "status" | "auth" | "availability">,
  enabled: boolean,
): boolean {
  return (
    enabled &&
    provider.installed &&
    provider.status !== "error" &&
    provider.status !== "disabled" &&
    provider.auth.status !== "unauthenticated" &&
    provider.availability !== "unavailable"
  );
}

// Mentions end at whitespace, so `:`, `/` and `-` join words, as in `@claude:opus`.
function mentionSearchQueries(query: string): ReadonlyArray<string> {
  const spaced = normalizeSearchQuery(query.replace(/[:/]+/gu, " "));
  const unhyphenated = normalizeSearchQuery(spaced.replace(/-+/gu, " "));
  if (unhyphenated.length === 0) return [];
  return unhyphenated === spaced ? [spaced] : [spaced, unhyphenated];
}

function searchable(candidate: ComposerModelCandidate) {
  return {
    name: candidate.name,
    ...(candidate.shortName ? { shortName: candidate.shortName } : {}),
    ...(candidate.subProvider ? { subProvider: candidate.subProvider } : {}),
    driverKind: candidate.driver,
    providerDisplayName: candidate.providerName,
  };
}

/** Models an `@` mention names, best first. A bare `@` names none, so files keep the menu. */
export function matchComposerModelItems(
  candidates: ReadonlyArray<ComposerModelCandidate>,
  query: string,
): ComposerModelItem[] {
  for (const words of mentionSearchQueries(query)) {
    // Literal words only: fuzzy model hits would crowd file results out of the `@` menu.
    const tokens = words.split(/\s+/u);
    const literal = candidates.filter((candidate) => {
      const haystack = Object.values(searchable(candidate)).join(" ").toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
    const ranked = rankModelPickerSearch(literal, words, searchable);
    if (ranked.length > 0) {
      return ranked.slice(0, COMPOSER_MODEL_RESULT_LIMIT).map((candidate) => ({
        id: `model:${candidate.instanceId}:${candidate.model}`,
        type: "model",
        record: modelContextRecord(candidate),
        label: candidate.name,
        description: candidate.subProvider
          ? `${candidate.providerName} · ${candidate.subProvider}`
          : candidate.providerName,
      }));
    }
  }
  return [];
}
