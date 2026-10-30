import { primaryEnvironmentIdAtom } from "../state/primaryEnvironment";
import { primaryServerSettingsAtom } from "../state/server";
import { getThemeDefinition, singleAppearanceOf, subscribeToCustomThemes } from "../themePalette";
import { setTheme, setAppearanceMode } from "./useTheme";
import { appAtomRegistry } from "../rpc/atomRegistry";

const APPLIED_DEFAULT_THEME_STORAGE_PREFIX = "supaterm:default-theme-applied:v2:";

/**
 * One generation per set: keyed on when the theme was set, not just its value,
 * so re-asserting the same theme still acts.
 */
export function defaultThemeGeneration(theme: string, setAt: string): string {
  return setAt.length > 0 ? `${theme}@${setAt}` : theme;
}

export function defaultThemeToApply(input: {
  readonly environmentId: string | null;
  readonly defaultTheme: string;
  readonly defaultThemeSetAt: string;
  readonly appliedGeneration: string | null;
  readonly resolves: boolean;
}): string | null {
  if (input.environmentId === null || input.defaultTheme.length === 0) return null;
  const generation = defaultThemeGeneration(input.defaultTheme, input.defaultThemeSetAt);
  if (input.appliedGeneration === generation) return null;
  // The setting and the palette it names arrive independently, so an id that
  // does not resolve yet is not a failure -- the effect runs again when the
  // published set changes.
  if (!input.resolves) return null;
  return generation;
}

function readAppliedGeneration(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeAppliedGeneration(storageKey: string, generation: string): void {
  try {
    window.localStorage.setItem(storageKey, generation);
  } catch {}
}

export function startDefaultThemeAdoption(): () => void {
  const apply = () => {
    const environmentId = appAtomRegistry.get(primaryEnvironmentIdAtom);
    const { defaultTheme, defaultThemeSetAt } = appAtomRegistry.get(primaryServerSettingsAtom);
    const definition = getThemeDefinition(defaultTheme);
    if (typeof window === "undefined" || environmentId === null) return;
    const storageKey = `${APPLIED_DEFAULT_THEME_STORAGE_PREFIX}${environmentId}`;
    const generation = defaultThemeToApply({
      environmentId,
      defaultTheme,
      defaultThemeSetAt,
      appliedGeneration: readAppliedGeneration(storageKey),
      resolves: definition !== null,
    });
    if (generation === null || definition === null) return;

    // Single-appearance defaults need a matching mode before their generation is marked applied.
    if (!setTheme(defaultTheme)) return;
    const half = singleAppearanceOf(definition);
    // Recorded only once both land: marking the generation applied while the
    // appearance switch failed would leave a dark-only theme rendering its
    // light half with no retry.
    if (half !== null && !setAppearanceMode(half)) return;
    writeAppliedGeneration(storageKey, generation);
  };
  const stops = [
    appAtomRegistry.subscribe(primaryEnvironmentIdAtom, apply),
    appAtomRegistry.subscribe(primaryServerSettingsAtom, apply),
    subscribeToCustomThemes(apply),
  ];
  apply();
  return () => {
    for (const stop of stops) stop();
  };
}
