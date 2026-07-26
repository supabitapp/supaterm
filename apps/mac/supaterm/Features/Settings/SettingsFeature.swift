import ComposableArchitecture
import Foundation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermUpdateFeature

private enum SettingsFeatureCancelID {
  static let updateObservation = "SettingsFeature.updateObservation"
}

struct SettingsTerminalState: Equatable {
  var availableFontFamilies: [String] = []
  var availableDarkThemes: [String] = []
  var availableLightThemes: [String] = []
  var confirmCloseSurface = GhosttyTerminalCloseConfirmation.whenNotAtPrompt
  var configPath = ""
  var darkTheme: String?
  var errorMessage: String?
  var fontFamily: String?
  var fontSize = 15.0
  var isApplying = false
  var isLoading = false
  var lightTheme: String?
  var warningMessage: String?

  var isBusy: Bool {
    isApplying || isLoading
  }
}

struct SettingsAgentIntegrationState: Equatable {
  var errorMessage: String?
  var health = CodingAgentIntegrationHealth.absent
  var isRefreshing = false
  var pendingEnabled: Bool?

  var isAvailable: Bool {
    health != .unavailable
  }

  var isEnabled: Bool {
    pendingEnabled
      ?? {
        switch health {
        case .unavailable, .absent:
          return false
        case .unavailableInstalled, .partial, .drifted, .healthy:
          return true
        }
      }()
  }

  var isPending: Bool {
    isRefreshing || pendingEnabled != nil
  }

  func message(for agent: SupatermAgentKind) -> String? {
    if let errorMessage {
      return errorMessage
    }
    switch health {
    case .unavailable, .unavailableInstalled:
      switch agent {
      case .claude:
        return "Claude Code is unavailable."
      case .codex:
        return "Codex 0.144.1 or newer is unavailable."
      case .pi:
        return PiSettingsInstallerError.piUnavailable.localizedDescription
      }
    case .partial:
      return "\(agent.notificationTitle) integration is incomplete."
    case .drifted:
      return "\(agent.notificationTitle) integration needs repair."
    case .absent, .healthy:
      return nil
    }
  }
}

struct SettingsAgentIntegrationInstallFailure: Equatable, Identifiable {
  let agent: SupatermAgentKind
  let log: String

  var id: String {
    agent.rawValue
  }

  var title: String {
    "Could Not Install \(agent.notificationTitle) Integration"
  }

  var message: String {
    "Supaterm could not install the integration. Review the error log below."
  }
}

struct SettingsAboutState: Equatable {
  var updateChannel = SupatermSettings.default.updateChannel
  var updatesAutomaticallyCheckForUpdates = true
  var updatesAutomaticallyDownloadUpdates = true
}

public enum SettingsAgentIntegrationResult: Equatable {
  case failure(String)
  case success(CodingAgentIntegrationHealth)
}

@Reducer
public struct SettingsFeature {
  @ObservableState
  public struct State: Equatable {
    var appearanceMode = SupatermSettings.default.appearanceMode
    var analyticsEnabled = SupatermSettings.default.analyticsEnabled
    @Presents var alert: AlertState<Alert>?
    var claudeIntegration = SettingsAgentIntegrationState()
    var codingAgentsShowPanel = SupatermSettings.default.codingAgentsShowPanel
    var codingAgentsShowIcons = SupatermSettings.default.codingAgentsShowIcons
    var codingAgentsShowSpinner = SupatermSettings.default.codingAgentsShowSpinner
    var codexIntegration = SettingsAgentIntegrationState()
    var piIntegration = SettingsAgentIntegrationState()
    var crashReportsEnabled = SupatermSettings.default.crashReportsEnabled
    var glowingPaneRingEnabled = SupatermSettings.default.glowingPaneRingEnabled
    var about = SettingsAboutState()
    var agentIntegrationInstallFailure: SettingsAgentIntegrationInstallFailure?
    var restoreTerminalLayoutEnabled = SupatermSettings.default.restoreTerminalLayoutEnabled
    public var selectedTab = Tab.general
    var shortcutOverrides = SupatermSettings.default.shortcutOverrides
    var systemNotificationsEnabled = SupatermSettings.default.systemNotificationsEnabled
    var terminalShortcutDisplays: Set<String> = []
    var terminal = SettingsTerminalState()
    var verboseLoggingEnabled = SupatermSettings.default.verboseLoggingEnabled
    var zmxSessionsEnabled = SupatermSettings.default.zmxSessionsEnabled

