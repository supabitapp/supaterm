import { useAppearancePreferences } from "../features/settings/appearance/AppearancePreferencesProvider";

export function useUniwindTheme() {
  return useAppearancePreferences().themeVariables;
}
