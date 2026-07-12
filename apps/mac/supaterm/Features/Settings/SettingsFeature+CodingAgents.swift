import ComposableArchitecture
import Foundation
import SupatermCLIShared

extension SettingsFeature {
  func reduceCodingAgents(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .agentIntegrationStatusRefreshRequested(let agent):
      let keyPath = agentIntegrationKeyPath(for: agent)
      guard !state[keyPath: keyPath].isPending else {
        return .none
      }
      state[keyPath: keyPath].isRefreshing = true
      let loadHealth = loadAgentIntegrationHealthOperation(for: agent)
      return .run { send in
        do {
          await send(.agentIntegrationStatusRefreshed(agent, .success(try await loadHealth())))
        } catch {
          await send(.agentIntegrationStatusRefreshed(agent, .failure(error.localizedDescription)))
        }
      }

    case .agentIntegrationStatusRefreshed(let agent, .success(let health)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].health = health
      state[keyPath: keyPath].isRefreshing = false
      return .none

    case .agentIntegrationStatusRefreshed(let agent, .failure(let message)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].errorMessage = message
      state[keyPath: keyPath].isRefreshing = false
      return .none

    case .agentIntegrationToggled(let agent, let isEnabled):
      let keyPath = agentIntegrationKeyPath(for: agent)
      guard !state[keyPath: keyPath].isPending else {
        return .none
      }
      state.agentIntegrationInstallFailure = nil
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].pendingEnabled = isEnabled
      let loadHealth = loadAgentIntegrationHealthOperation(for: agent)
      let updateHealth = updateSupatermIntegrationOperation(for: agent, isEnabled: isEnabled)
      return .run { send in
        do {
          if isEnabled, [.unavailable, .unavailableInstalled].contains(try await loadHealth()) {
            await send(.agentIntegrationToggleFinished(agent, .success(.unavailable)))
            return
          }
          await send(.agentIntegrationToggleFinished(agent, .success(try await updateHealth())))
        } catch {
          await send(.agentIntegrationToggleFinished(agent, .failure(error.localizedDescription)))
        }
      }

    case .agentIntegrationToggleFinished(let agent, .success(let health)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].health = health
      state[keyPath: keyPath].pendingEnabled = nil
      return .none

    case .agentIntegrationToggleFinished(let agent, .failure(let message)):
      return handleAgentIntegrationToggleFailure(&state, agent: agent, message: message)

    default:
      return .none
    }
  }

  func handleAgentIntegrationToggleFailure(
    _ state: inout State,
    agent: SupatermAgentKind,
    message: String
  ) -> Effect<Action> {
    let keyPath = agentIntegrationKeyPath(for: agent)
    let isInstallFailure =
      state[keyPath: keyPath].pendingEnabled
      ?? (state[keyPath: keyPath].health == .healthy)
    state[keyPath: keyPath].errorMessage = message
    state[keyPath: keyPath].pendingEnabled = nil
    if isInstallFailure {
      state.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(agent: agent, log: message)
    }
    return .none
  }

  func agentIntegrationKeyPath(
    for agent: SupatermAgentKind
  ) -> WritableKeyPath<State, SettingsAgentIntegrationState> {
    switch agent {
    case .claude:
      return \.claudeIntegration
    case .codex:
      return \.codexIntegration
    case .pi:
      return \.piIntegration
    }
  }

  func loadAgentIntegrationHealthOperation(
    for agent: SupatermAgentKind
  ) -> @Sendable () async throws -> CodingAgentIntegrationHealth {
    switch agent {
    case .claude:
      let client = claudeSettingsClient
      return { try await client.integrationHealth() }
    case .codex:
      let client = codexSettingsClient
      return { try await client.integrationHealth() }
    case .pi:
      let client = piSettingsClient
      return { try await client.integrationHealth() }
    }
  }

  func updateSupatermIntegrationOperation(
    for agent: SupatermAgentKind,
    isEnabled: Bool
  ) -> @Sendable () async throws -> CodingAgentIntegrationHealth {
    switch agent {
    case .claude:
      let client = claudeSettingsClient
      let skillClient = supatermSkillClient
      return {
        if isEnabled {
          try await skillClient.installSupatermSkill()
          try await client.installSupatermHooks()
        } else {
          try await client.removeSupatermHooks()
        }
        return try await client.integrationHealth()
      }
    case .codex:
      let client = codexSettingsClient
      let skillClient = supatermSkillClient
      return {
        if isEnabled {
          try await skillClient.installSupatermSkill()
          try await client.installSupatermHooks()
        } else {
          try await client.removeSupatermHooks()
        }
        return try await client.integrationHealth()
      }
    case .pi:
      let client = piSettingsClient
      let skillClient = supatermSkillClient
      return {
        if isEnabled {
          try await skillClient.installSupatermSkill()
          try await client.installSupatermIntegration()
        } else {
          try await client.removeSupatermIntegration()
        }
        return try await client.integrationHealth()
      }
    }
  }

}
