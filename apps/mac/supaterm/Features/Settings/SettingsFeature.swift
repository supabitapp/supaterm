import ComposableArchitecture
import Foundation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermUpdateFeature

nonisolated enum SettingsFeatureCancelID: Hashable, Sendable {
  case agentIntegration(String)
  case terminalOperation
  case updateObservation
}

enum SettingsTerminalOperation: Equatable {
  case applying
  case idle
  case loading
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
  var lightTheme: String?
  var operation = SettingsTerminalOperation.idle
  var warningMessage: String?

  var isBusy: Bool {
    operation != .idle
  }
}

struct SettingsAgentIntegrationState: Equatable {
  var errorMessage: String?
  var health = CodingAgentIntegrationHealth.absent
  var operation = SettingsAgentIntegrationOperation.idle

  var isAvailable: Bool {
    health != .unavailable
  }

  var isEnabled: Bool {
    if case .settingEnabled(let isEnabled) = operation {
      return isEnabled
    }
    switch health {
    case .unavailable, .absent:
      return false
    case .unavailableInstalled, .partial, .drifted, .healthy:
      return true
    }
  }

  var isPending: Bool {
    operation != .idle
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

enum SettingsAgentIntegrationOperation: Equatable {
  case idle
  case refreshing
  case settingEnabled(Bool)
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
    @Presents var alert: AlertState<Alert>?
    var about = SettingsAboutState()
    var agentIntegrationInstallFailure: SettingsAgentIntegrationInstallFailure?
    var claudeIntegration = SettingsAgentIntegrationState()
    var codexIntegration = SettingsAgentIntegrationState()
    var piIntegration = SettingsAgentIntegrationState()
    var pendingSystemNotificationsEnabled: Bool?
    public var selectedTab = Tab.general
    @Shared(.supatermSettings) var supatermSettings = .default
    var terminalShortcutDisplays: Set<String> = []
    var terminal = SettingsTerminalState()

    var analyticsEnabled: Bool { supatermSettings.analyticsEnabled }
    var appearanceMode: AppearanceMode { supatermSettings.appearanceMode }
    var codingAgentsShowPanel: Bool { supatermSettings.codingAgentsShowPanel }
    var crashReportsEnabled: Bool { supatermSettings.crashReportsEnabled }
    var glowingPaneRingEnabled: Bool { supatermSettings.glowingPaneRingEnabled }
    var restoreTerminalLayoutEnabled: Bool { supatermSettings.restoreTerminalLayoutEnabled }
    var shortcutOverrides: [SupatermShortcutID: SupatermShortcutOverride] {
      supatermSettings.shortcutOverrides
    }
    var systemNotificationsEnabled: Bool {
      pendingSystemNotificationsEnabled ?? supatermSettings.systemNotificationsEnabled
    }
    var updateChannel: UpdateChannel { supatermSettings.updateChannel }
    var verboseLoggingEnabled: Bool { supatermSettings.verboseLoggingEnabled }
    var zmxSessionsEnabled: Bool { supatermSettings.zmxSessionsEnabled }

    public init() {}
  }

  public enum Action {
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
    case crashReportsEnabledChanged(Bool)
    case glowingPaneRingEnabledChanged(Bool)
    case restoreTerminalLayoutEnabledChanged(Bool)
    case restoreShortcutDefaultsButtonTapped
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
    case terminalSettingsApplyResponse(Result<GhosttyTerminalSettingsValues, any Error>)
    case terminalSettingsLoadRequested
    case terminalSettingsLoadResponse(Result<GhosttyTerminalSettingsSnapshot, any Error>)
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
        SupatermLog.setVerboseLoggingEnabled(state.verboseLoggingEnabled)
        return startTasks()

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
        return updateShortcuts(&state) {
          $0[id] = override
        }

      case .shortcutResetButtonTapped(let id):
        return updateShortcuts(&state) {
          $0.removeValue(forKey: id)
        }

      case .shortcutEnabledChanged(let id, let isEnabled):
        return updateShortcuts(&state) { shortcutOverrides in
          if isEnabled {
            if var existing = shortcutOverrides[id],
              existing != .disabled
            {
              existing.isEnabled = true
              shortcutOverrides[id] = existing
            } else {
              shortcutOverrides.removeValue(forKey: id)
            }
          } else if var existing = shortcutOverrides[id] {
            existing.isEnabled = false
            shortcutOverrides[id] = existing
          } else {
            shortcutOverrides[id] = .disabled
          }
        }

      case .restoreShortcutDefaultsButtonTapped:
        return updateShortcuts(&state) {
          $0 = [:]
        }

      case .codingAgentsShowPanelChanged(let isEnabled):
        updateSettings(&state) {
          $0.codingAgentsShowPanel = isEnabled
        }
        return .none

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

      case .terminalSettingsApplyResponse,
        .terminalSettingsLoadRequested,
        .terminalSettingsLoadResponse:
        return reduceTerminalLoading(&state, action: action)

      case .terminalConfirmCloseSurfaceSelected,
        .terminalDarkThemeSelected,
        .terminalFontFamilySelected,
        .terminalFontSizeChanged,
        .terminalLightThemeSelected:
        return reduceTerminalControls(&state, action: action)

      case .checkForUpdatesButtonTapped,
        .updateChannelSelected,
        .updatesAutomaticallyCheckForUpdatesChanged,
        .updatesAutomaticallyDownloadUpdatesChanged:
        return reduceAbout(&state, action: action)
      }
    }
  }

  func startTasks() -> Effect<Action> {
    .merge(
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

  func openSystemNotificationSettings() -> Effect<Action> {
    .run { [desktopNotificationClient] _ in
      await desktopNotificationClient.openSettings()
    }
  }

  func updateSettings(
    _ state: inout State,
    _ update: (inout SupatermSettings) -> Void
  ) {
    state.$supatermSettings.withLock(update)
    if state.analyticsEnabled {
      analyticsClient.capture("settings_changed")
    }
  }

  func updateShortcuts(
    _ state: inout State,
    _ update: (inout [SupatermShortcutID: SupatermShortcutOverride]) -> Void
  ) -> Effect<Action> {
    updateSettings(&state) {
      update(&$0.shortcutOverrides)
    }
    return .run { [shortcutSettingsClient] _ in
      await shortcutSettingsClient.shortcutsDidChange()
    }
  }
}
