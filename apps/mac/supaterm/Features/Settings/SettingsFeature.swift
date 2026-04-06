import ComposableArchitecture
import Foundation
import Sharing
import SupatermCLIShared

private enum SettingsFeatureCancelID {
  static let updateObservation = "SettingsFeature.updateObservation"
}

struct SettingsTerminalState: Equatable {
  var availableFontFamilies: [String] = []
  var configPath = ""
  var errorMessage: String?
  var fontFamily: String?
  var fontSize = 15.0
  var isApplying = false
  var isLoading = false
  var warningMessage: String?
}

struct SettingsAgentHooksState: Equatable {
  let settingsPath: String
  var confirmedEnabled = false
  var errorMessage: String?
  var isEnabled = false
  var isPending = false

  var isFailure: Bool {
    errorMessage != nil
  }
}

enum SettingsAgentHooksResult: Equatable {
  case failure(String)
  case success(Bool)
}

@Reducer
struct SettingsFeature {
  @ObservableState
  struct State: Equatable {
    var appearanceMode = SupatermSettings.default.appearanceMode
    var analyticsEnabled = SupatermSettings.default.analyticsEnabled
    @Presents var alert: AlertState<Alert>?
    var claudeHooks = SettingsAgentHooksState(settingsPath: "~/.claude/settings.json")
    var codexHooks = SettingsAgentHooksState(settingsPath: "~/.codex/hooks.json")
    var crashReportsEnabled = SupatermSettings.default.crashReportsEnabled
    var restoreTerminalLayoutEnabled = SupatermSettings.default.restoreTerminalLayoutEnabled
    var selectedTab = Tab.general
    var systemNotificationsEnabled = SupatermSettings.default.systemNotificationsEnabled
    var terminal = SettingsTerminalState()
    var updateChannel = SupatermSettings.default.updateChannel
    var updatesAutomaticallyCheckForUpdates = true
    var updatesAutomaticallyDownloadUpdates = true
  }

  enum Action: Equatable {
    case agentHooksStatusRefreshRequested(SupatermAgentKind)
    case agentHooksStatusRefreshed(SupatermAgentKind, SettingsAgentHooksResult)
    case agentHooksToggled(SupatermAgentKind, Bool)
    case agentHooksToggleFinished(SupatermAgentKind, SettingsAgentHooksResult)
    case alert(PresentationAction<Alert>)
    case appearanceModeSelected(AppearanceMode)
    case analyticsEnabledChanged(Bool)
    case checkForUpdatesButtonTapped
    case crashReportsEnabledChanged(Bool)
    case restoreTerminalLayoutEnabledChanged(Bool)
    case settingsLoaded(SupatermSettings)
    case systemNotificationsAuthorizationChecked(DesktopNotificationClient.AuthorizationStatus)
    case systemNotificationsAuthorizationResult(DesktopNotificationClient.AuthorizationRequestResult)
    case systemNotificationsEnabledChanged(Bool)
    case tabSelected(Tab)
    case task
    case terminalFontFamilySelected(String?)
    case terminalFontSizeChanged(Double)
    case terminalSettingsApplied(GhosttyTerminalSettingsSnapshot)
    case terminalSettingsApplyFailed(String)
    case terminalSettingsLoadFailed(String)
    case terminalSettingsLoadRequested
    case terminalSettingsLoaded(GhosttyTerminalSettingsSnapshot)
    case updateChannelSelected(UpdateChannel)
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
    case updatesAutomaticallyCheckForUpdatesChanged(Bool)
    case updatesAutomaticallyDownloadUpdatesChanged(Bool)
  }

  enum Alert: Equatable {
    case dismiss
    case openSystemNotificationSettings
  }

  enum Tab: String, CaseIterable, Equatable, Hashable, Identifiable {
    case general
    case terminal
    case notifications
    case codingAgents
    case about

