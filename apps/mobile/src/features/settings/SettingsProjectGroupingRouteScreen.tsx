import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import { useMobileThreadGrouping } from "../../state/thread-grouping";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { SidebarProjectGroupingMode } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsScreen } from "./components/SettingsScreen";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { NewThreadSettingsSection } from "./ThreadSettingsSections";

const GROUPING_OPTIONS: ReadonlyArray<{
  readonly mode: SidebarProjectGroupingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "repository",
    label: "Group by repository",
    description: "Matching repositories appear as one project.",
  },
  {
    mode: "repository_path",
    label: "Group by repository path",
    description: "Keep monorepo paths separate.",
  },
  {
    mode: "separate",
    label: "Keep separate",
    description: "Show every workspace as its own project.",
  },
];

export function SettingsProjectGroupingRouteScreen() {
  const insets = useSafeAreaInsets();
  const { grouping, setGrouping, loaded } = useMobileThreadGrouping();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedMode = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value).sidebarProjectGroupingMode
    : null;

  return (
    <SettingsScreen title="General">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <SettingsSection title="Thread grouping">
          {THREAD_GROUPING_OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.value}
              label={option.label}
              selected={grouping === option.value}
              separated={index > 0}
              disabled={!loaded}
              onPress={() => setGrouping(option.value)}
            />
          ))}
        </SettingsSection>
        <SettingsSection title="Project grouping">
          {GROUPING_OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.mode}
              label={option.label}
              description={option.description}
              selected={selectedMode === option.mode}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => savePreferences(mobileProjectGroupingModePatch(option.mode))}
            />
          ))}
        </SettingsSection>
        <NewThreadSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}
