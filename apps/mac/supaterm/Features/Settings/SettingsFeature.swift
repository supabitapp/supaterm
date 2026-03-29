import ComposableArchitecture
import Foundation

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
    var claudeHooksInstallState = SettingsAgentHooksInstallState.idle
    var codexHooksInstallState = SettingsAgentHooksInstallState.idle
    var selectedTab = Tab.general
  }

  enum Action: Equatable {
    case claudeHooksInstallButtonTapped
    case claudeHooksInstallFinished(SettingsAgentHooksInstallResult)
    case codexHooksInstallButtonTapped
    case codexHooksInstallFinished(SettingsAgentHooksInstallResult)
    case tabSelected(Tab)
  }

  enum Tab: String, CaseIterable, Equatable, Hashable {
    case general
    case codingAgents
    case updates
    case about

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
        "Install Claude and Codex hooks"
      case .general:
        "Startup, chrome, and behavior"
      case .updates:
        "Release flow and delivery"
      case .about:
        "Build, engine, and links"
      }
    }
  }

  @Dependency(ClaudeSettingsClient.self) var claudeSettingsClient
  @Dependency(CodexSettingsClient.self) var codexSettingsClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
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

      case .tabSelected(let tab):
        state.selectedTab = tab
        return .none
      }
    }
  }
}
