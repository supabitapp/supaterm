import { UpdateTrackSwitchDialog } from "./UpdateTrackSwitchDialog";
import { StorageSettingsPanel } from "./StorageSettings";
import { ThreadTitleInstructionsSettings } from "./ThreadTitleInstructionsSettings";
import { SnoozePresetsRow } from "./SnoozePresetsSettings";
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
  MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
  MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS,
  type ResponseStreamingMode,
  type QuitConfirmationMode,
  SidebarProjectSortOrder,
} from "@supaterm/contracts/settings";
import { createModelSelection } from "@supaterm/shared/model";
import * as Equal from "effect/Equal";
import * as Schema from "effect/Schema";
import { APP_VERSION, HOSTED_APP_CHANNEL, HOSTED_APP_CHANNEL_LABEL } from "../../branding";
import { desktopUpdateChannelOf } from "@supaterm/shared/cliRelease";
import { canUpdateServer } from "../ServerUpdateAction";
import { environmentIdsKey } from "../../state/environmentAtomList";
import { environmentSessionStatesAtom } from "../../state/session";
import { awaitsTrackSwitch, channelSwitchLabel } from "../sidebar/updateEverything.logic";
import { useUpdateEverythingRun } from "../sidebar/updateEverythingRun";
import { isHostedByThisApp } from "../sidebar/useUpdateEverything";
import { useAtomValue } from "@effect/atom-react";
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
import { useDesktopUpdateState } from "../../state/desktopUpdate";
import { desktopUpdateRestart } from "../../state/desktopUpdateRestart";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../modelSelection";
import { providerInstanceEntriesFor } from "../../providerInstances";
import { ensureLocalApi, readLocalApi } from "../../localApi";
import { isMacPlatform } from "../../lib/utils";
import { useEnvironmentProviders, useEnvironments } from "../../state/environments";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
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
import { searchableSetting } from "./settingsSearch";
import { BackgroundActivitySettingsRow } from "./BackgroundActivitySettings";

const RESPONSE_STREAMING_MODE_LABELS: Record<ResponseStreamingMode, string> = {
  turn: "Wait for the full response",
  paragraph: "Show finished paragraphs",
};

const SIDEBAR_PROJECT_SORT_ORDER_LABELS: Record<SidebarProjectSortOrder, string> = {
  updated_at: "Last user message",
  created_at: "Created at",
  manual: "Manual",
};
const isSidebarProjectSortOrder = Schema.is(SidebarProjectSortOrder);

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

