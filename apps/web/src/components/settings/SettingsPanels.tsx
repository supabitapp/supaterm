import { useAtomValue } from "@effect/atom-react";
import { THREAD_GROUPING_OPTIONS } from "@supaterm/client-runtime/state/thread-grouping";
import { NotificationSettings } from "./NotificationSettings";
import { PRIVACY_POLICY_URL } from "../../legalLinks";
import { CheckIcon } from "@supaterm/icons";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  type DesktopUpdateChannel,
  ProviderDriverKind,
  type ProviderInstanceId,
  type SidebarProjectGroupingMode,
} from "@supaterm/contracts";
import {
  DEFAULT_UNIFIED_SETTINGS,
  type ResponseStreamingMode,
  SidebarProjectSortOrder,
  ScreenReaderAnnouncements,
  ToolCallVisibility,
} from "@supaterm/contracts/settings";
import { desktopUpdateChannelOf } from "@supaterm/shared/cliRelease";
import { createModelSelection, pickModelSelection } from "@supaterm/shared/model";
import { resolvePastedPath } from "@supaterm/shared/path";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { AboutVersionTitle } from "./AboutVersionTitle";
import { CliCommandSettingsRow } from "./CliCommandSettingsRow";
import { MobileAppSettingsRow } from "./MobileAppSettingsRow";
import { DaysField } from "./DaysField";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateDisabledReason,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktopUpdate.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { TraitsPicker } from "../chat/TraitsPicker";
import { isElectron } from "../../env";
import { buildHostedChannelSelectionUrl, type HostedAppChannel } from "../../hostedPairing";
import {
  readAppearanceModePreference,
  readThemeHalves,
  readThemePreference,
  useTheme,
} from "../../hooks/useTheme";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";
import { useScopedModelDisabledReason } from "./useScopedModelAvailability";
import { useSettingsScope } from "./SettingsScopeContext";
import { ProjectDefaultsSettings } from "./ProjectDefaultsSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { desktopUpdateRestart } from "../../state/desktopUpdateRestart";
import {
  getTextGenerationModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { formatBytes } from "../../lib/formatBytes";
import { isMacPlatform } from "../../lib/utils";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS, serverEnvironment } from "../../state/server";
import { Button } from "../ui/button";
import { DraftInput } from "../ui/draft-input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { ScopedSwitch } from "./ScopedSwitch";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  getChangedBrowserSettingLabels,
  getChangedTypographySettingLabels,
  hasChangedBackgroundActivitySettings,
  isProjectGroupingEnabled,
  projectGroupingModeFromToggle,
  readLastEnabledProjectGroupingMode,
  rememberEnabledProjectGroupingMode,
} from "./SettingsPanels.logic";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import { useSearchableSetting } from "./settingsSearch";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";
import { PullRequestLinksOpenInAppSetting } from "./IntegrationsSettings";
import { OrchestrationSkillsSettings } from "./OrchestrationSkillsSettings";
import { StorageCleanupSections } from "./StorageSettings";
import { UpdateTrackSwitchDialog } from "./UpdateTrackSwitchDialog";
import { environmentIdsKey } from "~/state/environmentAtomList";
import { environmentSessionStatesAtom } from "~/state/session";
import { useCheckProviderUpdates } from "../ProviderUpdatesAction";
import { canUpdateServer } from "../ServerUpdateAction";
import { downloadLocalUpdate } from "../sidebar/SidebarUpdatePill";
import { useUpdateEverythingRun } from "../sidebar/updateEverythingRun";
import { awaitsTrackSwitch, channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { isHostedByThisApp } from "../sidebar/useUpdateEverything";
import { msg, T, useGT, useMessages } from "gt-react";
import { nativeLanguageName, SYSTEM_LANGUAGE } from "@supaterm/client-runtime/locales";
import { SUPPORTED_LOCALES } from "../../i18n/locales";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: msg("Wait for the full response"),
  paragraph: msg("Show finished paragraphs"),
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: msg("Last user message"),
  created_at: msg("Created at"),
  manual: msg("Manual"),
};
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionSection() {
  const searchableSetting = useSearchableSetting();
  const messages = useMessages();
  const gt = useGT();
  const updateState = useDesktopUpdateState();
  const [switchChannel, setSwitchChannel] = useState<DesktopUpdateChannel | null>(null);
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const { environments } = useEnvironments();
  const sessionStates = useAtomValue(
    environmentSessionStatesAtom(
      environmentIdsKey(environments.map(({ environmentId }) => environmentId)),
    ),
  );
  // A second run would replace the first run's progress and local download.
  const updateRun = useUpdateEverythingRun();
  const checkProviderUpdates = useCheckProviderUpdates();

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;
  // A switch that failed part way leaves this app or a server on the other track.
  // With its updater off, a switch cannot move this app, so it is not counted.
  const appOffTrack =
    updateState?.enabled !== false && desktopUpdateChannelOf(APP_VERSION) !== selectedUpdateChannel;
  const unswitchedMachines =
    (appOffTrack ? 1 : 0) +
    environments.filter(
      (environment, index) =>
        environment.connection.phase === "connected" &&
        canUpdateServer(sessionStates[index]!) &&
        awaitsTrackSwitch(
          {
            serverConfig: environment.serverConfig,
            hostedByThisApp: isHostedByThisApp(environment),
          },
          selectedUpdateChannel,
        ),
    ).length;

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void downloadLocalUpdate(bridge, { notifyDownloaded: false });
      return;
    }

    if (action === "install") {
      if (isUpdateActionPending) return;
      setIsUpdateActionPending(true);
      let confirmed = false;
      try {
        confirmed = await ensureLocalApi().dialogs.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
            messages,
          ),
          { initialFocus: "confirm" },
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not confirm update"),
            description: error instanceof Error ? error.message : gt("Update confirmation failed."),
          }),
        );
        return;
      }
      if (!confirmed) {
        setIsUpdateActionPending(false);
        return;
      }
      void desktopUpdateRestart
        .install(bridge)
        .catch((error: unknown) => {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Could not install update"),
              description: error instanceof Error ? error.message : gt("Install failed."),
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void checkProviderUpdates();
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: gt("Could not check for updates"),
              description:
                result.state.message ?? gt("Automatic updates are not available in this build."),
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: gt("Could not check for updates"),
            description: error instanceof Error ? error.message : gt("Update check failed."),
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState, messages) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: gt("Download"), install: gt("Install") };
  const statusLabel: Record<string, string> = {
    checking: gt("Checking…"),
    downloading: gt("Downloading…"),
    // Off its track, "up to date" only means no switch is pending; Review moves it.
    ...(appOffTrack ? {} : { "up-to-date": gt("Up to Date") }),
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? gt("Check for Updates");
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : (getDesktopUpdateDisabledReason(updateState, messages) ?? null);

  return (
    <>
      <SettingsRow
        id={searchableSetting("app-version").id}
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant="outline"
                  disabled={buttonDisabled || isUpdateActionPending}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      {hasDesktopBridge ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          description={
            unswitchedMachines > 0 ? (
              <>
                {gt(
                  "{count, plural, one {{count} machine still runs {track}.} other {{count} machines still run {track}.}}",
                  {
                    count: unswitchedMachines,
                    track: channelSwitchLabel(
                      selectedUpdateChannel === "nightly" ? "latest" : "nightly",
                      messages,
                    ),
                  },
                )}{" "}
                {/* The dialog moves what it can and says why it skips the rest. */}
                <Button
                  size="xs"
                  variant="link"
                  disabled={updateRun !== null}
                  onClick={() => setSwitchChannel(selectedUpdateChannel)}
                >
                  <T>Review</T>
                </Button>
              </>
            ) : (
              gt(
                "Switches this app and every connected machine whose database the target release supports.",
              )
            )
          }
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                if (value !== selectedUpdateChannel) {
                  setSwitchChannel(value as DesktopUpdateChannel);
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Update track")}
                disabled={switchChannel !== null || updateRun !== null}
              >
                <SelectValue>{channelSwitchLabel(selectedUpdateChannel, messages)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  <T>Stable</T>
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  <T>Nightly</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : selectedHostedAppChannel ? (
        <SettingsRow
          {...searchableSetting("update-track")}
          control={
            <Select
              value={selectedHostedAppChannel}
              onValueChange={(value) => {
                if (value === selectedHostedAppChannel) return;
                window.location.assign(
                  buildHostedChannelSelectionUrl({ channel: value as HostedAppChannel }),
                );
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Update track")}>
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  <T>Latest</T>
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  <T>Nightly</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
      {switchChannel === null ? null : (
        <UpdateTrackSwitchDialog channel={switchChannel} onClose={() => setSwitchChannel(null)} />
      )}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const gt = useGT();
  const {
    theme,
    setTheme,
    followSystem,
    setFollowSystem,
    setThemeHalf,
    clearThemeHalves,
    themeHalves,
  } = useTheme();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isBackgroundActivityDirty = hasChangedBackgroundActivitySettings(settings);

  const changedSettingLabels = [
    ...(theme !== "system" ? [gt("Theme")] : []),
    ...(!followSystem ? [gt("Follow system")] : []),
    ...(themeHalves !== null ? [gt("Theme mix")] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? [gt("Contrast")]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? [gt("Diff colors")]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? [gt("Chat width")] : []),
    ...(settings.htmlPreviewWidth !== DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth
      ? [gt("HTML preview width")]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? [gt("Render math")]
      : []),
    ...(settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? [gt("Language")] : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? [gt("Time format")]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? [gt("Thread notifications")]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? [gt("In-app notifications")]
      : []),
    ...(settings.sidebarThreadGrouping !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping
      ? ["Thread grouping"]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? [gt("Project Grouping")]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? [gt("Project order")]
      : []),
    ...(settings.sidebarAutoMarkDoneAfterDays !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays
      ? ["Automatically mark inactive threads as Done"]
      : []),
    ...(settings.sidebarAutoMarkDoneKeepPullRequests !==
    DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneKeepPullRequests
      ? ["Keep threads with an open PR"]
      : []),
    ...(settings.sidebarAutoMarkDoneOnMerge !== DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneOnMerge
      ? ["Automatically mark merged threads as Done"]
      : []),
    ...(settings.autoResumeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads
      ? [gt("Resume after usage limits")]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? [gt("Snooze until limits reset")]
      : []),
    ...(!Equal.equals(settings.snoozePresets, DEFAULT_UNIFIED_SETTINGS.snoozePresets)
      ? [gt("Snooze options")]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? [gt("Word wrap")] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? ["Usage limits"]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? ["Collapse diff files"]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? [gt("Diff whitespace changes")]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? [gt("Diff layout")] : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? [gt("Open pull requests and changes panels proactively")]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? [gt("Show skills in slash menu")]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? [gt("Rich text composer")]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? ["Send shortcut"] : []),
    ...(settings.voiceLanguage !== DEFAULT_UNIFIED_SETTINGS.voiceLanguage
      ? ["Voice language"]
      : []),
    ...(settings.voiceHoldToTalkKey !== DEFAULT_UNIFIED_SETTINGS.voiceHoldToTalkKey
      ? ["Hold to talk"]
      : []),
    ...(settings.voiceMicrophone !== DEFAULT_UNIFIED_SETTINGS.voiceMicrophone
      ? ["Microphone"]
      : []),
    ...(settings.voiceAvoidBluetoothMicrophone !==
    DEFAULT_UNIFIED_SETTINGS.voiceAvoidBluetoothMicrophone
      ? ["Use the Mac's microphone instead of Bluetooth"]
      : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? [gt("Follow-up behavior")]
      : []),
    ...(settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility
      ? [gt("Tool calls in chat")]
      : []),
    ...(settings.screenReaderAnnouncements !== DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements
      ? [gt("Screen reader announcements")]
      : []),
    ...(settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle
      ? [gt("Screen reader window title")]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? [gt("Response streaming")]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? [gt("Provider update checks")]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? [gt("Continue threads after restarts")]
      : []),
    ...(isBackgroundActivityDirty ? [gt("Background activity")] : []),
    ...(settings.keepAwakeWhileAgentsWork !== DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork
      ? [gt("Keep awake while agents work")]
      : []),
    ...(settings.pruneEventHistory !== DEFAULT_UNIFIED_SETTINGS.pruneEventHistory
      ? [gt("Delete history older than a day")]
      : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? [gt("New thread mode")]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? [gt("New worktrees start from remote")]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? [gt("Add project base directory")]
      : []),
    ...(settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout
      ? [gt("Clone into host folders")]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? [gt("Unpin confirmation")]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? [gt("Archive confirmation")]
      : []),
    ...(settings.confirmTerminalClose !== DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose
      ? [gt("Terminal close confirmation")]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? [gt("Delete confirmation")]
      : []),
    ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ...(settings.threadTitleInstructions !== DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions
      ? [gt("Thread title instructions")]
      : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? [gt("Agent browser access")]
      : []),
  ];

  const restoreDefaults = async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
      { variant: "destructive" },
    );
    if (!confirmed) return;

    // Reset only dirty theme keys so storage failures cannot block other settings; re-read after confirmation
    // for safe rollback.
    let previousTheme = theme;
    try {
      previousTheme = readThemePreference();
    } catch {}
    const liveHalves = readThemeHalves();
    const needsThemeReset = previousTheme !== "system";
    const needsMixReset = liveHalves !== null;
    const needsFollowSystemReset = readAppearanceModePreference(previousTheme) !== "system";
    const notifyThemeRestoreFailure = () => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: gt("Couldn’t restore theme settings"),
          description: gt("Try again."),
        }),
      );
    };
    // Restore the base preference before the mix because restoring the base clears the mix.
    const previousHalves = liveHalves;
    const rollbackThemeState = () => {
      if (needsThemeReset) setTheme(previousTheme);
      if (previousHalves?.light) setThemeHalf("light", previousHalves.light);
      if (previousHalves?.dark) setThemeHalf("dark", previousHalves.dark);
    };
    if (needsThemeReset && !setTheme("system")) {
      notifyThemeRestoreFailure();
      return;
    }
    if (needsMixReset && !clearThemeHalves()) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    if (needsFollowSystemReset && !setFollowSystem(true)) {
      rollbackThemeState();
      notifyThemeRestoreFailure();
      return;
    }
    updateSettings({
      appearanceContrast: DEFAULT_UNIFIED_SETTINGS.appearanceContrast,
      diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme,
      chatWidth: DEFAULT_UNIFIED_SETTINGS.chatWidth,
      htmlPreviewWidth: DEFAULT_UNIFIED_SETTINGS.htmlPreviewWidth,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
      language: DEFAULT_UNIFIED_SETTINGS.language,
      timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
      notificationMode: DEFAULT_UNIFIED_SETTINGS.notificationMode,
      inAppNotificationsEnabled: DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled,
      wordWrap: DEFAULT_UNIFIED_SETTINGS.wordWrap,
      persistComposerContextStrip: DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip,
      diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
      diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
      diffLayout: DEFAULT_UNIFIED_SETTINGS.diffLayout,
      proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
      showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
      composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
      sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut,
      voiceLanguage: DEFAULT_UNIFIED_SETTINGS.voiceLanguage,
      voiceHoldToTalkKey: DEFAULT_UNIFIED_SETTINGS.voiceHoldToTalkKey,
      voiceMicrophone: DEFAULT_UNIFIED_SETTINGS.voiceMicrophone,
      voiceAvoidBluetoothMicrophone: DEFAULT_UNIFIED_SETTINGS.voiceAvoidBluetoothMicrophone,
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
      toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility,
      screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
      screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
      glassOpacity: DEFAULT_UNIFIED_SETTINGS.glassOpacity,
      sidebarThreadGrouping: DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping,
      sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
      sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
      sidebarAutoMarkDoneAfterDays: DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays,
      sidebarAutoMarkDoneKeepPullRequests:
        DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneKeepPullRequests,
      sidebarAutoMarkDoneOnMerge: DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneOnMerge,
      autoResumeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.autoResumeLimitedThreads,
      snoozeLimitedThreads: DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads,
      snoozePresets: DEFAULT_UNIFIED_SETTINGS.snoozePresets,
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
      pruneEventHistory: DEFAULT_UNIFIED_SETTINGS.pruneEventHistory,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmTerminalClose: DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
      threadTitleInstructions: DEFAULT_UNIFIED_SETTINGS.threadTitleInstructions,
      fontFamilySans: DEFAULT_UNIFIED_SETTINGS.fontFamilySans,
      fontFamilyComposer: DEFAULT_UNIFIED_SETTINGS.fontFamilyComposer,
      fontFamilyCode: DEFAULT_UNIFIED_SETTINGS.fontFamilyCode,
      fontFamilyTerminal: DEFAULT_UNIFIED_SETTINGS.fontFamilyTerminal,
      fontSizeInterface: DEFAULT_UNIFIED_SETTINGS.fontSizeInterface,
      fontSizePrompt: DEFAULT_UNIFIED_SETTINGS.fontSizePrompt,
      fontSizeCode: DEFAULT_UNIFIED_SETTINGS.fontSizeCode,
      fontSizeTerminal: DEFAULT_UNIFIED_SETTINGS.fontSizeTerminal,
      browserDefaultViewport: DEFAULT_UNIFIED_SETTINGS.browserDefaultViewport,
      browserDefaultZoomFactor: DEFAULT_UNIFIED_SETTINGS.browserDefaultZoomFactor,
      browserDefaultAppearance: DEFAULT_UNIFIED_SETTINGS.browserDefaultAppearance,
      browserRecordingFrameRate: DEFAULT_UNIFIED_SETTINGS.browserRecordingFrameRate,
      browserRecordingShowKeyPresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowKeyPresses,
      browserRecordingShowMousePresses: DEFAULT_UNIFIED_SETTINGS.browserRecordingShowMousePresses,
      browserLinkTarget: DEFAULT_UNIFIED_SETTINGS.browserLinkTarget,
      browserSearchEngine: DEFAULT_UNIFIED_SETTINGS.browserSearchEngine,
      browserCustomSearchUrl: DEFAULT_UNIFIED_SETTINGS.browserCustomSearchUrl,
      browserAgentOpenTarget: DEFAULT_UNIFIED_SETTINGS.browserAgentOpenTarget,
      pullRequestLinksOpenInApp: DEFAULT_UNIFIED_SETTINGS.pullRequestLinksOpenInApp,
      enableAgentBrowserAccess: DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess,
    });
    onRestored?.();
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 7;

export function GeneralSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const languageValue = SUPPORTED_LOCALES.includes(settings.language)
    ? settings.language
    : SYSTEM_LANGUAGE;

  return (
    <SettingsPageContainer>
      <SettingsSection id="notifications" title={gt("Notifications")}>
        <NotificationSettings />
        <SettingsRow
          {...searchableSetting("in-app-notifications")}
          description={gt("Show toasts for other threads while Supaterm is focused.")}
          control={
            <Switch
              checked={settings.inAppNotificationsEnabled}
              onCheckedChange={(checked) => updateSettings({ inAppNotificationsEnabled: checked })}
              aria-label={gt("In-app notifications")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="sidebar" title={gt("Sidebar")}>
        <SettingsRow
          {...searchableSetting("thread-grouping")}
          resetAction={
            settings.sidebarThreadGrouping !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping ? (
              <SettingResetButton
                label={gt("thread grouping", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    sidebarThreadGrouping: DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarThreadGrouping}
              onValueChange={(value) => {
                const option = THREAD_GROUPING_OPTIONS.find((entry) => entry.value === value);
                if (option) updateSettings({ sidebarThreadGrouping: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-44"
                aria-label={gt("Thread grouping")}
              >
                <SelectValue>
                  {
                    THREAD_GROUPING_OPTIONS.find(
                      (option) => option.value === settings.sidebarThreadGrouping,
                    )?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THREAD_GROUPING_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("project-grouping")}
          description={<T>Combine matching repositories across environments.</T>}
          resetAction={
            settings.sidebarProjectGroupingMode !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
              <SettingResetButton
                label={gt("project grouping", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    sidebarProjectGroupingMode: DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={isProjectGroupingEnabled(settings.sidebarProjectGroupingMode)}
              onCheckedChange={(checked) => {
                if (!checked && settings.sidebarProjectGroupingMode !== "separate") {
                  lastEnabledProjectGroupingMode.current = settings.sidebarProjectGroupingMode;
                  rememberEnabledProjectGroupingMode(settings.sidebarProjectGroupingMode);
                }
                updateSettings({
                  sidebarProjectGroupingMode: projectGroupingModeFromToggle(
                    checked,
                    lastEnabledProjectGroupingMode.current,
                  ),
                });
              }}
              aria-label={gt("Project grouping")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("project-order")}
          resetAction={
            settings.sidebarProjectSortOrder !==
            DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
              <SettingResetButton
                label={gt("project order", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    sidebarProjectSortOrder: DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sidebarProjectSortOrder}
              onValueChange={(value) => {
                if (isSidebarProjectSortOrder(value)) {
                  updateSettings({ sidebarProjectSortOrder: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-44" aria-label={gt("Project order")}>
                <SelectValue>
                  {SIDEBAR_PROJECT_SORT_ORDER_LABELS[settings.sidebarProjectSortOrder]}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {SidebarProjectSortOrder.literals.map((sortOrder) => (
                  <SelectItem hideIndicator key={sortOrder} value={sortOrder}>
                    {SIDEBAR_PROJECT_SORT_ORDER_LABELS[sortOrder]}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="confirmations" title={gt("Confirmations")}>
        <SettingsRow
          {...searchableSetting("unpin-confirmation")}
          resetAction={
            settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
              <SettingResetButton
                label={gt("unpin confirmation", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadUnpin}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadUnpin: Boolean(checked) })
              }
              aria-label={gt("Confirm thread unpinning")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("archive-confirmation")}
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label={gt("archive confirmation", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
              aria-label={gt("Confirm thread archiving")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("delete-confirmation")}
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label={gt("delete confirmation", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
              aria-label={gt("Confirm thread deletion")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("terminal-close-confirmation")}
          description={<T>Ask before closing terminals and stopping their running processes.</T>}
          resetAction={
            settings.confirmTerminalClose !== DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose ? (
              <SettingResetButton
                label={gt("terminal close confirmation", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    confirmTerminalClose: DEFAULT_UNIFIED_SETTINGS.confirmTerminalClose,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmTerminalClose}
              onCheckedChange={(checked) =>
                updateSettings({ confirmTerminalClose: Boolean(checked) })
              }
              aria-label={gt("Confirm terminal closing")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="display" title={gt("Display")}>
        <SettingsRow
          {...searchableSetting("language")}
          description={<T>System default follows your browser or OS language.</T>}
          resetAction={
            settings.language !== DEFAULT_UNIFIED_SETTINGS.language ? (
              <SettingResetButton
                label={gt("language", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    language: DEFAULT_UNIFIED_SETTINGS.language,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={languageValue}
              onValueChange={(value) => {
                if (value) {
                  updateSettings({ language: value });
                }
              }}
            >
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Language")}>
                <SelectValue>
                  {languageValue === SYSTEM_LANGUAGE
                    ? gt("System default")
                    : nativeLanguageName(languageValue)}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value={SYSTEM_LANGUAGE}>
                  {gt("System default")}
                </SelectItem>
                {SUPPORTED_LOCALES.map((locale) => (
                  <SelectItem hideIndicator key={locale} value={locale}>
                    {nativeLanguageName(locale)}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("time-format")}
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label={gt("time format", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label={gt("Timestamp format")}
              >
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ChatSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const followUpOverrideShortcut = {
    enter: `${modifierLabel} + Enter`,
    "mod-enter": `${modifierLabel} + Shift + Enter`,
    "mod-enter-multiline": `${modifierLabel} + Enter, or ${modifierLabel} + Shift + Enter in multiline prompts,`,
  } as const;
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    {
      value: "mod-enter-multiline",
      label: gt("{modifierLabel} + Enter for multiline prompts", { modifierLabel }),
    },
    { value: "mod-enter", label: gt("{modifierLabel} + Enter always", { modifierLabel }) },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="composer" title={gt("Composer")}>
        <SettingsRow
          {...searchableSetting("composer-rich-text")}
          resetAction={
            settings.composerRichTextEnabled !==
            DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
              <SettingResetButton
                label={gt("rich text composer", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    composerRichTextEnabled: DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.composerRichTextEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ composerRichTextEnabled: Boolean(checked) })
              }
              aria-label={gt("Rich text composer")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("send-shortcut")}
          resetAction={
            settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
              <SettingResetButton
                label={gt("send shortcut", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({ sendShortcut: DEFAULT_UNIFIED_SETTINGS.sendShortcut })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.sendShortcut}
              onValueChange={(value) => {
                const option = sendShortcutOptions.find((option) => option.value === value);
                if (option) updateSettings({ sendShortcut: option.value });
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0 max-w-full"
                aria-label={gt("Send shortcut")}
              >
                <SelectValue>
                  {
                    sendShortcutOptions.find((option) => option.value === settings.sendShortcut)
                      ?.label
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {sendShortcutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    <span className="flex items-center justify-between gap-4">
                      {option.label}
                      {settings.sendShortcut === option.value && <CheckIcon aria-hidden="true" />}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          {...searchableSetting("skills-in-slash-menu")}
          description={gt("Skills always appear when you type $.")}
          resetAction={
            settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
              <SettingResetButton
                label={gt("skills in slash menu", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    showSkillsInSlashMenu: DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.showSkillsInSlashMenu}
              onCheckedChange={(checked) =>
                updateSettings({ showSkillsInSlashMenu: Boolean(checked) })
              }
              aria-label={gt("Show skills in slash menu")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="follow-ups" title={gt("Follow-ups")}>
        <SettingsRow
          {...searchableSetting("follow-up-behavior")}
          description={gt("While the agent runs. {shortcut} does the opposite once.", {
            shortcut: followUpOverrideShortcut[settings.sendShortcut],
          })}
          resetAction={
            settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
              <SettingResetButton
                label={gt("follow-up behavior", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.followUpBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "steer") {
                  updateSettings({ followUpBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-auto min-w-0"
                aria-label={gt("Follow-up behavior")}
              >
                <SelectValue>
                  {settings.followUpBehavior === "queue" ? gt("Queue") : gt("Steer")}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem value="queue">
                  <T>Queue</T>
                </SelectItem>
                <SelectItem value="steer">
                  <T>Steer</T>
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection id="activity" title={gt("Activity")}>
        <ToolCallVisibilityRow />
      </SettingsSection>

      <SettingsSection id="screen-reader" title={gt("Screen reader")}>
        <ScreenReaderAnnouncementsRow />
        <ScreenReaderWindowTitleRow />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const TOOL_CALL_VISIBILITY_LABELS: Record<ToolCallVisibility, string> = {
  showAll: msg("Show all"),
  hideSuccessful: msg("Hide successful"),
  hideAll: msg("Hide all"),
  zen: "Zen",
};

const isToolCallVisibility = Schema.is(ToolCallVisibility);

function ToolCallVisibilityRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("tool-call-visibility")}
      description={gt(
        "Hide the commands, edits, and searches agents run. Hide successful keeps failures. Zen shows only final answers. Approvals, questions, and errors always show.",
      )}
      resetAction={
        settings.toolCallVisibility !== DEFAULT_UNIFIED_SETTINGS.toolCallVisibility ? (
          <SettingResetButton
            label={gt("tool calls in chat", { $context: "setting name in a reset button label" })}
            onClick={() =>
              updateSettings({ toolCallVisibility: DEFAULT_UNIFIED_SETTINGS.toolCallVisibility })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.toolCallVisibility}
          onValueChange={(value) => {
            if (isToolCallVisibility(value)) updateSettings({ toolCallVisibility: value });
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-40" aria-label={gt("Tool calls in chat")}>
            <SelectValue>{TOOL_CALL_VISIBILITY_LABELS[settings.toolCallVisibility]}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ToolCallVisibility.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {TOOL_CALL_VISIBILITY_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

const SCREEN_READER_ANNOUNCEMENTS_LABELS: Record<ScreenReaderAnnouncements, string> = {
  status: msg("Status only"),
  messages: msg("Status and messages"),
  everything: msg("Everything"),
};

const isScreenReaderAnnouncements = Schema.is(ScreenReaderAnnouncements);

function ScreenReaderAnnouncementsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-announcements")}
      description={gt(
        "What a screen reader hears from the open thread: a turn starting, needing you, and ending. Status and messages adds what the agent writes before its last message. Everything adds each step.",
      )}
      resetAction={
        settings.screenReaderAnnouncements !==
        DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements ? (
          <SettingResetButton
            label={gt("screen reader announcements", {
              $context: "setting name in a reset button label",
            })}
            onClick={() =>
              updateSettings({
                screenReaderAnnouncements: DEFAULT_UNIFIED_SETTINGS.screenReaderAnnouncements,
              })
            }
          />
        ) : null
      }
      control={
        <Select
          value={settings.screenReaderAnnouncements}
          onValueChange={(value) => {
            if (isScreenReaderAnnouncements(value)) {
              updateSettings({ screenReaderAnnouncements: value });
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-full sm:w-48"
            aria-label={gt("Screen reader announcements")}
          >
            <SelectValue>
              {SCREEN_READER_ANNOUNCEMENTS_LABELS[settings.screenReaderAnnouncements]}
            </SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            {ScreenReaderAnnouncements.literals.map((value) => (
              <SelectItem key={value} value={value}>
                {SCREEN_READER_ANNOUNCEMENTS_LABELS[value]}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function ScreenReaderWindowTitleRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  return (
    <SettingsRow
      {...searchableSetting("screen-reader-window-title")}
      description={gt(
        "Start the window title with the thread's status, like Needs approval, and its name, so screen readers read them first when you switch apps. Taskbars, shared screens, and time trackers see it too.",
      )}
      resetAction={
        settings.screenReaderWindowTitle !== DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle ? (
          <SettingResetButton
            label={gt("screen reader window title", {
              $context: "setting name in a reset button label",
            })}
            onClick={() =>
              updateSettings({
                screenReaderWindowTitle: DEFAULT_UNIFIED_SETTINGS.screenReaderWindowTitle,
              })
            }
          />
        ) : null
      }
      control={
        <Switch
          checked={settings.screenReaderWindowTitle}
          onCheckedChange={(checked) => updateSettings({ screenReaderWindowTitle: checked })}
          aria-label={gt("Screen reader window title")}
        />
      }
    />
  );
}

function DiffColorsSettingsRow() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsRow
      {...searchableSetting("diff-color-scheme")}
      resetAction={
        settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme ? (
          <SettingResetButton
            label={gt("diff colors", { $context: "setting name in a reset button label" })}
            onClick={() =>
              updateSettings({ diffColorScheme: DEFAULT_UNIFIED_SETTINGS.diffColorScheme })
            }
          />
        ) : null
      }
      control={
        <div className="w-full sm:w-40">
          <Select
            value={settings.diffColorScheme}
            onValueChange={(value) => {
              if (value === "red-green" || value === "blue-orange")
                updateSettings({ diffColorScheme: value });
            }}
          >
            <SelectTrigger size="sm" className="w-full min-w-0" aria-label={gt("Diff colors")}>
              <span
                aria-hidden="true"
                className={
                  settings.diffColorScheme === "blue-orange"
                    ? "flex shrink-0 flex-row-reverse gap-1"
                    : "flex shrink-0 gap-1"
                }
              >
                <span className="size-2 rounded-full bg-diff-deletion" />
                <span className="size-2 rounded-full bg-diff-addition" />
              </span>
              <SelectValue>
                {settings.diffColorScheme === "blue-orange"
                  ? gt("Blue & orange")
                  : gt("Red & green")}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem value="red-green">
                <T>Red & green (default)</T>
              </SelectItem>
              <SelectItem value="blue-orange">
                <T>Blue & orange</T>
              </SelectItem>
            </SelectPopup>
          </Select>
        </div>
      }
    />
  );
}

export function DiffsSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection id="diffs" title={gt("Diffs")}>
        <SettingsRow
          {...searchableSetting("hide-whitespace-changes")}
          resetAction={
            settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
              <SettingResetButton
                label={gt("diff whitespace changes", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    diffIgnoreWhitespace: DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffIgnoreWhitespace}
              onCheckedChange={(checked) =>
                updateSettings({ diffIgnoreWhitespace: Boolean(checked) })
              }
              aria-label={gt("Hide whitespace changes by default")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("default-diff-file-state")}
          resetAction={
            settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
              <SettingResetButton
                label={gt("collapse diff files", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    diffFilesCollapsed: DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffFilesCollapsed}
              onCheckedChange={(checked) =>
                updateSettings({ diffFilesCollapsed: Boolean(checked) })
              }
              aria-label={gt("Collapse diff files")}
            />
          }
        />
        <DiffColorsSettingsRow />
      </SettingsSection>

      <SettingsSection id="pull-requests" title={gt("Pull requests")}>
        <SettingsRow
          {...searchableSetting("proactive-panels")}
          description={gt(
            "Open the linked pull request, or Changes once edits reach 3 files or 50 lines.",
          )}
          resetAction={
            settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
              <SettingResetButton
                label={gt("proactive panels", { $context: "setting name in a reset button label" })}
                onClick={() =>
                  updateSettings({
                    proactivePanelsEnabled: DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.proactivePanelsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ proactivePanelsEnabled: Boolean(checked) })
              }
              aria-label={gt("Open pull requests and changes panels proactively")}
            />
          }
        />
        <PullRequestLinksOpenInAppSetting />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function ThreadsSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target, scope } = useSettingsScope();
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const textGenerationProviders = serverProviders.filter(
    (provider) => provider.supportsTextGeneration !== false,
  );
  const textGenerationModelSelection = resolveAppModelSelectionState(
    settings,
    textGenerationProviders,
  );
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const textGenerationModelInstanceEntries = providerInstanceEntriesFor(
    textGenerationProviders,
    settings,
    target?.projectId ?? null,
  );
  const hasTextGenerationProvider = textGenerationModelInstanceEntries.some(
    (entry) => entry.enabled && entry.isAvailable,
  );
  const textGenInstanceEntry = textGenerationModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const textGenerationModelOptionsByInstance = getTextGenerationModelOptionsByInstance(
    settings,
    textGenerationProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isTextGenerationModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const textGenerationModelDisabledReason = useScopedModelDisabledReason(
    settings,
    textGenerationModelInstanceEntries,
    { textGeneration: true },
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      <SettingsSection id="new-projects" title={gt("New projects")}>
        <SettingsRow
          serverScoped
          settingKeys={["addProjectBaseDirectory"]}
          {...searchableSetting("add-project-starts-in")}
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label={gt("add project base directory", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <DraftInput
              size="sm"
              className="w-full sm:w-72"
              value={mixedAddProjectBaseDirectory ? "" : settings.addProjectBaseDirectory}
              onCommit={(next) => updateSettings({ addProjectBaseDirectory: next })}
              normalizeDraft={resolvePastedPath}
              placeholder={mixedAddProjectBaseDirectory ? gt("Mixed") : "~/"}
              spellCheck={false}
              aria-label={gt("Add project base directory")}
            />
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["ghqCloneLayout"]}
          {...searchableSetting("ghq-clone-layout")}
          description={gt("Clones go to github.com/owner/repo under the folder above, like ghq.")}
          resetAction={
            settings.ghqCloneLayout !== DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout ? (
              <SettingResetButton
                label={gt("clone into host folders", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({ ghqCloneLayout: DEFAULT_UNIFIED_SETTINGS.ghqCloneLayout })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["ghqCloneLayout"]}
              checked={settings.ghqCloneLayout}
              onCheckedChange={(checked) => updateSettings({ ghqCloneLayout: Boolean(checked) })}
              aria-label={gt("Clone into host folders")}
            />
          }
        />
      </SettingsSection>

      <ProjectDefaultsSettings category="general" />

      {!isProjectScope ? (
        <SettingsSection id="snooze" title={gt("Snooze")}>
          <SnoozePresetsRow />
        </SettingsSection>
      ) : null}

      <SettingsSection id="limited-threads" title={gt("Usage limits")}>
        <SettingsRow
          serverScoped
          {...searchableSetting("auto-resume-limited-threads")}
          description={gt("Continue limited threads when their usage resets.")}
          settingKeys={["autoResumeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["autoResumeLimitedThreads"]}
              checked={settings.autoResumeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Resume after usage limits")}
            />
          }
        />
        <SettingsRow
          serverScoped
          {...searchableSetting("snooze-limited-threads")}
          description={gt("Hide limited threads until their usage resets.")}
          settingKeys={["snoozeLimitedThreads"]}
          control={
            <ScopedSwitch
              settingKeys={["snoozeLimitedThreads"]}
              checked={settings.snoozeLimitedThreads}
              onCheckedChange={(checked) =>
                updateSettings({ snoozeLimitedThreads: Boolean(checked) })
              }
              aria-label={gt("Snooze until limits reset")}
            />
          }
        />
      </SettingsSection>

      {hasServerTargets ? (
        <SettingsSection id="auto-mark-done" title={gt("Auto-mark as Done")}>
          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoMarkDoneOnMerge"]}
            {...searchableSetting("auto-mark-done-merged-threads")}
            resetAction={
              settings.sidebarAutoMarkDoneOnMerge !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneOnMerge ? (
                <SettingResetButton
                  label={gt("automatically mark as Done on merge", {
                    $context: "setting name in a reset button label",
                  })}
                  onClick={() =>
                    updateSettings({
                      sidebarAutoMarkDoneOnMerge:
                        DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneOnMerge,
                    })
                  }
                />
              ) : null
            }
            control={
              <ScopedSwitch
                settingKeys={["sidebarAutoMarkDoneOnMerge"]}
                checked={settings.sidebarAutoMarkDoneOnMerge}
                onCheckedChange={(checked) =>
                  updateSettings({ sidebarAutoMarkDoneOnMerge: Boolean(checked) })
                }
                aria-label={gt("Automatically mark merged threads as Done")}
              />
            }
          />

          <SettingsRow
            serverScoped
            settingKeys={["sidebarAutoMarkDoneAfterDays"]}
            {...searchableSetting("auto-mark-done-inactive-threads")}
            description={gt("Mark threads with no recent activity as Done.")}
            resetAction={
              settings.sidebarAutoMarkDoneAfterDays !==
              DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays ? (
                <SettingResetButton
                  label={gt("automatically mark as Done", {
                    $context: "setting name in a reset button label",
                  })}
                  onClick={() =>
                    updateSettings({
                      sidebarAutoMarkDoneAfterDays:
                        DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays,
                    })
                  }
                />
              ) : null
            }
            control={
              <>
                {settings.sidebarAutoMarkDoneAfterDays !== null ? (
                  <DaysField
                    label={gt("Automatically mark inactive threads as Done")}
                    value={settings.sidebarAutoMarkDoneAfterDays}
                    onCommit={(days, options) =>
                      updateSettings({ sidebarAutoMarkDoneAfterDays: days }, options)
                    }
                  />
                ) : null}
                <ScopedSwitch
                  settingKeys={["sidebarAutoMarkDoneAfterDays"]}
                  checked={settings.sidebarAutoMarkDoneAfterDays !== null}
                  onCheckedChange={(checked) =>
                    updateSettings({
                      sidebarAutoMarkDoneAfterDays: checked ? AUTO_MARK_DONE_DEFAULT_DAYS : null,
                    })
                  }
                  aria-label={gt("Automatically mark inactive threads as Done")}
                />
              </>
            }
          />
          {settings.sidebarAutoMarkDoneAfterDays !== null ? (
            <SettingsRow
              serverScoped
              settingKeys={["sidebarAutoMarkDoneKeepPullRequests"]}
              title={gt("Keep threads with an open PR")}
              description={gt(
                "Inactivity does not mark threads with an open pull request as Done.",
              )}
              resetAction={
                settings.sidebarAutoMarkDoneKeepPullRequests !==
                DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneKeepPullRequests ? (
                  <SettingResetButton
                    label={gt("keep threads with an open PR", {
                      $context: "setting name in a reset button label",
                    })}
                    onClick={() =>
                      updateSettings({
                        sidebarAutoMarkDoneKeepPullRequests:
                          DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneKeepPullRequests,
                      })
                    }
                  />
                ) : null
              }
              control={
                <ScopedSwitch
                  settingKeys={["sidebarAutoMarkDoneKeepPullRequests"]}
                  checked={settings.sidebarAutoMarkDoneKeepPullRequests}
                  onCheckedChange={(checked) =>
                    updateSettings({ sidebarAutoMarkDoneKeepPullRequests: Boolean(checked) })
                  }
                  aria-label={gt("Keep threads with an open PR")}
                />
              }
            />
          ) : null}
        </SettingsSection>
      ) : null}

      <SettingsSection id="text-generation" title={gt("Text generation")}>
        <SettingsRow
          serverScoped
          settingKeys={["textGenerationModelSelection"]}
          {...searchableSetting("text-generation-model")}
          description={gt("Writes thread titles and other generated text.")}
          resetAction={
            hasServerTargets && isTextGenerationModelDirty ? (
              <SettingResetButton
                label={gt("text generation model", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            !hasServerTargets ? (
              <span className="text-sm text-muted-foreground">
                <T>Connect an environment to choose its text generation model.</T>
              </span>
            ) : !hasTextGenerationProvider ? (
              <span className="text-sm text-muted-foreground">
                <T>No text generation providers available.</T>
              </span>
            ) : (
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <ProviderModelPicker
                  environmentId={environmentId}
                  activeInstanceId={textGenInstanceId}
                  model={textGenModel}
                  lockedProvider={null}
                  instanceEntries={textGenerationModelInstanceEntries}
                  modelOptionsByInstance={textGenerationModelOptionsByInstance}
                  triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                  {...(mixedTextGenerationModel ? { triggerLabel: gt("Mixed") } : {})}
                  getModelDisabledReason={textGenerationModelDisabledReason}
                  {...(environmentId
                    ? {
                        onOpenProviderSetup: (instanceId: ProviderInstanceId) => {
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId, instanceId },
                          });
                        },
                      }
                    : {})}
                  onInstanceModelChange={(instanceId, model) => {
                    const reason = textGenerationModelDisabledReason(instanceId, model);
                    if (reason) {
                      toastManager.add({
                        type: "error",
                        title: gt("Text generation model not saved"),
                        description: reason,
                      });
                      return;
                    }
                    updateSettings({
                      textGenerationModelSelection: resolveAppModelSelectionState(
                        {
                          ...settings,
                          textGenerationModelSelection: pickModelSelection(
                            textGenerationModelSelection,
                            instanceId,
                            model,
                          ),
                        },
                        textGenerationProviders,
                      ),
                    });
                  }}
                />
                {textGenInstanceEntry ? (
                  <TraitsPicker
                    provider={textGenProvider}
                    models={textGenInstanceEntry?.models ?? []}
                    model={textGenModel}
                    modelOptions={textGenModelOptions}
                    allowPromptInjectedEffort={false}
                    triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                    onModelOptionsChange={(nextOptions) => {
                      updateSettings({
                        textGenerationModelSelection: resolveAppModelSelectionState(
                          {
                            ...settings,
                            textGenerationModelSelection: createModelSelection(
                              textGenInstanceId,
                              textGenModel,
                              nextOptions,
                            ),
                          },
                          textGenerationProviders,
                        ),
                      });
                    }}
                  />
                ) : null}
              </div>
            )
          }
        />
        <SettingsRow
          serverScoped
          settingKeys={["nextPromptSuggestionsEnabled"]}
          {...searchableSetting("next-prompt-suggestions")}
          description={gt(
            "After Claude or Codex replies, suggests what you might send next. Press Tab to use it. Threads on other providers get no suggestions.",
          )}
          resetAction={
            settings.nextPromptSuggestionsEnabled !==
            DEFAULT_UNIFIED_SETTINGS.nextPromptSuggestionsEnabled ? (
              <SettingResetButton
                label={gt("Next prompt suggestions", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    nextPromptSuggestionsEnabled:
                      DEFAULT_UNIFIED_SETTINGS.nextPromptSuggestionsEnabled,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["nextPromptSuggestionsEnabled"]}
              checked={settings.nextPromptSuggestionsEnabled}
              onCheckedChange={(checked) =>
                updateSettings({ nextPromptSuggestionsEnabled: Boolean(checked) })
              }
              aria-label={gt("Next prompt suggestions")}
            />
          }
        />
        <ThreadTitleInstructionsSettings />
        <SettingsRow
          serverScoped
          settingKeys={["responseStreamingMode"]}
          {...searchableSetting("response-streaming")}
          resetAction={
            settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
              <SettingResetButton
                label={gt("response streaming", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={mixedResponseStreamingMode ? null : settings.responseStreamingMode}
              onValueChange={(value) => {
                if (value === "turn" || value === "paragraph") {
                  updateSettings({ responseStreamingMode: value });
                }
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-56"
                aria-label={gt("Response streaming")}
              >
                <SelectValue>
                  {(value: ResponseStreamingMode | null) =>
                    value === null ? "Mixed" : RESPONSE_STREAMING_MODE_LABELS[value]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="turn">
                  {RESPONSE_STREAMING_MODE_LABELS.turn}
                </SelectItem>
                <SelectItem hideIndicator value="paragraph">
                  {RESPONSE_STREAMING_MODE_LABELS.paragraph}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <OrchestrationSkillsSettings />
    </SettingsPageContainer>
  );
}

export function MaintenanceSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const { environment, connectedEnvironments } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const pruneBackupFailures = useAtomValue(
    serverEnvironment.databasePruneBackupFailures(
      JSON.stringify(connectedEnvironments.map((target) => target.environmentId)),
    ),
  ).map(({ environmentId: failedId, failure }) => {
    const label =
      connectedEnvironments.find((target) => target.environmentId === failedId)?.label ?? failedId;
    return {
      environmentId: failedId,
      text:
        failure._tag === "InsufficientSpace"
          ? gt(
              "Nothing deleted on {environment}: the one-time backup needs {needed} of free disk space, and {free} is free.",
              {
                environment: label,
                needed: formatBytes(failure.neededBytes),
                free: formatBytes(failure.freeBytes),
              },
            )
          : gt(
              "Nothing deleted on {environment}: the one-time backup failed. The server log has the details.",
              { environment: label },
            ),
    };
  });

  return (
    <SettingsPageContainer>
      <SettingsSection id="updates" title={gt("Updates")}>
        <SettingsRow
          serverScoped
          settingKeys={["enableProviderUpdateChecks"]}
          {...searchableSetting("provider-update-checks")}
          resetAction={
            settings.enableProviderUpdateChecks !==
            DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
              <SettingResetButton
                label={gt("provider update checks", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["enableProviderUpdateChecks"]}
              checked={settings.enableProviderUpdateChecks}
              onCheckedChange={(checked) =>
                updateSettings({ enableProviderUpdateChecks: Boolean(checked) })
              }
              aria-label={gt("Check provider versions")}
            />
          }
        />
        <SettingsRow
          {...searchableSetting("continue-threads-after-server-update")}
          serverScoped
          settingKeys={["continueThreadsAfterServerUpdate"]}
          description={gt("Resume interrupted threads after an update, crash, or restart.")}
          status={
            !hasServerTargets
              ? gt("All selected connected environments must support restart continuation.")
              : undefined
          }
          resetAction={
            hasServerTargets &&
            settings.continueThreadsAfterServerUpdate !==
              DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
              <SettingResetButton
                label={gt("continue threads after restarts", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    continueThreadsAfterServerUpdate:
                      DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["continueThreadsAfterServerUpdate"]}
              checked={settings.continueThreadsAfterServerUpdate}
              disabled={!hasServerTargets}
              onCheckedChange={(checked) =>
                updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
              }
              aria-label={gt("Continue threads after restarts")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection id="background" title={gt("Background activity")}>
        <BackgroundActivitySettingsRow />
        <SettingsRow
          serverScoped
          settingKeys={["keepAwakeWhileAgentsWork"]}
          {...searchableSetting("keep-awake-while-agents-work")}
          description={gt(
            "Stop the computer from going to sleep while agents are working, and let it sleep once they finish. Closing a laptop lid still puts it to sleep.",
          )}
          resetAction={
            settings.keepAwakeWhileAgentsWork !==
            DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork ? (
              <SettingResetButton
                label={gt("keep awake while agents work", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({
                    keepAwakeWhileAgentsWork: DEFAULT_UNIFIED_SETTINGS.keepAwakeWhileAgentsWork,
                  })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["keepAwakeWhileAgentsWork"]}
              checked={settings.keepAwakeWhileAgentsWork}
              onCheckedChange={(checked) =>
                updateSettings({ keepAwakeWhileAgentsWork: Boolean(checked) })
              }
              aria-label={gt("Keep awake while agents work")}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        id="history"
        title={gt("History", { $context: "settings section, stored event history" })}
      >
        <SettingsRow
          serverScoped
          settingKeys={["pruneEventHistory"]}
          {...searchableSetting("prune-event-history")}
          description={gt(
            "Keeps every conversation. Backs up the database once, then removes internal history older than a day so the database stops growing. Older Supaterm versions can't use the database afterwards.",
          )}
          status={
            pruneBackupFailures.length === 0 ? null : (
              <span className="block text-destructive">
                {pruneBackupFailures.map((failure) => (
                  <span key={failure.environmentId} className="block">
                    {failure.text}
                  </span>
                ))}
              </span>
            )
          }
          resetAction={
            settings.pruneEventHistory !== DEFAULT_UNIFIED_SETTINGS.pruneEventHistory ? (
              <SettingResetButton
                label={gt("delete history older than a day", {
                  $context: "setting name in a reset button label",
                })}
                onClick={() =>
                  updateSettings({ pruneEventHistory: DEFAULT_UNIFIED_SETTINGS.pruneEventHistory })
                }
              />
            ) : null
          }
          control={
            <ScopedSwitch
              settingKeys={["pruneEventHistory"]}
              checked={settings.pruneEventHistory}
              onCheckedChange={(checked) => updateSettings({ pruneEventHistory: Boolean(checked) })}
              aria-label={gt("Delete history older than a day")}
            />
          }
        />
      </SettingsSection>

      <StorageCleanupSections />

      <SettingsSection id="diagnostics-section" title={gt("Diagnostics")}>
        <SettingsRow
          {...searchableSetting("diagnostics")}
          description={gt("Inspect processes, resource use, and logs.")}
          control={
            <Button
              render={
                <Link to="/settings/diagnostics" search={{ machine: environmentId ?? undefined }} />
              }
              size="sm"
              variant="outline"
            >
              <T>View diagnostics</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AboutSettingsPanel() {
  const searchableSetting = useSearchableSetting();
  const gt = useGT();
  // The Welcome page sets up this computer, so it needs one.
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  return (
    <SettingsPageContainer>
      <SettingsSection id="about" title={gt("App")}>
        {isElectron || HOSTED_APP_CHANNEL ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow id={searchableSetting("app-version").id} title={<AboutVersionTitle />} />
        )}
        <MobileAppSettingsRow />
        {primaryEnvironmentId === null ? null : (
          <SettingsRow
            {...searchableSetting("welcome-page")}
            description={gt("See your agents and import projects.")}
            control={
              <Button size="sm" variant="outline" render={<Link to="/welcome" />}>
                <T context="verb, opens a page">Open</T>
              </Button>
            }
          />
        )}
      </SettingsSection>

      <SettingsSection id="legal" title={gt("Legal")}>
        <SettingsRow
          {...searchableSetting("privacy-policy")}
          control={
            <Button
              render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
              size="sm"
              variant="outline"
            >
              <T>View policy</T>
            </Button>
          }
        />
        <SettingsRow
          {...searchableSetting("open-source-licenses")}
          control={
            <Button
              render={<Link to="/settings/open-source-licenses" />}
              size="sm"
              variant="outline"
            >
              <T>View licenses</T>
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
