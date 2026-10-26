import { useAtomValue } from "@effect/atom-react";
import { useSyncExternalStore } from "react";

import { APP_STAGE_LABEL } from "../../branding";
import { resolveServerBackedAppStageLabel } from "../../branding.logic";
import { useClientSettingsHydrated } from "../../hooks/useSettings";
import { useTheme } from "../../hooks/useTheme";
import { primaryServerConfigAtom } from "../../state/server";
import {
  getThemeDefinition,
  getThemePreviewAppearance,
  resolveThemeHalf,
  subscribeToThemePreview,
  type ThemeAppearance,
} from "../../themePalette";

type EnvironmentIdentificationPillLabel = "Dev" | "Nightly";

export function shouldShowEnvironmentIdentificationPill(input: {
  settingsHydrated: boolean;
  appearance: ThemeAppearance;
  paletteThemeActive: boolean;
}): boolean {
  // Avoid briefly rendering the pill before client settings hydrate.
  return input.settingsHydrated && input.appearance === "light" && input.paletteThemeActive;
}

function resolveEnvironmentIdentificationPillLabel(
  stageLabel: string | null,
): EnvironmentIdentificationPillLabel | null {
  const normalized = stageLabel?.trim().toLowerCase();
  if (normalized === "dev") return "Dev";
  if (normalized === "nightly") return "Nightly";
  return null;
}

export function useEnvironmentIdentificationPillLabel(): EnvironmentIdentificationPillLabel | null {
  const settingsHydrated = useClientSettingsHydrated();
  const { resolvedTheme, theme, themeHalves } = useTheme();
  const previewAppearance = useSyncExternalStore(
    subscribeToThemePreview,
    getThemePreviewAppearance,
    () => null,
  );
  const primaryServerVersion =
    useAtomValue(primaryServerConfigAtom)?.environment.serverVersion ?? null;
  const activeTheme = resolveThemeHalf(theme, themeHalves, resolvedTheme);
  const showPill = shouldShowEnvironmentIdentificationPill({
    settingsHydrated,
    appearance: previewAppearance ?? resolvedTheme,
    paletteThemeActive: previewAppearance !== null || getThemeDefinition(activeTheme) !== null,
  });
  if (!showPill) return null;
  return resolveEnvironmentIdentificationPillLabel(
    resolveServerBackedAppStageLabel({
      primaryServerVersion,
      fallbackStageLabel: APP_STAGE_LABEL,
    }),
  );
}
