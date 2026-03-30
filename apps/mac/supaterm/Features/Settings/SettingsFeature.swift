import ComposableArchitecture
import Foundation
import Sharing

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
    var claudeHooksInstallState = SettingsAgentHooksInstallState.idle
    var codexHooksInstallState = SettingsAgentHooksInstallState.idle
    var selectedTab = Tab.general
    var updateChannel = AppPrefs.default.updateChannel
    var updatesAutomaticallyCheckForUpdates = AppPrefs.default.updatesAutomaticallyCheckForUpdates
    var updatesAutomaticallyDownloadUpdates = AppPrefs.default.updatesAutomaticallyDownloadUpdates
  }

  enum Action: Equatable {
    case appearanceModeSelected(AppearanceMode)
    case checkForUpdatesButtonTapped
    case claudeHooksInstallButtonTapped
    case claudeHooksInstallFinished(SettingsAgentHooksInstallResult)
    case codexHooksInstallButtonTapped
    case codexHooksInstallFinished(SettingsAgentHooksInstallResult)
    case settingsLoaded(AppPrefs)
    case tabSelected(Tab)
    case task
    case updateChannelSelected(UpdateChannel)
    case updatesAutomaticallyCheckForUpdatesChanged(Bool)
    case updatesAutomaticallyDownloadUpdatesChanged(Bool)
  }

  enum Tab: String, CaseIterable, Equatable, Hashable, Identifiable {
    case general
    case codingAgents
    case updates
    case about

    var id: String {
      rawValue
    }

    var symbol: String {
      switch self {
      case .codingAgents:
        "terminal"
      case .general:
        "slider.horizontal.3"
      case .updates:
        "arrow.trianglehead.clockwise"
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
      case .updates:
        "Updates"
      case .about:
        "About"
      }
    }

    var detail: String {
      switch self {
      case .codingAgents:
        "Claude and Codex hook integration"
      case .general:
        "Appearance and preferences"
      case .updates:
        "Channel and automatic update preferences"
      case .about:
        "Build, engine, and links"
      }
    }
  }

  @Dependency(ClaudeSettingsClient.self) var claudeSettingsClient
  @Dependency(CodexSettingsClient.self) var codexSettingsClient
  @Dependency(UpdateClient.self) var updateClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .task:
        @Shared(.appPrefs) var appPrefs = .default
        return .send(.settingsLoaded(appPrefs))

      case .settingsLoaded(let appPrefs):
        state.appearanceMode = appPrefs.appearanceMode
        state.updateChannel = appPrefs.updateChannel
        state.updatesAutomaticallyCheckForUpdates = appPrefs.updatesAutomaticallyCheckForUpdates
        state.updatesAutomaticallyDownloadUpdates = appPrefs.updatesAutomaticallyDownloadUpdates
        return .none

      case .appearanceModeSelected(let appearanceMode):
        state.appearanceMode = appearanceMode
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

      case .checkForUpdatesButtonTapped:
        return .run { [updateClient] _ in
          await updateClient.perform(.checkForUpdates)
        }

      case .tabSelected(let tab):
        state.selectedTab = tab
        return .none

      case .updateChannelSelected(let updateChannel):
        state.updateChannel = updateChannel
        return persist(state, applyUpdateSettings: true)

      case .updatesAutomaticallyCheckForUpdatesChanged(let isEnabled):
        state.updatesAutomaticallyCheckForUpdates = isEnabled
        if !isEnabled {
          state.updatesAutomaticallyDownloadUpdates = false
        }
        return persist(state, applyUpdateSettings: true)

      case .updatesAutomaticallyDownloadUpdatesChanged(let isEnabled):
        guard state.updatesAutomaticallyCheckForUpdates else {
          return .none
        }
        state.updatesAutomaticallyDownloadUpdates = isEnabled
        return persist(state, applyUpdateSettings: true)
      }
    }
  }

  private func persist(
    _ state: State,
    applyUpdateSettings: Bool = false
  ) -> Effect<Action> {
    let appPrefs = AppPrefs(
      appearanceMode: state.appearanceMode,
      updateChannel: state.updateChannel,
      updatesAutomaticallyCheckForUpdates: state.updatesAutomaticallyCheckForUpdates,
      updatesAutomaticallyDownloadUpdates: state.updatesAutomaticallyDownloadUpdates
    )
    @Shared(.appPrefs) var sharedAppPrefs = .default
    $sharedAppPrefs.withLock {
      $0 = appPrefs
    }
    guard applyUpdateSettings else {
      return .none
    }
    return .run { [updateClient, updateSettings = appPrefs.updateSettings] _ in
      await updateClient.applySettings(updateSettings)
    }
  }
}
