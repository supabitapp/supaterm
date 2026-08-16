import ComposableArchitecture
import Foundation
import SupatermCLIShared

extension SettingsFeature {
  func reduceCodingAgents(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .agentIntegrationStatusRefreshRequested(let agent):
      return refreshAgentIntegrationStatus(&state, agent: agent)

    case .agentIntegrationStatusRefreshed(let agent, let result):
      return handleAgentIntegrationStatusRefresh(&state, agent: agent, result: result)

    case .agentIntegrationToggled(let agent, let isEnabled):
      return toggleAgentIntegration(&state, agent: agent, isEnabled: isEnabled)

    case .agentIntegrationToggleFinished(let agent, let result):
      return handleAgentIntegrationToggleFinished(&state, agent: agent, result: result)

    default:
      return .none
    }
  }

  func refreshAgentIntegrationStatus(
    _ state: inout State,
    agent: SupatermAgentKind
  ) -> Effect<Action> {
    let keyPath = agentIntegrationKeyPath(for: agent)
    guard state[keyPath: keyPath].operation == .idle else {
      return .none
    }
    state[keyPath: keyPath].operation = .refreshing
    let loadHealth = loadAgentIntegrationHealthOperation(for: agent)
    return .run { send in
      do {
        await send(.agentIntegrationStatusRefreshed(agent, .success(try await loadHealth())))
      } catch is CancellationError {
        return
      } catch {
        await send(.agentIntegrationStatusRefreshed(agent, .failure(error.localizedDescription)))
      }
    }
    .cancellable(id: SettingsFeatureCancelID.agentIntegration(agent.rawValue), cancelInFlight: true)
  }

  func handleAgentIntegrationStatusRefresh(
    _ state: inout State,
    agent: SupatermAgentKind,
    result: SettingsAgentIntegrationResult
  ) -> Effect<Action> {
    let keyPath = agentIntegrationKeyPath(for: agent)
    guard state[keyPath: keyPath].operation == .refreshing else { return .none }
    switch result {
    case .failure(let message):
      state[keyPath: keyPath].errorMessage = message
    case .success(let health):
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].health = health
    }
    state[keyPath: keyPath].operation = .idle
    return .none
  }

  func toggleAgentIntegration(
    _ state: inout State,
    agent: SupatermAgentKind,
    isEnabled: Bool
  ) -> Effect<Action> {
    let keyPath = agentIntegrationKeyPath(for: agent)
    guard state[keyPath: keyPath].operation == .idle else {
      return .none
    }
    state.agentIntegrationInstallFailure = nil
    state[keyPath: keyPath].errorMessage = nil
    state[keyPath: keyPath].operation = .settingEnabled(isEnabled)
    let loadHealth = loadAgentIntegrationHealthOperation(for: agent)
    let updateHealth = updateSupatermIntegrationOperation(for: agent, isEnabled: isEnabled)
    return .run { send in
      do {
        if isEnabled, [.unavailable, .unavailableInstalled].contains(try await loadHealth()) {
          await send(.agentIntegrationToggleFinished(agent, .success(.unavailable)))
          return
        }
        await send(.agentIntegrationToggleFinished(agent, .success(try await updateHealth())))
      } catch is CancellationError {
        return
      } catch {
        await send(.agentIntegrationToggleFinished(agent, .failure(error.localizedDescription)))
      }
    }
    .cancellable(id: SettingsFeatureCancelID.agentIntegration(agent.rawValue), cancelInFlight: true)
  }

  func handleAgentIntegrationToggleFinished(
    _ state: inout State,
    agent: SupatermAgentKind,
    result: SettingsAgentIntegrationResult
  ) -> Effect<Action> {
    let keyPath = agentIntegrationKeyPath(for: agent)
    guard case .settingEnabled(let wasEnabling) = state[keyPath: keyPath].operation else {
      return .none
    }
    state[keyPath: keyPath].operation = .idle
    switch result {
    case .success(let health):
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].health = health
    case .failure(let message):
      state[keyPath: keyPath].errorMessage = message
      if wasEnabling {
        state.agentIntegrationInstallFailure = SettingsAgentIntegrationInstallFailure(agent: agent, log: message)
      }
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
