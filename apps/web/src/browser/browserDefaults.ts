import {
  DEFAULT_BROWSER_PROFILE_ID,
  resolveBrowserProfiles,
  type BrowserProfile,
  type PreviewAppearancePreference,
  type PreviewViewportSetting,
  type PreviewZoomFactor,
} from "@supaterm/contracts";

import {
  ensureClientSettingsHydrated,
  getClientSettings,
  useClientSettings,
} from "~/hooks/useSettings";

import { resolveResponsiveBrowserViewportSize } from "./browserViewportLayout";

export interface BrowserDefaults {
  readonly viewport: PreviewViewportSetting;
  readonly zoomFactor: PreviewZoomFactor;
  readonly appearance: PreviewAppearancePreference;
  readonly profiles: ReadonlyArray<BrowserProfile>;
  readonly profileId: string;
}

const toBrowserDefaults = (settings: {
  readonly browserDefaultViewport: PreviewViewportSetting;
  readonly browserDefaultZoomFactor: PreviewZoomFactor;
  readonly browserDefaultAppearance: PreviewAppearancePreference;
  readonly browserProfiles: ReadonlyArray<BrowserProfile>;
  readonly browserDefaultProfileId: string;
}) => {
  const profiles = resolveBrowserProfiles(settings.browserProfiles);
  return {
    viewport: settings.browserDefaultViewport,
    zoomFactor: settings.browserDefaultZoomFactor,
    appearance: settings.browserDefaultAppearance,
    profiles,
    profileId:
      profiles.find(
        (profile) =>
          profile.id === settings.browserDefaultProfileId && profile.kind !== "incognito",
      )?.id ?? DEFAULT_BROWSER_PROFILE_ID,
  };
};

export function getBrowserDefaults() {
  return toBrowserDefaults(getClientSettings());
}

/** New tabs retain their initial defaults, so wait for settings hydration. Read failures reject. */
export async function resolveBrowserDefaults() {
  await ensureClientSettingsHydrated();
  return getBrowserDefaults();
}

export function useBrowserDefaults() {
  return useClientSettings(toBrowserDefaults);
}

export function browserDefaultTabState(defaults: BrowserDefaults) {
  return { zoomFactor: defaults.zoomFactor, colorScheme: defaults.appearance };
}

const FALLBACK_RESPONSIVE_VIEWPORT_SIZE = { width: 1024, height: 768 } as const;

export function browserResponsiveViewportForToggle(input: {
  readonly defaults?: BrowserDefaults;
  readonly panelRect: { readonly width: number; readonly height: number } | null;
  readonly zoomFactor: number | undefined;
}) {
  const defaults = input.defaults ?? getBrowserDefaults();
  if (defaults.viewport._tag !== "fill") return defaults.viewport satisfies PreviewViewportSetting;
  const size = input.panelRect
    ? resolveResponsiveBrowserViewportSize(input.panelRect, input.zoomFactor)
    : FALLBACK_RESPONSIVE_VIEWPORT_SIZE;
  return { _tag: "freeform", ...size } satisfies PreviewViewportSetting;
}