const QUIT_CONFIRMATION_MODE_LABELS: Record<QuitConfirmationMode, string> = {
  direct: "Direct",
  hold: "Hold",
  "double-click": "Double press",
};

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");
function AboutVersionTitle() {
  return (
    <span className="inline-flex items-baseline gap-2">
      <span>Version</span>
      <code className="text-2xs font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const updateState = useDesktopUpdateState();
  const [switchingChannel, setSwitchingChannel] = useState<DesktopUpdateChannel | null>(null);
  const isChangingUpdateChannel = switchingChannel !== null;
  const [isUpdateActionPending, setIsUpdateActionPending] = useState(false);
  const { environments } = useEnvironments();
  const sessionStates = useAtomValue(
    environmentSessionStatesAtom(
      environmentIdsKey(environments.map(({ environmentId }) => environmentId)),
    ),
  );
  const updateRun = useUpdateEverythingRun();

  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";
  const selectedHostedAppChannel = hasDesktopBridge ? null : HOSTED_APP_CHANNEL;
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

  const handleUpdateChannelChange = (channel: DesktopUpdateChannel) => {
    const bridge = window.desktopBridge;
    if (
      !bridge ||
      typeof bridge.setUpdateChannel !== "function" ||
      channel === selectedUpdateChannel ||
      updateRun !== null
    ) {
      return;
    }

    setSwitchingChannel(channel);
  };

  const handleButtonClick = async () => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge.downloadUpdate().catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          }),
        );
      });
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
          ),
        );
      } catch (error) {
        setIsUpdateActionPending(false);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not confirm update",
            description: error instanceof Error ? error.message : "Update confirmation failed.",
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
              title: "Could not install update",
              description: error instanceof Error ? error.message : "Install failed.",
            }),
          );
        })
        .finally(() => setIsUpdateActionPending(false));
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        if (!result.checked) {
          toastManager.add(
            stackedThreadToast({
              type: "error",
              title: "Could not check for updates",
              description:
                result.state.message ?? "Automatic updates are not available in this build.",
            }),
          );
        }
      })
      .catch((error: unknown) => {
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not check for updates",
            description: error instanceof Error ? error.message : "Update check failed.",
          }),
        );
      });
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : (getDesktopUpdateDisabledReason(updateState) ?? null);

  return (
    <>
      {switchingChannel !== null ? (
        <UpdateTrackSwitchDialog
          channel={switchingChannel}
          onClose={() => setSwitchingChannel(null)}
        />
      ) : null}
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
                {unswitchedMachines === 1
                  ? "1 machine still runs"
                  : `${unswitchedMachines} machines still run`}{" "}
                {channelSwitchLabel(selectedUpdateChannel === "nightly" ? "latest" : "nightly")}.{" "}
                <Button
                  size="xs"
                  variant="link"
                  disabled={isChangingUpdateChannel || updateRun !== null}
                  onClick={() => setSwitchingChannel(selectedUpdateChannel)}
                >
                  Review
                </Button>
              </>
            ) : null
          }
          control={
            <Select
              value={selectedUpdateChannel}
              onValueChange={(value) => {
                handleUpdateChannelChange(value as DesktopUpdateChannel);
              }}
            >
              <SelectTrigger
                size="sm"
                className="w-full sm:w-40"
                aria-label="Update track"
                disabled={isChangingUpdateChannel || updateRun !== null}
              >
                <SelectValue>
                  {selectedUpdateChannel === "nightly" ? "Nightly" : "Stable"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Stable
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
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
              <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Update track">
                <SelectValue>{HOSTED_APP_CHANNEL_LABEL}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="latest">
                  Latest
                </SelectItem>
                <SelectItem hideIndicator value="nightly">
                  Nightly
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      ) : null}
      {hasDesktopBridge ? <CliCommandSettingsRow /> : null}
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
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
    ...(theme !== "system" ? ["Theme"] : []),
    ...(!followSystem ? ["Follow system"] : []),
    ...(themeHalves !== null ? ["Theme mix"] : []),
    ...(settings.appearanceContrast !== DEFAULT_UNIFIED_SETTINGS.appearanceContrast
      ? ["Contrast"]
      : []),
    ...(settings.glassOpacity !== DEFAULT_UNIFIED_SETTINGS.glassOpacity ? ["Glass opacity"] : []),
    ...(settings.diffColorScheme !== DEFAULT_UNIFIED_SETTINGS.diffColorScheme
      ? ["Diff colors"]
      : []),
    ...(settings.chatWidth !== DEFAULT_UNIFIED_SETTINGS.chatWidth ? ["Chat width"] : []),
    ...(settings.effortDisplay !== DEFAULT_UNIFIED_SETTINGS.effortDisplay
      ? ["Effort display"]
      : []),
    ...(settings.mathRenderingEnabled !== DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled
      ? ["Render math"]
      : []),
    ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
      ? ["Time format"]
      : []),
    ...(settings.notificationMode !== DEFAULT_UNIFIED_SETTINGS.notificationMode
      ? ["Thread notifications"]
      : []),
    ...(settings.inAppNotificationsEnabled !== DEFAULT_UNIFIED_SETTINGS.inAppNotificationsEnabled
      ? ["In-app notifications"]
      : []),
    ...(settings.sidebarThreadGrouping !== DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping
      ? ["Thread grouping"]
      : []),
    ...(settings.sidebarProjectGroupingMode !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode
      ? ["Project Grouping"]
      : []),
    ...(settings.sidebarProjectSortOrder !== DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder
      ? ["Project order"]
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
      ? ["Auto-resume limited threads"]
      : []),
    ...(settings.snoozeLimitedThreads !== DEFAULT_UNIFIED_SETTINGS.snoozeLimitedThreads
      ? ["Snooze limited threads"]
      : []),
    ...(settings.wordWrap !== DEFAULT_UNIFIED_SETTINGS.wordWrap ? ["Word wrap"] : []),
    ...(settings.persistComposerContextStrip !==
    DEFAULT_UNIFIED_SETTINGS.persistComposerContextStrip
      ? ["Usage limits"]
      : []),
    ...getChangedTypographySettingLabels(settings),
    ...(settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed
      ? ["Collapse diff files"]
      : []),
    ...(settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace
      ? ["Diff whitespace changes"]
      : []),
    ...(settings.diffLayout !== DEFAULT_UNIFIED_SETTINGS.diffLayout ? ["Diff layout"] : []),
    ...(settings.proactivePanelsEnabled !== DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled
      ? ["Proactive panels"]
      : []),
    ...(settings.showSkillsInSlashMenu !== DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu
      ? ["Show skills in slash menu"]
      : []),
    ...(settings.composerRichTextEnabled !== DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled
      ? ["Rich text composer"]
      : []),
    ...(settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? ["Send shortcut"] : []),
    ...(settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior
      ? ["Follow-up behavior"]
      : []),
    ...(settings.responseStreamingMode !== DEFAULT_UNIFIED_SETTINGS.responseStreamingMode
      ? ["Response streaming"]
      : []),
    ...(settings.enableProviderUpdateChecks !== DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks
      ? ["Provider update checks"]
      : []),
    ...(settings.continueThreadsAfterServerUpdate !==
    DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate
      ? ["Continue threads after restarts"]
      : []),
    ...(isBackgroundActivityDirty ? ["Background activity"] : []),
    ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
      ? ["New thread mode"]
      : []),
    ...(settings.newWorktreesStartFromOrigin !==
    DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin
      ? ["New worktrees start from remote"]
      : []),
    ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
      ? ["Add project base directory"]
      : []),
    ...(settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin
      ? ["Unpin confirmation"]
      : []),
    ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
      ? ["Archive confirmation"]
      : []),
    ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
      ? ["Delete confirmation"]
      : []),
    ...(settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? ["Quit shortcut"] : []),
    ...(isTextGenerationModelDirty ? ["Text generation model"] : []),
    ...getChangedBrowserSettingLabels(settings),
    ...(settings.enableAgentBrowserAccess !== DEFAULT_UNIFIED_SETTINGS.enableAgentBrowserAccess
      ? ["Agent browser access"]
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
          title: "Couldn’t restore theme settings",
          description: "Try again.",
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
      effortDisplay: DEFAULT_UNIFIED_SETTINGS.effortDisplay,
      mathRenderingEnabled: DEFAULT_UNIFIED_SETTINGS.mathRenderingEnabled,
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
      followUpBehavior: DEFAULT_UNIFIED_SETTINGS.followUpBehavior,
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
      responseStreamingMode: DEFAULT_UNIFIED_SETTINGS.responseStreamingMode,
      enableProviderUpdateChecks: DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
      continueThreadsAfterServerUpdate: DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate,
      backgroundActivity: DEFAULT_UNIFIED_SETTINGS.backgroundActivity,
      defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
      newWorktreesStartFromOrigin: DEFAULT_UNIFIED_SETTINGS.newWorktreesStartFromOrigin,
      addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
      confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
      confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
      confirmThreadUnpin: DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin,
      confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit,
      textGenerationModelSelection: DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
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
      browserAutoShowFloatingPreview: DEFAULT_UNIFIED_SETTINGS.browserAutoShowFloatingPreview,
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

const AUTO_MARK_DONE_DEFAULT_DAYS = DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays ?? 3;

type SettingsConcern = "general" | "chat" | "diffs" | "threads" | "maintenance" | "about";

function ConcernSettingsPanel({ concern }: { concern: SettingsConcern }) {
  const modifierLabel = isMacPlatform(navigator.platform) ? "⌘" : "Ctrl";
  const followUpOverrideShortcut = {
    enter: `${modifierLabel} + Enter`,
    "mod-enter": `${modifierLabel} + Shift + Enter`,
    "mod-enter-multiline": `${modifierLabel} + Enter, or ${modifierLabel} + Shift + Enter in multiline prompts,`,
  } as const;
  const sendShortcutOptions = [
    { value: "enter", label: "Enter" },
    { value: "mod-enter-multiline", label: `${modifierLabel} + Enter for multiline prompts` },
    { value: "mod-enter", label: `${modifierLabel} + Enter always` },
  ] as const;
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { environment, connectedEnvironments, target } = useSettingsScope();
  const environmentId = environment?.environmentId ?? null;
  const hasServerTargets = connectedEnvironments.length > 0;
  const mixedResponseStreamingMode = useScopedSettingsMixed(["responseStreamingMode"]);
  const lastEnabledProjectGroupingMode = useRef<SidebarProjectGroupingMode>(
    readLastEnabledProjectGroupingMode(),
  );
  const providersByEnvironment = useEnvironmentProviders();
  const serverProviders =
    (environment?.serverConfig
      ? providersByEnvironment.get(environment.environmentId)
      : undefined) ?? EMPTY_SERVER_PROVIDERS;
  const supportsAutoMarkDone =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every((target) => target.serverConfig != null);
  const supportsRestartContinuation =
    connectedEnvironments.length > 0 &&
    connectedEnvironments.every((target) => target.serverConfig != null);

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
  const textGenerationModelOptionsByInstance = getCustomModelOptionsByInstance(
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
  );
  const mixedAddProjectBaseDirectory = useScopedSettingsMixed(["addProjectBaseDirectory"]);
  const mixedTextGenerationModel = useScopedSettingsMixed(["textGenerationModelSelection"]);

  return (
    <SettingsPageContainer>
      {concern === "general" ? (
        <>
          <SettingsSection id="notifications" title="Notifications">
            <NotificationSettings />
            <SettingsRow
              {...searchableSetting("in-app-notifications")}
              description="Show toasts for other threads while Supaterm is focused."
              control={
                <Switch
                  checked={settings.inAppNotificationsEnabled}
                  onCheckedChange={(checked) =>
                    updateSettings({ inAppNotificationsEnabled: checked })
                  }
                  aria-label="In-app notifications"
                />
              }
            />
          </SettingsSection>
          <SettingsSection id="sidebar" title="Sidebar">
            <SettingsRow
              {...searchableSetting("thread-grouping")}
              resetAction={
                settings.sidebarThreadGrouping !==
                DEFAULT_UNIFIED_SETTINGS.sidebarThreadGrouping ? (
                  <SettingResetButton
                    label="thread grouping"
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
                  <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Thread grouping">
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
              description="Combine matching repositories across environments."
              resetAction={
                settings.sidebarProjectGroupingMode !==
                DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode ? (
                  <SettingResetButton
                    label="project grouping"
                    onClick={() =>
                      updateSettings({
                        sidebarProjectGroupingMode:
                          DEFAULT_UNIFIED_SETTINGS.sidebarProjectGroupingMode,
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
                  aria-label="Project grouping"
                />
              }
            />
            <SettingsRow
              {...searchableSetting("project-order")}
              resetAction={
                settings.sidebarProjectSortOrder !==
                DEFAULT_UNIFIED_SETTINGS.sidebarProjectSortOrder ? (
                  <SettingResetButton
                    label="project order"
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
                  <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Project order">
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
          <SettingsSection id="confirmations" title="Confirmations">
            <SettingsRow
              {...searchableSetting("unpin-confirmation")}
              resetAction={
                settings.confirmThreadUnpin !== DEFAULT_UNIFIED_SETTINGS.confirmThreadUnpin ? (
                  <SettingResetButton
                    label="unpin confirmation"
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
                  aria-label="Confirm thread unpinning"
                />
              }
            />

            <SettingsRow
              {...searchableSetting("archive-confirmation")}
              resetAction={
                settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
                  <SettingResetButton
                    label="archive confirmation"
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
                  aria-label="Confirm thread archiving"
                />
              }
            />

            <SettingsRow
              {...searchableSetting("delete-confirmation")}
              resetAction={
                settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
                  <SettingResetButton
                    label="delete confirmation"
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
                  aria-label="Confirm thread deletion"
                />
              }
            />

            {isElectron ? (
              <SettingsRow
                {...searchableSetting("quit-confirmation")}
                resetAction={
                  settings.confirmQuit !== DEFAULT_UNIFIED_SETTINGS.confirmQuit ? (
                    <SettingResetButton
                      label="quit shortcut behavior"
                      onClick={() =>
                        updateSettings({ confirmQuit: DEFAULT_UNIFIED_SETTINGS.confirmQuit })
                      }
                    />
                  ) : null
                }
                control={
                  <Select
                    value={settings.confirmQuit}
                    onValueChange={(value) => {
                      if (value === "direct" || value === "hold" || value === "double-click") {
                        updateSettings({ confirmQuit: value });
                      }
                    }}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full sm:w-40"
                      aria-label="Quit shortcut behavior"
                    >
                      <SelectValue>
                        {QUIT_CONFIRMATION_MODE_LABELS[settings.confirmQuit]}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {Object.entries(QUIT_CONFIRMATION_MODE_LABELS).map(([value, label]) => (
                        <SelectItem hideIndicator key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                }
              />
            ) : null}
          </SettingsSection>
          <SettingsSection id="display" title="Display">
            <SettingsRow
              {...searchableSetting("time-format")}
              resetAction={
                settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
                  <SettingResetButton
                    label="time format"
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
                  <SelectTrigger size="sm" className="w-full sm:w-40" aria-label="Timestamp format">
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
        </>
      ) : null}
      {concern === "chat" ? (
        <>
          <SettingsSection id="responses" title="Responses">
            {" "}
            <SettingsRow
              serverScoped
              settingKeys={["responseStreamingMode"]}
              {...searchableSetting("response-streaming")}
              resetAction={
                settings.responseStreamingMode !==
                DEFAULT_UNIFIED_SETTINGS.responseStreamingMode ? (
                  <SettingResetButton
                    label="response streaming"
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
                    aria-label="Response streaming"
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
          <SettingsSection id="composer" title="Composer">
            <SettingsRow
              {...searchableSetting("send-shortcut")}
              resetAction={
                settings.sendShortcut !== DEFAULT_UNIFIED_SETTINGS.sendShortcut ? (
                  <SettingResetButton
                    label="send shortcut"
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
                    aria-label="Send shortcut"
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
                          {settings.sendShortcut === option.value && (
                            <CheckIcon aria-hidden="true" />
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...searchableSetting("follow-up-behavior")}
              description={`While the agent runs. ${followUpOverrideShortcut[settings.sendShortcut]} does the opposite once.`}
              resetAction={
                settings.followUpBehavior !== DEFAULT_UNIFIED_SETTINGS.followUpBehavior ? (
                  <SettingResetButton
                    label="follow-up behavior"
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
                    aria-label="Follow-up behavior"
                  >
                    <SelectValue>
                      {settings.followUpBehavior === "queue" ? "Queue" : "Steer"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end" alignItemWithTrigger={false}>
                    <SelectItem value="queue">Queue</SelectItem>
                    <SelectItem value="steer">Steer</SelectItem>
                  </SelectPopup>
                </Select>
              }
            />
            <SettingsRow
              {...searchableSetting("composer-rich-text")}
              resetAction={
                settings.composerRichTextEnabled !==
                DEFAULT_UNIFIED_SETTINGS.composerRichTextEnabled ? (
                  <SettingResetButton
                    label="rich text composer"
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
                  aria-label="Rich text composer"
                />
              }
            />
            <SettingsRow
              {...searchableSetting("skills-in-slash-menu")}
              description="Skills always appear when you type $."
              resetAction={
                settings.showSkillsInSlashMenu !==
                DEFAULT_UNIFIED_SETTINGS.showSkillsInSlashMenu ? (
                  <SettingResetButton
                    label="skills in slash menu"
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
                  aria-label="Show skills in slash menu"
                />
              }
            />
          </SettingsSection>
          <SettingsSection id="suggestions" title="Suggestions">
            {" "}
            <SettingsRow
              serverScoped
              settingKeys={["nextPromptSuggestionsEnabled"]}
              {...searchableSetting("next-prompt-suggestions")}
              description="After the agent replies, suggests what you might send next. Press Tab to use it. Claude predicts its own; other providers use the text generation model."
              resetAction={
                settings.nextPromptSuggestionsEnabled !==
                DEFAULT_UNIFIED_SETTINGS.nextPromptSuggestionsEnabled ? (
                  <SettingResetButton
                    label="next prompt suggestions"
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
                  aria-label="Next prompt suggestions"
                />
              }
            />
          </SettingsSection>
        </>
      ) : null}
      {concern === "diffs" ? (
        <>
          <SettingsSection id="review" title="Diffs and pull requests">
            <SettingsRow
              {...searchableSetting("proactive-panels")}
              description="Open the linked pull request, or Changes once edits reach 3 files or 50 lines."
              resetAction={
                settings.proactivePanelsEnabled !==
                DEFAULT_UNIFIED_SETTINGS.proactivePanelsEnabled ? (
                  <SettingResetButton
                    label="proactive panels"
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
                  aria-label="Proactive panels"
                />
              }
            />
            <SettingsRow
              {...searchableSetting("default-diff-file-state")}
              resetAction={
                settings.diffFilesCollapsed !== DEFAULT_UNIFIED_SETTINGS.diffFilesCollapsed ? (
                  <SettingResetButton
                    label="collapse diff files"
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
                  aria-label="Collapse diff files"
                />
              }
            />
            <SettingsRow
              {...searchableSetting("hide-whitespace-changes")}
              resetAction={
                settings.diffIgnoreWhitespace !== DEFAULT_UNIFIED_SETTINGS.diffIgnoreWhitespace ? (
                  <SettingResetButton
                    label="diff whitespace changes"
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
                  aria-label="Hide whitespace changes by default"
                />
              }
            />
          </SettingsSection>
        </>
      ) : null}
      {concern === "threads" ? (
        <>
          <ProjectDefaultsSettings category="general" />
          <SettingsSection id="threads" title="Threads">
            {" "}
            <SettingsRow
              serverScoped
              {...searchableSetting("auto-resume-limited-threads")}
              description="Continue limited threads when their usage resets."
              settingKeys={["autoResumeLimitedThreads"]}
              control={
                <ScopedSwitch
                  settingKeys={["autoResumeLimitedThreads"]}
                  checked={settings.autoResumeLimitedThreads}
                  onCheckedChange={(checked) =>
                    updateSettings({ autoResumeLimitedThreads: Boolean(checked) })
                  }
                  aria-label="Auto-resume limited threads"
                />
              }
            />
            <SettingsRow
              serverScoped
              {...searchableSetting("snooze-limited-threads")}
              description="Hide limited threads until their usage resets."
              settingKeys={["snoozeLimitedThreads"]}
              control={
                <ScopedSwitch
                  settingKeys={["snoozeLimitedThreads"]}
                  checked={settings.snoozeLimitedThreads}
                  onCheckedChange={(checked) =>
                    updateSettings({ snoozeLimitedThreads: Boolean(checked) })
                  }
                  aria-label="Snooze limited threads"
                />
              }
            />
            {supportsAutoMarkDone ? (
              <>
                <SettingsRow
                  serverScoped
                  settingKeys={["sidebarAutoMarkDoneOnMerge"]}
                  {...searchableSetting("auto-mark-done-merged-threads")}
                  resetAction={
                    settings.sidebarAutoMarkDoneOnMerge !==
                    DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneOnMerge ? (
                      <SettingResetButton
                        label="automatically mark as Done on merge"
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
                      aria-label="Automatically mark merged threads as Done"
                    />
                  }
                />

                <SettingsRow
                  serverScoped
                  settingKeys={["sidebarAutoMarkDoneAfterDays"]}
                  {...searchableSetting("auto-mark-done-inactive-threads")}
                  description="Mark threads with no recent activity as Done."
                  resetAction={
                    settings.sidebarAutoMarkDoneAfterDays !==
                    DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneAfterDays ? (
                      <SettingResetButton
                        label="automatically mark as Done"
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
                          label="Automatically mark inactive threads as Done"
                          min={MIN_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
                          max={MAX_SIDEBAR_AUTO_MARK_DONE_AFTER_DAYS}
                          value={settings.sidebarAutoMarkDoneAfterDays}
                          onCommit={(days) =>
                            updateSettings({ sidebarAutoMarkDoneAfterDays: days })
                          }
                        />
                      ) : null}
                      <ScopedSwitch
                        settingKeys={["sidebarAutoMarkDoneAfterDays"]}
                        checked={settings.sidebarAutoMarkDoneAfterDays !== null}
                        onCheckedChange={(checked) =>
                          updateSettings({
                            sidebarAutoMarkDoneAfterDays: checked
                              ? AUTO_MARK_DONE_DEFAULT_DAYS
                              : null,
                          })
                        }
                        aria-label="Automatically mark inactive threads as Done"
                      />
                    </>
                  }
                />
                {settings.sidebarAutoMarkDoneAfterDays !== null ? (
                  <SettingsRow
                    serverScoped
                    settingKeys={["sidebarAutoMarkDoneKeepPullRequests"]}
                    title="Keep threads with an open PR"
                    description="Inactivity does not mark threads with an open pull request as Done."
                    resetAction={
                      settings.sidebarAutoMarkDoneKeepPullRequests !==
                      DEFAULT_UNIFIED_SETTINGS.sidebarAutoMarkDoneKeepPullRequests ? (
                        <SettingResetButton
                          label="keep threads with an open PR"
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
                        aria-label="Keep threads with an open PR"
                      />
                    }
                  />
                ) : null}
              </>
            ) : null}
            <SettingsRow
              {...searchableSetting("continue-threads-after-server-update")}
              serverScoped
              settingKeys={["continueThreadsAfterServerUpdate"]}
              description="Resume interrupted threads after an update, crash, or restart."
              status={
                !supportsRestartContinuation
                  ? "All selected connected environments must support restart continuation."
                  : undefined
              }
              resetAction={
                supportsRestartContinuation &&
                settings.continueThreadsAfterServerUpdate !==
                  DEFAULT_UNIFIED_SETTINGS.continueThreadsAfterServerUpdate ? (
                  <SettingResetButton
                    label="continue threads after restarts"
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
                  disabled={!supportsRestartContinuation}
                  onCheckedChange={(checked) =>
                    updateSettings({ continueThreadsAfterServerUpdate: Boolean(checked) })
                  }
                  aria-label="Continue threads after restarts"
                />
              }
            />
          </SettingsSection>
          <SettingsSection id="new-projects" title="New projects">
            {" "}
            <SettingsRow
              serverScoped
              settingKeys={["addProjectBaseDirectory"]}
              {...searchableSetting("add-project-starts-in")}
              resetAction={
                settings.addProjectBaseDirectory !==
                DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
                  <SettingResetButton
                    label="add project base directory"
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
                  placeholder={mixedAddProjectBaseDirectory ? "Mixed" : "~/"}
                  spellCheck={false}
                  aria-label="Add project base directory"
                />
              }
            />
          </SettingsSection>
          <SettingsSection id="text-generation" title="Text generation">
            {" "}
            <SettingsRow
              serverScoped
              settingKeys={["textGenerationModelSelection"]}
              {...searchableSetting("text-generation-model")}
              description="Writes thread titles and other generated text."
              resetAction={
                hasServerTargets && isTextGenerationModelDirty ? (
                  <SettingResetButton
                    label="text generation model"
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
                    Connect an environment to choose its text generation model.
                  </span>
                ) : !hasTextGenerationProvider ? (
                  <span className="text-sm text-muted-foreground">
                    No text generation providers available.
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
                      {...(mixedTextGenerationModel ? { triggerLabel: "Mixed" } : {})}
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
                            title: "Text generation model not saved",
                            description: reason,
                          });
                          return;
                        }
                        updateSettings({
                          textGenerationModelSelection: resolveAppModelSelectionState(
                            {
                              ...settings,
                              textGenerationModelSelection: createModelSelection(instanceId, model),
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
            <ThreadTitleInstructionsSettings />
          </SettingsSection>
          <SettingsSection id="snooze" title="Snooze">
            <SnoozePresetsRow />
          </SettingsSection>
        </>
      ) : null}
      {concern === "maintenance" ? (
        <>
          <SettingsSection id="background" title="Updates and background activity">
            {" "}
            <SettingsRow
              serverScoped
              settingKeys={["enableProviderUpdateChecks"]}
              {...searchableSetting("provider-update-checks")}
              resetAction={
                settings.enableProviderUpdateChecks !==
                DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks ? (
                  <SettingResetButton
                    label="provider update checks"
                    onClick={() =>
                      updateSettings({
                        enableProviderUpdateChecks:
                          DEFAULT_UNIFIED_SETTINGS.enableProviderUpdateChecks,
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
                  aria-label="Check provider versions"
                />
              }
            />
            <BackgroundActivitySettingsRow />
          </SettingsSection>
        </>
      ) : null}
      {concern === "about" ? (
        <>
          <SettingsSection id="about" title="About">
            {isElectron || HOSTED_APP_CHANNEL ? (
              <AboutVersionSection />
            ) : (
              <SettingsRow id={searchableSetting("app-version").id} title={<AboutVersionTitle />} />
            )}
            <MobileAppSettingsRow />
            <SettingsRow
              {...searchableSetting("privacy-policy")}
              control={
                <Button
                  render={<a href={PRIVACY_POLICY_URL} target="_blank" rel="noreferrer noopener" />}
                  size="sm"
                  variant="outline"
                >
                  View policy
                </Button>
              }
            />
            <SettingsRow
              {...searchableSetting("diagnostics")}
              description="Inspect processes, resource use, and logs."
              control={
                <Button
                  render={
                    <Link
                      to="/settings/diagnostics"
                      search={{ machine: environmentId ?? undefined }}
                    />
                  }
                  size="sm"
                  variant="outline"
                >
                  View diagnostics
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
                  View licenses
                </Button>
              }
            />
          </SettingsSection>
        </>
      ) : null}
    </SettingsPageContainer>
  );
}

export function GeneralSettingsPanel() {
  return <ConcernSettingsPanel concern="general" />;
}

export function ChatSettingsPanel() {
  return <ConcernSettingsPanel concern="chat" />;
}

export function DiffsSettingsPanel() {
  return <ConcernSettingsPanel concern="diffs" />;
}

export function ThreadsSettingsPanel() {
  return <ConcernSettingsPanel concern="threads" />;
}

export function MaintenanceSettingsPanel() {
  return (
    <>
      <ConcernSettingsPanel concern="maintenance" />
      <StorageSettingsPanel area="maintenance" />
    </>
  );
}

export function AboutSettingsPanel() {
  return <ConcernSettingsPanel concern="about" />;
}
