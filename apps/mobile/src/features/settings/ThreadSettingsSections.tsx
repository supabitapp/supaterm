import { Button } from "../../components/ui/Button";
import { AuthSettingsWriteScope, type ServerSettingsPatch } from "@supaterm/contracts";
import { useEnvironmentsWithScope } from "../../state/session";
import { AutoMarkDoneDaysField } from "./components/AutoMarkDoneDaysField";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DEFAULT_SERVER_SETTINGS } from "@supaterm/contracts";
import { supportsSharedSettingsSync } from "@supaterm/client-runtime/state/shared-settings";
import { AppText as Text } from "../../components/ui/AppText";
import { useEnvironments } from "../../state/environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsSwitchRow } from "./components/SettingsSwitchRow";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  planAutoMarkDoneSettingsSync,
  type AutoMarkDoneSettings,
} from "./autoMarkDoneSettingsSync";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";
import { resolveMobileSettingsTargets, uniformMobileSetting } from "./settings-scoped-server";

export function SettingsLabsRouteScreen() {
  const insets = useSafeAreaInsets();

  return (
    <SettingsScreen title="Labs">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <BetaSettingsSection />
        <GuestSharingSettingsSection />
      </ScrollView>
    </SettingsScreen>
  );
}

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_SERVER_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 3;

/**
 * Usage-limit and auto-mark Done rows. The Threads page owns their writes, so they share its queue
 * with the page's other project overrides, and their project override reset.
 */
export function AutoMarkDoneSettingsRows(props: {
  readonly write: (patch: ServerSettingsPatch) => void;
  readonly pending: boolean;
}) {
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const writableEnvironments = useEnvironmentsWithScope(selectedTargets, AuthSettingsWriteScope);
  const projectSelected = selectedProjectKey !== null;

  const projectMembers = projectSelected
    ? (selectedProject?.members.map((member) => member.project) ?? [])
    : null;
  const displayTargets = resolveMobileSettingsTargets(
    selectedTargets.filter(supportsSharedSettingsSync),
    projectMembers,
  );
  // The page saves to all its targets, so any read-only one blocks the save.
  const canWriteSettings =
    displayTargets.length > 0 &&
    resolveMobileSettingsTargets(selectedTargets, projectMembers).every((target) =>
      writableEnvironments.has(target.environment.environmentId),
    );
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
  ) => props.write(patch);

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

  const disabled = !canWriteSettings || props.pending;
  const afterDays = referenceSettings.sidebarAutoMarkDoneAfterDays;

  return (
    <View className="gap-6">
      {!projectSelected ? (
        <SettingsSection title="Usage limits">
          <SettingsSwitchRow
            icon="clock"
            label="Resume after usage limits"
            value={uniformMobileSetting(displayTargets, "autoResumeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ autoResumeLimitedThreads: value })}
          />
          <SettingsSwitchRow
            icon="clock"
            label="Snooze until limits reset"
            value={uniformMobileSetting(displayTargets, "snoozeLimitedThreads")}
            disabled={disabled}
            onValueChange={(value) => writeToAll({ snoozeLimitedThreads: value })}
          />
        </SettingsSection>
      ) : null}
      <SettingsSection title="Auto-mark Done">
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label="Keep open pull requests"
          value={referenceSettings.sidebarAutoMarkDoneKeepPullRequests}
          disabled={disabled}
          onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneKeepPullRequests: value })}
        />
        <SettingsSwitchRow
          icon="arrow.triangle.branch"
          label="Auto-mark Done merged threads"
          value={referenceSettings.sidebarAutoMarkDoneOnMerge}
          disabled={disabled}
          onValueChange={(value) => writeToAll({ sidebarAutoMarkDoneOnMerge: value })}
        />
        <SettingsSwitchRow
          icon="clock"
          label="Auto-mark Done inactive threads"
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
      </SettingsSection>
      {!props.pending && mismatches.length > 0 ? (
        <SettingsSection title="Across environments">
          <View className="gap-3 p-4">
            <Text className="text-base text-foreground">Auto-mark Done defaults differ</Text>
            <Text className="text-sm text-foreground-muted">
              {mismatches.map((mismatch) => mismatch.label).join(", ")}
            </Text>
            <Button
              label="Apply auto-mark Done defaults"
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

export function NewThreadSettingsSection() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const useLastProject =
    AsyncResult.isSuccess(preferences) && preferences.value.useLastProjectForNewThreads !== false;

  return (
    <SettingsSection title="New threads">
      <SettingsSwitchRow
        icon="square.and.pencil"
        label="Use last project"
        subtitle="Start new threads in the last project you used on this device."
        value={useLastProject}
        onValueChange={(value) => savePreferences({ useLastProjectForNewThreads: value })}
      />
    </SettingsSection>
  );
}

/** Per machine, since each machine's own setting decides whether it links and answers links. */
function BetaSettingsSection() {
  const { environments } = useEnvironments();
  const supported = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" &&
      environment.serverConfig?.environment.capabilities.peerLinks === true,
  );
  const writable = useEnvironmentsWithScope(supported, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "linked environments beta update",
    reportFailure: true,
  });
  if (supported.length === 0) return null;
  return (
    <View className="gap-3">
      <SettingsSection title="Beta: Linked environments">
        {supported.map((environment) => (
          <SettingsSwitchRow
            key={environment.environmentId}
            icon="link"
            label={environment.label}
            value={environment.serverConfig?.settings.linkedEnvironmentsEnabled === true}
            disabled={!writable.has(environment.environmentId)}
            onValueChange={(value) =>
              void updateSettings({
                environmentId: environment.environmentId,
                input: { patch: { linkedEnvironmentsEnabled: value } },
              })
            }
          />
        ))}
      </SettingsSection>
      <Text className="px-2 text-sm text-foreground-muted">
        Let agents on a machine work on your other machines, and theirs on it. Turn it on for each
        machine. While it is off, nothing new starts over a link; tasks already running finish.
      </Text>
    </View>
  );
}

function GuestSharingSettingsSection() {
  const { environments } = useEnvironments();
  const connected = environments.filter(
    (environment) => environment.connection.phase === "connected",
  );
  const writable = useEnvironmentsWithScope(connected, AuthSettingsWriteScope);
  const updateSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "guest sharing beta update",
    reportFailure: true,
  });
  if (connected.length === 0) return null;
  return (
    <SettingsSection title="Beta: Guest sharing">
      {connected.map((environment) => (
        <SettingsSwitchRow
          key={environment.environmentId}
          icon="link"
          label={environment.label}
          subtitle="Share a live thread over an encrypted connection. You approve guest messages before they reach the agent."
          value={environment.serverConfig?.settings.guestSharingEnabled === true}
          disabled={!writable.has(environment.environmentId)}
          onValueChange={(value) =>
            void updateSettings({
              environmentId: environment.environmentId,
              input: { patch: { guestSharingEnabled: value } },
            })
          }
        />
      ))}
    </SettingsSection>
  );
}