    public init() {}
  }

  public enum Action: Equatable {
    case agentIntegrationStatusRefreshRequested(SupatermAgentKind)
    case agentIntegrationStatusRefreshed(SupatermAgentKind, SettingsAgentIntegrationResult)
    case agentIntegrationInstallFailureDismissed
    case agentIntegrationToggled(SupatermAgentKind, Bool)
    case agentIntegrationToggleFinished(SupatermAgentKind, SettingsAgentIntegrationResult)
    case alert(PresentationAction<Alert>)
    case appearanceModeSelected(AppearanceMode)
    case analyticsEnabledChanged(Bool)
    case checkForUpdatesButtonTapped
    case codingAgentsShowPanelChanged(Bool)
    case codingAgentsShowIconsChanged(Bool)
    case codingAgentsShowSpinnerChanged(Bool)
    case crashReportsEnabledChanged(Bool)
    case glowingPaneRingEnabledChanged(Bool)
    case restoreTerminalLayoutEnabledChanged(Bool)
    case restoreShortcutDefaultsButtonTapped
    case settingsLoaded(SupatermSettings)
    case shortcutEnabledChanged(SupatermShortcutID, Bool)
    case shortcutRecorded(SupatermShortcutID, SupatermShortcutOverride)
    case shortcutResetButtonTapped(SupatermShortcutID)
    case systemNotificationsAuthorizationChecked(DesktopNotificationClient.AuthorizationStatus)
    case systemNotificationsAuthorizationResult(
      DesktopNotificationClient.AuthorizationRequestResult)
    case systemNotificationsEnabledChanged(Bool)
    case tabSelected(Tab)
    case task
    case terminalConfirmCloseSurfaceSelected(GhosttyTerminalCloseConfirmation)
    case terminalDarkThemeSelected(String?)
    case terminalFontFamilySelected(String?)
    case terminalFontSizeChanged(Double)
    case terminalLightThemeSelected(String?)
    case terminalSettingsApplied(GhosttyTerminalSettingsValues)
    case terminalSettingsApplyFailed(String)
    case terminalSettingsLoadFailed(String)
    case terminalSettingsLoadRequested
    case terminalSettingsLoaded(GhosttyTerminalSettingsSnapshot)
    case updateChannelSelected(UpdateChannel)
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
    case updatesAutomaticallyCheckForUpdatesChanged(Bool)
    case updatesAutomaticallyDownloadUpdatesChanged(Bool)
    case verboseLoggingEnabledChanged(Bool)
    case zmxSessionsEnabledChanged(Bool)
  }

  public enum Alert: Equatable {
    case dismiss
    case openSystemNotificationSettings
  }

  public enum Tab: String, CaseIterable, Equatable, Hashable, Identifiable {
    case general
    case terminal
    case notifications
    case shortcuts
    case codingAgents
    case advanced
    case about

    public var id: String {
      rawValue
    }

    var symbol: String {
      switch self {
      case .codingAgents:
        "hammer"
      case .advanced:
        "slider.horizontal.3"
      case .general:
        "gearshape"
      case .terminal:
        "terminal"
      case .notifications:
        "bell"
      case .shortcuts:
        "keyboard"
      case .about:
        "sparkles.rectangle.stack"
      }
    }

    var title: String {
      switch self {
      case .codingAgents:
        "Coding Agents"
      case .advanced:
        "Advanced"
      case .general:
        "General"
      case .terminal:
        "Terminal"
      case .notifications:
        "Notifications"
      case .shortcuts:
        "Shortcuts"
      case .about:
        "About"
      }
    }
  }

