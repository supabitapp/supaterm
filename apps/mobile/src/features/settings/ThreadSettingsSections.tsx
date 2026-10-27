import { Button } from "../../components/ui/Button";
import { AutoMarkDoneDaysField } from "./components/AutoMarkDoneDaysField";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { View } from "react-native";

import { DEFAULT_SERVER_SETTINGS } from "@supaterm/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import { showSkillsInSlashMenuAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  planAutoMarkDoneSettingsSync,
  type AutoMarkDoneSettings,
} from "./autoMarkDoneSettingsSync";
import { uniformMobileSetting, type ScopedMobileSettingsTarget } from "./settings-scoped-server";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 3;

/**
 * Thread lifecycle rows on the Threads page. They save through the page's writer so a project
 * override, which is replaced whole, never races another row's write.
 */
export function ThreadBehaviorSettingsRows(props: {
  readonly targets: readonly ScopedMobileSettingsTarget[];
  readonly projectSelected: boolean;
  readonly disabled: boolean;
  readonly write: (
    patch: Partial<AutoMarkDoneSettings> & {
      autoResumeLimitedThreads?: boolean;
      snoozeLimitedThreads?: boolean;
    },
  ) => void;
}) {
  const { projectSelected, disabled, write: writeToAll } = props;
  const displayTargets = props.targets;
  const reference = displayTargets[0] ?? null;
  const referenceSettings = reference?.settings ?? null;

  if (reference === null || referenceSettings === null) {
    return null;
  }

  const { patch: autoMarkDonePatch, mismatches } = planAutoMarkDoneSettingsSync(
    {
      environmentId: reference.environment.environmentId,
      projectId: reference.projectId,
      settings: referenceSettings,
    },
    displayTargets.map((target) => ({
      environmentId: target.environment.environmentId,
      projectId: target.projectId,
      label: target.environment.label,
      settings: target.settings,
    })),
  );

  const afterDays = referenceSettings.sidebarAutoMarkDoneAfterDays;

  return (
    <View className="gap-6">
      {!projectSelected ? (
        <SettingsSection title="Usage limits">
          <SettingsSwitchRow
            icon="clock"
            label="Auto-resume limited threads"
            value={uniformMobileSetting(displayTargets, "autoResumeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ autoResumeLimitedThreads: value })}
          />
          <SettingsSwitchRow
            icon="clock"
            label="Snooze limited threads"
            value={uniformMobileSetting(displayTargets, "snoozeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ snoozeLimitedThreads: value })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Automatically mark as Done">
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label="Automatically mark merged threads as Done"
          value={referenceSettings.sidebarAutoMarkDoneOnMerge}
          disabled={disabled}
          onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneOnMerge: value })}
        />
        <SettingsSwitchRow
          icon="clock"
          label="Automatically mark inactive threads as Done"
          value={afterDays !== null}
          disabled={disabled}
          onValueChange={(value) =>
            writeToAll({ sidebarAutoMarkDoneAfterDays: value ? AUTO_MARK_DONE_DEFAULT_DAYS : null })
          }
        />
        {afterDays !== null ? (
          <View className="flex-row items-center gap-4 px-4 py-4 android:min-h-14 android:py-3">
            <View className="w-[22px] android:w-6" />
            <Text className="flex-1 text-foreground text-lg android:text-base">Inactive days</Text>
            <AutoMarkDoneDaysField
              value={afterDays}
              disabled={disabled}
              onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneAfterDays: value })}
            />
          </View>
        ) : null}
        {afterDays !== null ? (
          <SettingsSwitchRow
            icon={PullRequestGlyph.pullRequest}
            label="Keep threads with an open PR"
            subtitle="Inactivity does not mark threads with an open pull request as Done."
            value={referenceSettings.sidebarAutoMarkDoneKeepPullRequests}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneKeepPullRequests: value })}
          />
        ) : null}
      </SettingsSection>
      {!disabled && mismatches.length > 0 ? (
        <SettingsSection title="Across environments">
          <View className="gap-3 p-4">
            <Text className="text-base text-foreground">
              Automatically mark as Done defaults differ
            </Text>
            <Text className="text-sm text-foreground-muted">
              {mismatches.map((mismatch) => mismatch.label).join(", ")}
            </Text>
            <Button
              label="Apply automatic completion defaults"
              tone="secondary"
              disabled={disabled}
              onPress={() => writeToAll(autoMarkDonePatch)}
            />
          </View>
        </SettingsSection>
      ) : null}
    </View>
  );
}

export function ComposerSettingsSection() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const showSkillsInSlashMenu = useAtomValue(showSkillsInSlashMenuAtom);

  return (
    <SettingsSection title="Composer">
      <SettingsSwitchRow
        icon="terminal"
        label="Show skills in slash menu"
        subtitle="Show skills when you type /. Skills always appear when you type $."
        value={showSkillsInSlashMenu}
        onValueChange={(value) => savePreferences({ showSkillsInSlashMenu: value })}
      />
    </SettingsSection>
  );
}
