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
  let settingsPath: String
  var confirmedEnabled = false
  var errorMessage: String?
  var isAvailable = true
  var isEnabled = false
  var isPending = false

  var isFailure: Bool {
    errorMessage != nil
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
  case unavailable(String)
  case failure(String)
  case success(Bool)
}

@Reducer
public struct SettingsFeature {
  @ObservableState
  public struct State: Equatable {
    var appearanceMode = SupatermSettings.default.appearanceMode
    var analyticsEnabled = SupatermSettings.default.analyticsEnabled
    @Presents var alert: AlertState<Alert>?
    var claudeIntegration = SettingsAgentIntegrationState(
      settingsPath: SupatermAgentKind.claude.settingsPathDescription
    )
    var codexIntegration = SettingsAgentIntegrationState(
      settingsPath: SupatermAgentKind.codex.settingsPathDescription
    )
    var piIntegration = SettingsAgentIntegrationState(
      settingsPath: SupatermAgentKind.pi.settingsPathDescription
    )
    var crashReportsEnabled = SupatermSettings.default.crashReportsEnabled
    var glowingPaneRingEnabled = SupatermSettings.default.glowingPaneRingEnabled
    var newTabPosition = SupatermSettings.default.newTabPosition
    var about = SettingsAboutState()
    var agentIntegrationInstallFailure: SettingsAgentIntegrationInstallFailure?
    var restoreTerminalLayoutEnabled = SupatermSettings.default.restoreTerminalLayoutEnabled
    public var selectedTab = Tab.general
    var systemNotificationsEnabled = SupatermSettings.default.systemNotificationsEnabled
    var terminal = SettingsTerminalState()

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
    case crashReportsEnabledChanged(Bool)
    case glowingPaneRingEnabledChanged(Bool)
    case newTabPositionSelected(NewTabPosition)
    case restoreTerminalLayoutEnabledChanged(Bool)
    case settingsLoaded(SupatermSettings)
    case systemNotificationsAuthorizationChecked(DesktopNotificationClient.AuthorizationStatus)
    case systemNotificationsAuthorizationResult(DesktopNotificationClient.AuthorizationRequestResult)
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
  }

  public enum Alert: Equatable {
    case dismiss
    case openSystemNotificationSettings
  }

  public enum Tab: String, CaseIterable, Equatable, Hashable, Identifiable {
    case general
    case terminal
    case notifications
    case codingAgents
    case about

    public var id: String {
      rawValue
    }

    var symbol: String {
      switch self {
      case .codingAgents:
        "hammer"
      case .general:
        "gearshape"
      case .terminal:
        "terminal"
      case .notifications:
        "bell"
      case .about:
        "sparkles.rectangle.stack"
      }
    }

    var title: String {
      switch self {
      case .codingAgents:
        "Coding Agents"
      case .general:
        "General"
      case .terminal:
        "Terminal"
      case .notifications:
        "Notifications"
      case .about:
        "About"
      }
    }
  }

  @Dependency(ClaudeSettingsClient.self) var claudeSettingsClient
  @Dependency(CodexSettingsClient.self) var codexSettingsClient
  @Dependency(PiSettingsClient.self) var piSettingsClient
  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(GhosttyTerminalSettingsClient.self) var ghosttyTerminalSettingsClient
  @Dependency(UpdateClient.self) var updateClient

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .task:
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

      case .appearanceModeSelected,
        .analyticsEnabledChanged,
        .crashReportsEnabledChanged,
        .glowingPaneRingEnabledChanged,
        .newTabPositionSelected,
        .restoreTerminalLayoutEnabledChanged:
        return reduceGeneral(&state, action: action)

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
    state.crashReportsEnabled = supatermSettings.crashReportsEnabled
    state.glowingPaneRingEnabled = supatermSettings.glowingPaneRingEnabled
    state.newTabPosition = supatermSettings.newTabPosition
    state.restoreTerminalLayoutEnabled = supatermSettings.restoreTerminalLayoutEnabled
    state.systemNotificationsEnabled = supatermSettings.systemNotificationsEnabled
    state.about.updateChannel = supatermSettings.updateChannel
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
      crashReportsEnabled: state.crashReportsEnabled,
      glowingPaneRingEnabled: state.glowingPaneRingEnabled,
      newTabPosition: state.newTabPosition,
      restoreTerminalLayoutEnabled: state.restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: state.systemNotificationsEnabled,
      updateChannel: state.about.updateChannel
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
}