  @Dependency(ClaudeSettingsClient.self) var claudeSettingsClient
  @Dependency(CodexSettingsClient.self) var codexSettingsClient
  @Dependency(PiSettingsClient.self) var piSettingsClient
  @Dependency(ShortcutSettingsClient.self) var shortcutSettingsClient
  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(GhosttyTerminalSettingsClient.self) var ghosttyTerminalSettingsClient
  @Dependency(SupatermSkillClient.self) var supatermSkillClient
  @Dependency(UpdateClient.self) var updateClient

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .task:
        state.terminalShortcutDisplays = shortcutSettingsClient.terminalReservedDisplays()
        return loadSettings()

      case .settingsLoaded(let supatermSettings):
        applyLoadedSettings(&state, supatermSettings: supatermSettings)
        return .none

      case .updateClientSnapshotReceived(let snapshot):
        state.about.updatesAutomaticallyCheckForUpdates = snapshot.automaticallyChecksForUpdates
        state.about.updatesAutomaticallyDownloadUpdates = snapshot.automaticallyDownloadsUpdates
        return .none

      case .alert(.dismiss), .alert(.presented(.dismiss)):
        state.alert = nil
        return .none

      case .agentIntegrationInstallFailureDismissed:
        state.agentIntegrationInstallFailure = nil
        return .none

      case .alert(.presented(.openSystemNotificationSettings)):
        state.alert = nil
        return openSystemNotificationSettings()

      case .alert:
        return .none

      case .tabSelected(let tab):
        state.selectedTab = tab
        return .none

      case .shortcutRecorded(let id, let override):
        state.shortcutOverrides[id] = override
        return persistShortcuts(state)

      case .shortcutResetButtonTapped(let id):
        state.shortcutOverrides.removeValue(forKey: id)
        return persistShortcuts(state)

      case .shortcutEnabledChanged(let id, let isEnabled):
        if isEnabled {
          if var existing = state.shortcutOverrides[id],
            existing != .disabled
          {
            existing.isEnabled = true
            state.shortcutOverrides[id] = existing
          } else {
            state.shortcutOverrides.removeValue(forKey: id)
          }
        } else if var existing = state.shortcutOverrides[id] {
          existing.isEnabled = false
          state.shortcutOverrides[id] = existing
        } else {
          state.shortcutOverrides[id] = .disabled
        }
        return persistShortcuts(state)

      case .restoreShortcutDefaultsButtonTapped:
        state.shortcutOverrides = [:]
        return persistShortcuts(state)

      case .codingAgentsShowPanelChanged(let isEnabled):
        state.codingAgentsShowPanel = isEnabled
        return persist(state)

      case .codingAgentsShowIconsChanged(let isEnabled):
        state.codingAgentsShowIcons = isEnabled
        return persist(state)

      case .codingAgentsShowSpinnerChanged(let isEnabled):
        state.codingAgentsShowSpinner = isEnabled
        return persist(state)

      case .appearanceModeSelected,
        .analyticsEnabledChanged,
        .crashReportsEnabledChanged,
        .glowingPaneRingEnabledChanged,
        .restoreTerminalLayoutEnabledChanged,
        .zmxSessionsEnabledChanged:
        return reduceGeneral(&state, action: action)

      case .verboseLoggingEnabledChanged:
        return reduceAdvanced(&state, action: action)

      case .systemNotificationsEnabledChanged,
        .systemNotificationsAuthorizationChecked,
        .systemNotificationsAuthorizationResult:
        return reduceNotifications(&state, action: action)

      case .agentIntegrationStatusRefreshRequested,
        .agentIntegrationStatusRefreshed,
        .agentIntegrationToggled,
        .agentIntegrationToggleFinished:
        return reduceCodingAgents(&state, action: action)

      case .terminalConfirmCloseSurfaceSelected,
        .terminalDarkThemeSelected,
        .terminalFontFamilySelected,
        .terminalFontSizeChanged,
        .terminalLightThemeSelected,
        .terminalSettingsApplied,
        .terminalSettingsApplyFailed,
        .terminalSettingsLoadFailed,
        .terminalSettingsLoadRequested,
        .terminalSettingsLoaded:
        return reduceTerminal(&state, action: action)

