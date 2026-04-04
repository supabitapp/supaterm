import ComposableArchitecture
import Foundation
import Sharing

private enum SettingsFeatureCancelID {
  static let updateObservation = "SettingsFeature.updateObservation"
}

enum SettingsAgentHooksInstallState: Equatable {
  case idle
  case failed(String)
  case installing
  case succeeded(String)

  var isFailure: Bool {
    if case .failed = self {
      return true
    }
    return false
  }

  var isInstalling: Bool {
    if case .installing = self {
      return true
    }
    return false
  }

  var message: String? {
    switch self {
    case .idle, .installing:
      return nil
    case .failed(let message), .succeeded(let message):
      return message
    }
  }
}

enum SettingsAgentHooksInstallResult: Equatable {
  case failure(String)
  case success
}

@Reducer
struct SettingsFeature {
  @ObservableState
  struct State: Equatable {
    var appearanceMode = AppPrefs.default.appearanceMode
    var analyticsEnabled = AppPrefs.default.analyticsEnabled
    @Presents var alert: AlertState<Alert>?
    var claudeHooksInstallState = SettingsAgentHooksInstallState.idle
    var codexHooksInstallState = SettingsAgentHooksInstallState.idle
    var crashReportsEnabled = AppPrefs.default.crashReportsEnabled
    var selectedTab = Tab.general
    var systemNotificationsEnabled = AppPrefs.default.systemNotificationsEnabled
    var updateChannel = AppPrefs.default.updateChannel
    var updatesAutomaticallyCheckForUpdates = true
    var updatesAutomaticallyDownloadUpdates = true
  }

  enum Action: Equatable {
    case alert(PresentationAction<Alert>)
    case appearanceModeSelected(AppearanceMode)
    case analyticsEnabledChanged(Bool)
    case checkForUpdatesButtonTapped
    case claudeHooksInstallButtonTapped
    case claudeHooksInstallFinished(SettingsAgentHooksInstallResult)
    case codexHooksInstallButtonTapped
    case codexHooksInstallFinished(SettingsAgentHooksInstallResult)
    case crashReportsEnabledChanged(Bool)
    case settingsLoaded(AppPrefs)
    case systemNotificationsAuthorizationChecked(DesktopNotificationClient.AuthorizationStatus)
    case systemNotificationsAuthorizationResult(DesktopNotificationClient.AuthorizationRequestResult)
    case systemNotificationsEnabledChanged(Bool)
    case tabSelected(Tab)
    case task
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
    case advanced
    case notifications
    case codingAgents
    case updates
    case about

    var id: String {
      rawValue
    }

    var symbol: String {
      switch self {
      case .advanced:
        "gearshape.2"
      case .codingAgents:
        "hammer"
      case .general:
        "gearshape"
      case .notifications:
        "bell"
      case .updates:
        "arrow.down.circle"
      case .about:
        "sparkles.rectangle.stack"
      }
    }

    var title: String {
      switch self {
      case .advanced:
        "Advanced"
      case .codingAgents:
        "Coding Agents"
      case .general:
        "General"
      case .notifications:
        "Notifications"
      case .updates:
        "Updates"
      case .about:
        "About"
      }
    }
  }

  @Dependency(ClaudeSettingsClient.self) var claudeSettingsClient
  @Dependency(CodexSettingsClient.self) var codexSettingsClient
  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(UpdateClient.self) var updateClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .task:
        @Shared(.appPrefs) var appPrefs = .default
        return .merge(
          .send(.settingsLoaded(appPrefs)),
          .run { [updateClient] send in
            await updateClient.start()
            let stream = await updateClient.observe()
            for await snapshot in stream {
              await send(.updateClientSnapshotReceived(snapshot))
            }
          }
          .cancellable(id: SettingsFeatureCancelID.updateObservation, cancelInFlight: true)
        )

      case .settingsLoaded(let appPrefs):
        state.appearanceMode = appPrefs.appearanceMode
        state.analyticsEnabled = appPrefs.analyticsEnabled
        state.crashReportsEnabled = appPrefs.crashReportsEnabled
        state.systemNotificationsEnabled = appPrefs.systemNotificationsEnabled
        state.updateChannel = appPrefs.updateChannel
        return .none

      case .updateClientSnapshotReceived(let snapshot):
        state.updatesAutomaticallyCheckForUpdates = snapshot.automaticallyChecksForUpdates
        state.updatesAutomaticallyDownloadUpdates = snapshot.automaticallyDownloadsUpdates
        return .none

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

      case .claudeHooksInstallButtonTapped:
        guard !state.claudeHooksInstallState.isInstalling else {
          return .none
        }
        state.claudeHooksInstallState = .installing
        return .run { [claudeSettingsClient] send in
          do {
            try await claudeSettingsClient.installSupatermHooks()
            await send(.claudeHooksInstallFinished(.success))
          } catch {
            await send(.claudeHooksInstallFinished(.failure(error.localizedDescription)))
          }
        }

      case .claudeHooksInstallFinished(.success):
        state.claudeHooksInstallState = .succeeded("Claude hooks installed in ~/.claude/settings.json.")
        return .none

      case .claudeHooksInstallFinished(.failure(let message)):
        state.claudeHooksInstallState = .failed(message)
        return .none

      case .codexHooksInstallButtonTapped:
        guard !state.codexHooksInstallState.isInstalling else {
          return .none
        }
        state.codexHooksInstallState = .installing
        return .run { [codexSettingsClient] send in
          do {
            try await codexSettingsClient.installSupatermHooks()
            await send(.codexHooksInstallFinished(.success))
          } catch {
            await send(.codexHooksInstallFinished(.failure(error.localizedDescription)))
          }
        }

      case .codexHooksInstallFinished(.success):
        state.codexHooksInstallState = .succeeded("Codex hooks installed in ~/.codex/hooks.json.")
        return .none

      case .codexHooksInstallFinished(.failure(let message)):
        state.codexHooksInstallState = .failed(message)
        return .none

      case .crashReportsEnabledChanged(let isEnabled):
        state.crashReportsEnabled = isEnabled
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
    let appPrefs = AppPrefs(
      appearanceMode: state.appearanceMode,
      analyticsEnabled: state.analyticsEnabled,
      crashReportsEnabled: state.crashReportsEnabled,
      systemNotificationsEnabled: state.systemNotificationsEnabled,
      updateChannel: state.updateChannel
    )
    @Shared(.appPrefs) var sharedAppPrefs = .default
    $sharedAppPrefs.withLock {
      $0 = appPrefs
    }
    if appPrefs.analyticsEnabled {
      analyticsClient.capture("settings_changed")
    }
    return .none
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
