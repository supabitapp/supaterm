import { Button } from "../../components/ui/Button";
import { AutoMarkDoneDaysField } from "./components/AutoMarkDoneDaysField";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";

import { DEFAULT_SERVER_SETTINGS } from "@supaterm/contracts";
import { AppText as Text } from "../../components/ui/AppText";
import {
  mobilePreferencesAtom,
  showSkillsInSlashMenuAtom,
  saveMobilePreferences,
} from "../../state/preferences";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import {
  planAutoMarkDoneSettingsSync,
  type AutoMarkDoneSettings,
} from "./autoMarkDoneSettingsSync";
import { uniformMobileSetting, type ScopedMobileSettingsTarget } from "./settings-scoped-server";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";
import { T, useGT } from "gt-react-native";

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 7;

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
  const gt = useGT();
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
        <SettingsSection title={gt("Usage limits")}>
          <SettingsSwitchRow
            icon="clock"
            label={gt("Resume after usage limits")}
            value={uniformMobileSetting(displayTargets, "autoResumeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ autoResumeLimitedThreads: value })}
          />
          <SettingsSwitchRow
            icon="clock"
            label={gt("Snooze until limits reset")}
            value={uniformMobileSetting(displayTargets, "snoozeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ snoozeLimitedThreads: value })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title={gt("Automatically mark as Done")}>
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label={gt("Automatically mark merged threads as Done")}
          value={referenceSettings.sidebarAutoMarkDoneOnMerge}
          disabled={disabled}
          onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneOnMerge: value })}
        />
        <SettingsSwitchRow
          icon="clock"
          label={gt("Automatically mark inactive threads as Done")}
          value={afterDays !== null}
          disabled={disabled}
          onValueChange={(value) =>
            writeToAll({ sidebarAutoMarkDoneAfterDays: value ? AUTO_MARK_DONE_DEFAULT_DAYS : null })
          }
        />
        {afterDays !== null ? (
          <View className="flex-row items-center gap-4 px-4 py-4 android:min-h-14 android:py-3">
            <View className="w-[22px] android:w-6" />
            <Text className="flex-1 text-foreground text-lg android:text-base">
              <T>Inactive days</T>
            </Text>
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
            label={gt("Keep threads with an open PR")}
            subtitle={gt("Inactivity does not mark threads with an open pull request as Done.")}
            value={referenceSettings.sidebarAutoMarkDoneKeepPullRequests}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneKeepPullRequests: value })}
          />
        ) : null}
      </SettingsSection>
      {!disabled && mismatches.length > 0 ? (
        <SettingsSection title={gt("Across environments")}>
          <View className="gap-3 p-4">
            <Text className="text-base text-foreground">
              <T>Automatically mark as Done defaults differ</T>
            </Text>
            <Text className="text-sm text-foreground-muted">
              {mismatches.map((mismatch) => mismatch.label).join(", ")}
            </Text>
            <Button
              label={gt("Apply automatic completion defaults")}
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
  const gt = useGT();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const showSkillsInSlashMenu = useAtomValue(showSkillsInSlashMenuAtom);

  return (
    <SettingsSection title={gt("Composer")}>
      <SettingsSwitchRow
        icon="terminal"
        label={gt("Show skills in slash menu")}
        subtitle={gt("Show skills when you type /. Skills always appear when you type $.")}
        value={showSkillsInSlashMenu}
        onValueChange={(value) => savePreferences({ showSkillsInSlashMenu: value })}
      />
    </SettingsSection>
  );
}

export function NewThreadSettingsSection() {
  const gt = useGT();
  const savePreferences = useAtomCommand(saveMobilePreferences);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const useLastProject =
    AsyncResult.isSuccess(preferences) && preferences.value.useLastProjectForNewThreads !== false;

  return (
    <SettingsSection title={gt("New threads")}>
      <SettingsSwitchRow
        icon="square.and.pencil"
        label={gt("Use last project")}
        subtitle={gt("Start new threads in the last project you used on this device.")}
        value={useLastProject}
        onValueChange={(value) => {
          void savePreferences({ useLastProjectForNewThreads: value });
        }}
      />
    </SettingsSection>
  );
}