      case .checkForUpdatesButtonTapped,
        .updateChannelSelected,
        .updatesAutomaticallyCheckForUpdatesChanged,
        .updatesAutomaticallyDownloadUpdatesChanged:
        return reduceAbout(&state, action: action)
      }
    }
  }

  func loadSettings() -> Effect<Action> {
    @Shared(.supatermSettings) var supatermSettings = .default
    return .merge(
      .send(.settingsLoaded(supatermSettings)),
      .send(.terminalSettingsLoadRequested),
      .send(.agentIntegrationStatusRefreshRequested(.claude)),
      .send(.agentIntegrationStatusRefreshRequested(.codex)),
      .send(.agentIntegrationStatusRefreshRequested(.pi)),
      .run { [updateClient] send in
        await updateClient.start()
        let stream = await updateClient.observe()
        for await snapshot in stream {
          await send(.updateClientSnapshotReceived(snapshot))
        }
      }
      .cancellable(id: SettingsFeatureCancelID.updateObservation, cancelInFlight: true)
    )
  }

  func applyLoadedSettings(
    _ state: inout State,
    supatermSettings: SupatermSettings
  ) {
    state.appearanceMode = supatermSettings.appearanceMode
    state.analyticsEnabled = supatermSettings.analyticsEnabled
    state.codingAgentsShowPanel = supatermSettings.codingAgentsShowPanel
    state.codingAgentsShowIcons = supatermSettings.codingAgentsShowIcons
    state.codingAgentsShowSpinner = supatermSettings.codingAgentsShowSpinner
    state.crashReportsEnabled = supatermSettings.crashReportsEnabled
    state.glowingPaneRingEnabled = supatermSettings.glowingPaneRingEnabled
    state.restoreTerminalLayoutEnabled = supatermSettings.restoreTerminalLayoutEnabled
    state.shortcutOverrides = supatermSettings.shortcutOverrides
    state.systemNotificationsEnabled = supatermSettings.systemNotificationsEnabled
    state.about.updateChannel = supatermSettings.updateChannel
    state.verboseLoggingEnabled = supatermSettings.verboseLoggingEnabled
    SupatermLog.setVerboseLoggingEnabled(supatermSettings.verboseLoggingEnabled)
    state.zmxSessionsEnabled = supatermSettings.zmxSessionsEnabled
  }

  func openSystemNotificationSettings() -> Effect<Action> {
    .run { [desktopNotificationClient] _ in
      await desktopNotificationClient.openSettings()
    }
  }

  func persist(_ state: State) -> Effect<Action> {
    let supatermSettings = SupatermSettings(
      appearanceMode: state.appearanceMode,
      analyticsEnabled: state.analyticsEnabled,
      codingAgentsShowPanel: state.codingAgentsShowPanel,
      codingAgentsShowIcons: state.codingAgentsShowIcons,
      codingAgentsShowSpinner: state.codingAgentsShowSpinner,
      crashReportsEnabled: state.crashReportsEnabled,
      glowingPaneRingEnabled: state.glowingPaneRingEnabled,
      restoreTerminalLayoutEnabled: state.restoreTerminalLayoutEnabled,
      shortcutOverrides: state.shortcutOverrides,
      systemNotificationsEnabled: state.systemNotificationsEnabled,
      updateChannel: state.about.updateChannel,
      verboseLoggingEnabled: state.verboseLoggingEnabled,
      zmxSessionsEnabled: state.zmxSessionsEnabled
    )
    @Shared(.supatermSettings) var sharedSupatermSettings = .default
    $sharedSupatermSettings.withLock {
      $0 = supatermSettings
    }
    if supatermSettings.analyticsEnabled {
      analyticsClient.capture("settings_changed")
    }
    return .none
  }

  func persistShortcuts(_ state: State) -> Effect<Action> {
    .merge(
      persist(state),
      .run { [shortcutSettingsClient] _ in
        await shortcutSettingsClient.shortcutsDidChange()
      }
    )
  }
}
