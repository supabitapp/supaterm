import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import { useMobileThreadGrouping } from "../../state/thread-grouping";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomValue } from "@effect/atom-react";
import type { SidebarProjectGroupingMode } from "@supaterm/contracts";
import { AsyncResult } from "effect/reactivity";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsScreen } from "./components/SettingsScreen";
import {
  mobileProjectGroupingModePatch,
  resolveMobileProjectGroupingSettings,
} from "../../state/project-grouping";
import { mobilePreferencesAtom, saveMobilePreferences } from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { ListChoiceRow as SettingsChoiceRow } from "../../components/ui/ListChoiceRow";
import { SettingsSection } from "./components/SettingsSection";
import { NewThreadSettingsSection } from "./ThreadSettingsSections";
import { LanguageSettingsSection } from "./SettingsLanguageRouteScreen";
import { msg, useGT } from "gt-react-native";

const GROUPING_OPTIONS: ReadonlyArray<{
  readonly mode: SidebarProjectGroupingMode;
  readonly label: string;
  readonly description: string;
}> = [
  {
    mode: "repository",
    label: msg("Group by repository"),
    description: msg("Matching repositories appear as one project."),
  },
  {
    mode: "repository_path",
    label: msg("Group by repository path"),
    description: msg("Keep monorepo paths separate."),
  },
  {
    mode: "separate",
    label: msg("Keep separate"),
    description: msg("Show every workspace as its own project."),
  },
];

export function SettingsProjectGroupingRouteScreen() {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const { grouping, setGrouping, loaded } = useMobileThreadGrouping();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const selectedMode = AsyncResult.isSuccess(preferencesResult)
    ? resolveMobileProjectGroupingSettings(preferencesResult.value).sidebarProjectGroupingMode
    : null;

  return (
    <SettingsScreen title={gt("General")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <LanguageSettingsSection />
        <SettingsSection title={gt("Thread grouping")}>
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
        <SettingsSection title={gt("Project grouping")}>
          {GROUPING_OPTIONS.map((option, index) => (
            <SettingsChoiceRow
              key={option.mode}
              label={option.label}
              description={option.description}
              selected={selectedMode === option.mode}
              separated={index > 0}
              disabled={!preferencesReady}
              onPress={() => {
                void savePreferences(mobileProjectGroupingModePatch(option.mode));
              }}
            />
          ))}
        </SettingsSection>
        <NewThreadSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}
