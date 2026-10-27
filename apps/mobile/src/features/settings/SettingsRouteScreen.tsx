import { Toolbar } from "../../components/ui/Toolbar";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useNavigation } from "@react-navigation/native";
import { Platform, View } from "react-native";
import { deriveProjectGroupLabel } from "@supaterm/client-runtime/state/project-grouping";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAdaptiveWorkspaceLayout } from "../layout/AdaptiveWorkspaceLayout";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsRow } from "./components/SettingsRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import {
  AndroidSettingsEnvironmentFilter,
  SettingsEnvironmentFilterHeader,
} from "./components/SettingsEnvironmentFilterHeader";
import { useSettingsEnvironmentFilter } from "./settings-environment-filter";

export function SettingsRouteScreen() {
  const navigation = useNavigation();
  const { layout } = useAdaptiveWorkspaceLayout();
  const content = <SettingsRouteContent />;

  return (
    <>
      {Platform.OS === "ios" ? (
        <NativeStackScreenOptions options={{ headerBackVisible: !layout.usesSplitView }} />
      ) : null}
      {Platform.OS === "ios" && layout.usesSplitView ? (
        <>
          <Toolbar placement="left">
            <Toolbar.Button
              accessibilityLabel="Go back"
              icon="chevron.left"
              onPress={() => navigation.goBack()}
            />
          </Toolbar>
        </>
      ) : null}
      <SettingsEnvironmentFilterHeader closeSettings />
      {Platform.OS === "android" ? (
        <SettingsScreen title="Settings" trailing={<AndroidSettingsEnvironmentFilter />}>
          {content}
        </SettingsScreen>
      ) : (
        content
      )}
    </>
  );
}

function SettingsRouteContent() {
  const insets = useSafeAreaInsets();
  const { savedConnectionsById } = useSavedRemoteConnections();
  const environmentCount = Object.keys(savedConnectionsById).length;

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
        }}
      >
        <SettingsSection title="Connections">
          <SettingsRow
            icon="desktopcomputer"
            label="Environments"
            value={`${environmentCount}`}
            valuePosition="trailing"
            target="SettingsEnvironments"
          />
        </SettingsSection>

        <SettingsIndexSections />
      </ScrollView>
    </View>
  );
}

function SettingsIndexSections() {
  const { selectedTargets, projectGroups, selectedProjectKey } = useSettingsEnvironmentFilter();
  const noServerTargets = selectedTargets.length === 0;
  const selectedProject = projectGroups.find((group) => group.key === selectedProjectKey);
  const scopedProjectMembers =
    selectedProject?.members
      .map((member) => member.project)
      .filter((project) =>
        selectedTargets.some((target) => target.environmentId === project.environmentId),
      ) ?? [];
  const projectLabel =
    scopedProjectMembers.length > 0
      ? deriveProjectGroupLabel({
          representative: scopedProjectMembers[0]!,
          members: scopedProjectMembers,
        })
      : (selectedProject?.label ?? "Unavailable project");
  return (
    <>
      <SettingsSection>
        <SettingsRow icon="gearshape" label="General" target="SettingsOrganization" />
        <SettingsRow icon="paintbrush" label="Appearance" target="SettingsAppearance" />
        <SettingsRow icon="bubble.left.and.bubble.right" label="Chat" target="SettingsFollowUp" />
        {Platform.OS === "ios" ? (
          <>
            <SettingsRow icon="keyboard" label="Keyboard" target="SettingsKeyboard" />
            <SettingsRow icon="mic" label="Microphone" target="SettingsMicrophone" />
          </>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Agents">
        <SettingsRow
          icon="person.crop.circle"
          label="Providers"
          target="SettingsProviderAccounts"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="text.bubble"
          label="Threads"
          target="SettingsThreads"
          disabled={noServerTargets}
        />
        <SettingsRow icon="clock" label="Scheduled tasks" target="SettingsScheduledTasks" />
      </SettingsSection>

      <SettingsSection title="Code">
        <SettingsRow
          icon="folder"
          label="Projects"
          value={selectedProjectKey === null ? "Choose a project" : projectLabel}
          target="SettingsProjectOverview"
        />
        <SettingsRow
          icon="arrow.triangle.branch"
          label="Source control"
          target="SettingsEnvironmentSourceControl"
          disabled={noServerTargets}
        />
        <SettingsRow
          icon="square.on.square"
          label="Worktrees"
          target="SettingsWorktrees"
          disabled={noServerTargets}
        />
      </SettingsSection>

      <SettingsSection>
        <SettingsRow
          icon="arrow.clockwise"
          label="Maintenance"
          target="SettingsEnvironmentMaintenance"
          disabled={noServerTargets}
        />
        <SettingsRow icon="chart.bar.xaxis" label="Usage" target="SettingsUsage" />
        <SettingsRow icon="info.circle" label="About" target="SettingsAbout" />
        <SettingsRow icon="archivebox" label="Archive" target="SettingsArchive" />
      </SettingsSection>
    </>
  );
}
