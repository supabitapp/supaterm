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
  "No account here can transcribe. Sign in to Claude or Codex on this environment.";

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
  const resolved = resolveDictationSource({
    sources,
    settings: { enabled: true, source: settings.source },
  });
  const saved =
    settings.source === null
      ? null
      : (sources.find((source) => source.id === settings.source) ?? null);
  const hasEligibleSource = sources.some((source) => source.eligible);
  return {
    kind: "offered",
    settings,
    sources,
    saved,
    hasEligibleSource,
    status: settings.enabled && resolved ? dictationSourceLabel(resolved) : null,
    sourceNote: !settings.enabled
      ? null
      : settings.source === null
        ? hasEligibleSource
          ? "Choose the account that transcribes voice input here."
          : null
        : resolved === null
          ? `${saved ? dictationSourceName(saved) : "The chosen account"} can't transcribe right now${
              saved?.unavailableReason ? `: ${saved.unavailableReason}` : "."
            }`
          : null,
  };
}
