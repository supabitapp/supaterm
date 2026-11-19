import type { ProjectGroupingSettings } from "@supaterm/client-runtime/state/project-grouping";
import type { SidebarProjectGroupingMode } from "@supaterm/contracts";

import type { Preferences } from "../persistence/mobile-preferences";

export const DEFAULT_MOBILE_PROJECT_GROUPING_SETTINGS: ProjectGroupingSettings = {
  sidebarProjectGroupingMode: "repository",
  sidebarProjectGroupingOverrides: {},
};

export function resolveMobileProjectGroupingSettings(preferences: Preferences) {
  return {
    sidebarProjectGroupingMode: preferences.projectGroupingMode ?? "repository",
    sidebarProjectGroupingOverrides: {},
  };
}

export function mobileProjectGroupingModePatch(mode: SidebarProjectGroupingMode) {
  return { projectGroupingMode: mode };
}