    var id: String {
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
  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(GhosttyTerminalSettingsClient.self) var ghosttyTerminalSettingsClient
  @Dependency(UpdateClient.self) var updateClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .task:
        @Shared(.supatermSettings) var supatermSettings = .default
        return .merge(
          .send(.settingsLoaded(supatermSettings)),
          .send(.terminalSettingsLoadRequested),
          .send(.agentHooksStatusRefreshRequested(.claude)),
          .send(.agentHooksStatusRefreshRequested(.codex)),
          .run { [updateClient] send in
            await updateClient.start()
            let stream = await updateClient.observe()
            for await snapshot in stream {
              await send(.updateClientSnapshotReceived(snapshot))
            }
          }
          .cancellable(id: SettingsFeatureCancelID.updateObservation, cancelInFlight: true)
        )

      case .settingsLoaded(let supatermSettings):
        state.appearanceMode = supatermSettings.appearanceMode
        state.analyticsEnabled = supatermSettings.analyticsEnabled
        state.crashReportsEnabled = supatermSettings.crashReportsEnabled
        state.restoreTerminalLayoutEnabled = supatermSettings.restoreTerminalLayoutEnabled
        state.systemNotificationsEnabled = supatermSettings.systemNotificationsEnabled
        state.updateChannel = supatermSettings.updateChannel
        return .none

      case .updateClientSnapshotReceived(let snapshot):
        state.updatesAutomaticallyCheckForUpdates = snapshot.automaticallyChecksForUpdates
        state.updatesAutomaticallyDownloadUpdates = snapshot.automaticallyDownloadsUpdates
        return .none

      case .terminalSettingsLoadRequested:
        guard !state.terminal.isLoading else {
          return .none
        }
        state.terminal.errorMessage = nil
        state.terminal.isLoading = true
        return .run { [ghosttyTerminalSettingsClient] send in
          do {
            await send(.terminalSettingsLoaded(try await ghosttyTerminalSettingsClient.load()))
          } catch {
            await send(.terminalSettingsLoadFailed(error.localizedDescription))
          }
        }

      case .terminalSettingsLoaded(let snapshot), .terminalSettingsApplied(let snapshot):
        updateTerminalState(&state.terminal, with: snapshot)
        return .none

      case .terminalSettingsLoadFailed(let message):
        state.terminal.errorMessage = message
        state.terminal.isLoading = false
        return .none

      case .terminalSettingsApplyFailed(let message):
        state.terminal.errorMessage = message
        state.terminal.isApplying = false
        return .none

      case .terminalFontFamilySelected(let fontFamily):
        guard !state.terminal.isLoading, !state.terminal.isApplying else {
          return .none
        }
        state.terminal.errorMessage = nil
        state.terminal.fontFamily = fontFamily
        state.terminal.isApplying = true
        return applyTerminalSettings(
          fontFamily: fontFamily,
          fontSize: state.terminal.fontSize
        )

      case .terminalFontSizeChanged(let fontSize):
        guard !state.terminal.isLoading, !state.terminal.isApplying else {
          return .none
        }
        state.terminal.errorMessage = nil
        state.terminal.fontSize = fontSize
        state.terminal.isApplying = true
        return applyTerminalSettings(
          fontFamily: state.terminal.fontFamily,
          fontSize: fontSize
        )

      case .alert(.dismiss), .alert(.presented(.dismiss)):
        state.alert = nil
        return .none

      case .alert(.presented(.openSystemNotificationSettings)):
        state.alert = nil
        return .run { [desktopNotificationClient] _ in
          await desktopNotificationClient.openSettings()
        }

      case .alert:
        return .none

      case .appearanceModeSelected(let appearanceMode):
        state.appearanceMode = appearanceMode
        return persist(state)

      case .analyticsEnabledChanged(let isEnabled):
        state.analyticsEnabled = isEnabled
        return persist(state)

      case .agentHooksStatusRefreshRequested(let agent):
        let keyPath = agentHooksKeyPath(for: agent)
        guard !state[keyPath: keyPath].isPending else {
          return .none
        }
        state[keyPath: keyPath].isPending = true
        let loadStatus = loadSupatermHooksOperation(for: agent)
        return .run { send in
          do {
            await send(.agentHooksStatusRefreshed(agent, .success(try await loadStatus())))
          } catch {
            await send(.agentHooksStatusRefreshed(agent, .failure(error.localizedDescription)))
          }
        }

      case .agentHooksStatusRefreshed(let agent, .success(let isEnabled)):
        let keyPath = agentHooksKeyPath(for: agent)
        state[keyPath: keyPath].confirmedEnabled = isEnabled
        state[keyPath: keyPath].errorMessage = nil
        state[keyPath: keyPath].isEnabled = isEnabled
        state[keyPath: keyPath].isPending = false
        return .none

      case .agentHooksStatusRefreshed(let agent, .failure(let message)):
        let keyPath = agentHooksKeyPath(for: agent)
        state[keyPath: keyPath].errorMessage = message
        state[keyPath: keyPath].isEnabled = state[keyPath: keyPath].confirmedEnabled
        state[keyPath: keyPath].isPending = false
        return .none

      case .agentHooksToggled(let agent, let isEnabled):
        let keyPath = agentHooksKeyPath(for: agent)
        guard !state[keyPath: keyPath].isPending else {
          return .none
        }
        state[keyPath: keyPath].errorMessage = nil
        state[keyPath: keyPath].isEnabled = isEnabled
        state[keyPath: keyPath].isPending = true
        let updateStatus = updateSupatermHooksOperation(for: agent, isEnabled: isEnabled)
        return .run { send in
          do {
            await send(.agentHooksToggleFinished(agent, .success(try await updateStatus())))
          } catch {
            await send(.agentHooksToggleFinished(agent, .failure(error.localizedDescription)))
          }
        }

      case .agentHooksToggleFinished(let agent, .success(let isEnabled)):
        let keyPath = agentHooksKeyPath(for: agent)
        state[keyPath: keyPath].confirmedEnabled = isEnabled
        state[keyPath: keyPath].errorMessage = nil
        state[keyPath: keyPath].isEnabled = isEnabled
        state[keyPath: keyPath].isPending = false
        return .none

      case .agentHooksToggleFinished(let agent, .failure(let message)):
        let keyPath = agentHooksKeyPath(for: agent)
        state[keyPath: keyPath].errorMessage = message
        state[keyPath: keyPath].isEnabled = state[keyPath: keyPath].confirmedEnabled
        state[keyPath: keyPath].isPending = false
        return .none

      case .crashReportsEnabledChanged(let isEnabled):
        state.crashReportsEnabled = isEnabled
        return persist(state)

      case .restoreTerminalLayoutEnabledChanged(let isEnabled):
        state.restoreTerminalLayoutEnabled = isEnabled
        return persist(state)

      case .systemNotificationsEnabledChanged(let isEnabled):
        state.alert = nil
        state.systemNotificationsEnabled = isEnabled
        guard isEnabled else {
          return persist(state)
        }
        return .run { [desktopNotificationClient] send in
          let status = await desktopNotificationClient.authorizationStatus()
          await send(.systemNotificationsAuthorizationChecked(status))
        }

      case .systemNotificationsAuthorizationChecked(let status):
        switch status {
        case .authorized:
          return persist(state)

        case .denied:
          return .send(
            .systemNotificationsAuthorizationResult(
              .init(granted: false, errorMessage: "Authorization status is denied.")
            )
          )

        case .notDetermined:
          return .run { [desktopNotificationClient] send in
            let result = await desktopNotificationClient.requestAuthorization()
            await send(.systemNotificationsAuthorizationResult(result))
          }
        }

      case .systemNotificationsAuthorizationResult(let result):
        guard result.granted else {
          state.systemNotificationsEnabled = false
          state.alert = notificationPermissionAlert(errorMessage: result.errorMessage)
          return persist(state)
        }
        return persist(state)

      case .checkForUpdatesButtonTapped:
        analyticsClient.capture("update_checked")
        return .run { [updateClient] _ in
          await updateClient.perform(.checkForUpdates)
        }

      case .tabSelected(let tab):
        state.selectedTab = tab
        return .none

      case .updateChannelSelected(let updateChannel):
        state.updateChannel = updateChannel
        return .merge(
          persist(state),
          .run { [updateClient] _ in
            await updateClient.setUpdateChannel(updateChannel)
          }
        )

      case .updatesAutomaticallyCheckForUpdatesChanged(let isEnabled):
        state.updatesAutomaticallyCheckForUpdates = isEnabled
        if !isEnabled {
          state.updatesAutomaticallyDownloadUpdates = false
        }
        return .run { [updateClient] _ in
          await updateClient.setAutomaticallyChecksForUpdates(isEnabled)
        }

      case .updatesAutomaticallyDownloadUpdatesChanged(let isEnabled):
        guard state.updatesAutomaticallyCheckForUpdates else {
          return .none
        }
        state.updatesAutomaticallyDownloadUpdates = isEnabled
        return .run { [updateClient] _ in
          await updateClient.setAutomaticallyDownloadsUpdates(isEnabled)
        }
      }
    }
  }

  private func persist(_ state: State) -> Effect<Action> {
    let supatermSettings = SupatermSettings(
      appearanceMode: state.appearanceMode,
      analyticsEnabled: state.analyticsEnabled,
      crashReportsEnabled: state.crashReportsEnabled,
      restoreTerminalLayoutEnabled: state.restoreTerminalLayoutEnabled,
      systemNotificationsEnabled: state.systemNotificationsEnabled,
      updateChannel: state.updateChannel
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

  private func agentHooksKeyPath(
    for agent: SupatermAgentKind
  ) -> WritableKeyPath<State, SettingsAgentHooksState> {
    switch agent {
    case .claude:
      return \.claudeHooks
    case .codex:
      return \.codexHooks
    }
  }

  private func loadSupatermHooksOperation(
    for agent: SupatermAgentKind
  ) -> @Sendable () async throws -> Bool {
    switch agent {
    case .claude:
      let client = claudeSettingsClient
      return { try await client.hasSupatermHooks() }
    case .codex:
      let client = codexSettingsClient
      return { try await client.hasSupatermHooks() }
    }
  }

  private func updateSupatermHooksOperation(
    for agent: SupatermAgentKind,
    isEnabled: Bool
  ) -> @Sendable () async throws -> Bool {
    switch agent {
    case .claude:
      let client = claudeSettingsClient
      return {
        if isEnabled {
          try await client.installSupatermHooks()
        } else {
          try await client.removeSupatermHooks()
        }
        return try await client.hasSupatermHooks()
      }
    case .codex:
      let client = codexSettingsClient
      return {
        if isEnabled {
          try await client.installSupatermHooks()
        } else {
          try await client.removeSupatermHooks()
        }
        return try await client.hasSupatermHooks()
      }
    }
  }

  private func updateTerminalState(
    _ state: inout SettingsTerminalState,
    with snapshot: GhosttyTerminalSettingsSnapshot
  ) {
    state.availableFontFamilies = snapshot.availableFontFamilies
    state.configPath = snapshot.configPath
    state.errorMessage = nil
    state.fontFamily = snapshot.fontFamily
    state.fontSize = snapshot.fontSize
    state.isApplying = false
    state.isLoading = false
    state.warningMessage = snapshot.warningMessage
  }

  private func applyTerminalSettings(
    fontFamily: String?,
    fontSize: Double
  ) -> Effect<Action> {
    .run { [ghosttyTerminalSettingsClient] send in
      do {
        await send(.terminalSettingsApplied(try await ghosttyTerminalSettingsClient.apply(fontFamily, fontSize)))
      } catch {
        await send(.terminalSettingsApplyFailed(error.localizedDescription))
      }
    }
  }

  private func notificationPermissionAlert(errorMessage: String?) -> AlertState<Alert> {
    let message: String
    if let errorMessage, !errorMessage.isEmpty {
      message =
        "Supaterm cannot send system notifications.\n\n"
        + "Error: \(errorMessage)"
    } else {
      message = "Supaterm cannot send system notifications while permission is denied."
    }
    return AlertState {
      TextState("Enable Notifications in System Settings")
    } actions: {
      ButtonState(action: .openSystemNotificationSettings) {
        TextState("Open System Settings")
      }
      ButtonState(role: .cancel, action: .dismiss) {
        TextState("Cancel")
      }
    } message: {
      TextState(message)
    }
  }
}
