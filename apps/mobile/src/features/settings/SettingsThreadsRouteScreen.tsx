import { Button } from "../../components/ui/Button";
import { AuthSettingsWriteScope } from "@supaterm/contracts";
import { readEnvironmentScope, useEnvironmentsWithScope } from "../../state/session";
import { AutoMarkDoneDaysField } from "./components/AutoMarkDoneDaysField";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { useRef, useState } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DEFAULT_SERVER_SETTINGS } from "@supaterm/contracts";
import { supportsSharedSettingsSync } from "@supaterm/client-runtime/state/shared-settings";
import { AppText as Text } from "../../components/ui/AppText";
import { showSkillsInSlashMenuAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsProjectOverridesSection } from "./components/SettingsProjectOverridesSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import {
  AUTO_MARK_DONE_KEYS,
  planAutoMarkDoneSettingsSync,
  type AutoMarkDoneSettings,
} from "./autoMarkDoneSettingsSync";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { useSettingsWriter } from "./useSettingsWriter";
import {
  planMobileScopedSettingsClear,
  planMobileScopedSettingsPatch,
  resolveMobileSettingsTargets,
  uniformMobileSetting,
  type ScopedMobileSettingsTarget,
} from "./settings-scoped-server";
import { PullRequestGlyph } from "../pull-requests/pullRequestGlyphs";

export function SettingsThreadsRouteScreen() {
  const insets = useSafeAreaInsets();

  return (
    <>
      <SettingsEnvironmentFilterHeader />
      <SettingsScreen title="Thread behavior" trailing={<AndroidSettingsEnvironmentFilter />}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          showsVerticalScrollIndicator={false}
          className="flex-1"
          contentContainerClassName="gap-6 px-5 pt-4"
          contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
        >
          <ThreadBehaviorSettingsRows />
          <ComposerSettingsSection />
        </ScrollView>
      </SettingsScreen>
    </>
  );
}

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 3;

function ThreadBehaviorSettingsRows() {
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const writableEnvironments = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const projectSelected = selectedProjectKey !== null;
  const [pendingWrites, setPendingWrites] = useState(0);
  const writeInFlight = useRef(false);
  const [pendingTargets, setPendingTargets] = useState<
    readonly ScopedMobileSettingsTarget[] | null
  >(null);
  const writeSettings = useSettingsWriter();

  const syncEnvironments = selectedTargets.filter(supportsSharedSettingsSync);
  const syncTargets = resolveMobileSettingsTargets(
    syncEnvironments,
    projectSelected ? (selectedProject?.members.map((member) => member.project) ?? []) : null,
  );
  const canWriteSettings =
    syncTargets.length > 0 &&
    syncTargets.every((target) => writableEnvironments.has(target.environment.environmentId));
  const displayTargets =
    pendingWrites > 0 && pendingTargets !== null ? pendingTargets : syncTargets;
  const reference = displayTargets[0] ?? null;
  const referenceSettings = reference?.settings ?? null;

  if (reference === null || referenceSettings === null) {
    return null;
  }

  const writeToAll = (
    patch: Partial<AutoMarkDoneSettings> & {
      autoResumeLimitedThreads?: boolean;
      snoozeLimitedThreads?: boolean;
    },
  ) => {
    if (
      writeInFlight.current ||
      !syncTargets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = planMobileScopedSettingsPatch(syncTargets, projectSelected, patch);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(syncTargets);
    setPendingWrites((count) => count + 1);
    void writeSettings(syncTargets, writes).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
    });
  };

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

  const supportsProjectOverrides = syncTargets.every(
    (target) => target.environment.serverConfig != null,
  );
  const disabled =
    !canWriteSettings || pendingWrites > 0 || (projectSelected && !supportsProjectOverrides);
  const hasProjectOverrides =
    projectSelected &&
    syncTargets.some((target) =>
      AUTO_MARK_DONE_KEYS.some((key) => target.sources[key] === "project"),
    );
  const clearProjectOverrides = () => {
    if (
      writeInFlight.current ||
      !syncTargets.every((target) =>
        readEnvironmentScope(target.environment.environmentId, AuthSettingsWriteScope),
      )
    )
      return;
    const writes = planMobileScopedSettingsClear(syncTargets, AUTO_MARK_DONE_KEYS);
    if (writes.length === 0) return;
    writeInFlight.current = true;
    setPendingTargets(syncTargets);
    setPendingWrites((count) => count + 1);
    void writeSettings(syncTargets, writes).finally(() => {
      writeInFlight.current = false;
      setPendingTargets(null);
      setPendingWrites((count) => count - 1);
    });
  };

  const afterDays = referenceSettings.sidebarAutoMarkDoneAfterDays;

  return (
    <View className="gap-6">
      {projectSelected ? (
        <SettingsProjectOverridesSection
          projectLabel={selectedProject?.label ?? "Unavailable project"}
          hasOverrides={hasProjectOverrides}
          supportsOverrides={supportsProjectOverrides}
          pending={pendingWrites > 0}
          disabled={!canWriteSettings}
          onClear={clearProjectOverrides}
        />
      ) : null}
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
      {pendingWrites === 0 && mismatches.length > 0 ? (
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

function ComposerSettingsSection() {
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
