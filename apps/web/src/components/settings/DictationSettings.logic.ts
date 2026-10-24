import {
  dictationSourceLabel,
  type DictationEnvironmentState,
} from "@supaterm/client-runtime/state/dictation";
import {
  resolveDictationSource,
  type DictationSettings,
  type DictationSourceDescriptor,
} from "@supaterm/contracts";

export const DICTATION_NO_SOURCE_MESSAGE =
  "No transcription model is available. Add a Codex account signed in with the Codex CLI or an OpenAI API key.";

const BLOCKED_MESSAGES = {
  unknown: "Connect this environment to check dictation availability.",
  unsupported: "Update this environment to use dictation.",
  forbidden: "This connection can't use dictation.",
} as const;

export function dictationSourceName(
  source: Pick<DictationSourceDescriptor, "label" | "accountLabel">,
): string {
  return source.accountLabel ? `${source.label} · ${source.accountLabel}` : source.label;
}

export type DictationSettingsView =
  | { readonly kind: "blocked"; readonly message: string }
  | {
      readonly kind: "offered";
      readonly settings: DictationSettings;
      readonly sources: ReadonlyArray<DictationSourceDescriptor>;
      readonly saved: DictationSourceDescriptor | null;
      readonly automaticDescription: string;
      readonly hasEligibleSource: boolean;
      readonly status: string | null;
      readonly sourceNote: string | null;
    };

export function resolveDictationSettingsView(
  state: DictationEnvironmentState,
): DictationSettingsView {
  if (state.status !== "offered") {
    return { kind: "blocked", message: BLOCKED_MESSAGES[state.status] };
  }
  const { sources, settings } = state.offer;
  const automatic = resolveDictationSource({ sources, settings: { enabled: true, source: null } });
  const resolved = resolveDictationSource({
    sources,
    settings: { enabled: true, source: settings.source },
  });
  const saved =
    settings.source === null
      ? null
      : (sources.find((source) => source.id === settings.source) ?? null);
  const savedUnavailable = settings.source !== null && saved?.eligible !== true;
  return {
    kind: "offered",
    settings,
    sources,
    saved,
    automaticDescription: automatic
      ? `Uses ${dictationSourceName(automatic)}`
      : "No transcription model is available.",
    hasEligibleSource: resolved !== null,
    status: settings.enabled && resolved ? dictationSourceLabel(resolved) : null,
    sourceNote:
      settings.enabled && savedUnavailable && resolved
        ? `${saved ? dictationSourceName(saved) : "The selected transcription model"} is unavailable. Dictation uses ${dictationSourceName(resolved)} instead.`
        : null,
  };
}
