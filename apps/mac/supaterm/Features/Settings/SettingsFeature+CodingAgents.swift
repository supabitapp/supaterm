import ComposableArchitecture
import Foundation

extension SettingsFeature {
  func reduceCodingAgents(_ state: inout State, action: Action) -> Effect<Action> {
    switch action {
    case .agentIntegrationStatusRefreshRequested(let agent):
      let keyPath = agentIntegrationKeyPath(for: agent)
      guard !state[keyPath: keyPath].isPending else {
        return .none
      }
      state[keyPath: keyPath].isPending = true
      let checkAvailability = loadAgentAvailabilityOperation(for: agent)
      let loadStatus = loadSupatermIntegrationOperation(for: agent)
      return .run { send in
        do {
          guard try await checkAvailability() else {
            await send(
              .agentIntegrationStatusRefreshed(
                agent,
                .unavailable(unavailableMessage(for: agent))
              )
            )
            return
          }
          await send(.agentIntegrationStatusRefreshed(agent, .success(try await loadStatus())))
        } catch {
          await send(.agentIntegrationStatusRefreshed(agent, .failure(error.localizedDescription)))
        }
      }

    case .agentIntegrationStatusRefreshed(let agent, .success(let isEnabled)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].confirmedEnabled = isEnabled
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].isAvailable = true
      state[keyPath: keyPath].isEnabled = isEnabled
      state[keyPath: keyPath].isPending = false
      return .none

    case .agentIntegrationStatusRefreshed(let agent, .unavailable(let message)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].confirmedEnabled = false
      state[keyPath: keyPath].errorMessage = message
      state[keyPath: keyPath].isAvailable = false
      state[keyPath: keyPath].isEnabled = false
      state[keyPath: keyPath].isPending = false
      return .none

    case .agentIntegrationStatusRefreshed(let agent, .failure(let message)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].errorMessage = message
      state[keyPath: keyPath].isAvailable = true
      state[keyPath: keyPath].isEnabled = state[keyPath: keyPath].confirmedEnabled
      state[keyPath: keyPath].isPending = false
      return .none

    case .agentIntegrationToggled(let agent, let isEnabled):
      let keyPath = agentIntegrationKeyPath(for: agent)
      guard !state[keyPath: keyPath].isPending else {
        return .none
      }
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].isEnabled = isEnabled
      state[keyPath: keyPath].isPending = true
      let checkAvailability = loadAgentAvailabilityOperation(for: agent)
      let updateStatus = updateSupatermIntegrationOperation(for: agent, isEnabled: isEnabled)
      return .run { send in
        do {
          guard try await checkAvailability() else {
            await send(
              .agentIntegrationToggleFinished(
                agent,
                .unavailable(unavailableMessage(for: agent))
              )
            )
            return
          }
          await send(.agentIntegrationToggleFinished(agent, .success(try await updateStatus())))
        } catch {
          await send(.agentIntegrationToggleFinished(agent, .failure(error.localizedDescription)))
        }
      }

    case .agentIntegrationToggleFinished(let agent, .success(let isEnabled)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].confirmedEnabled = isEnabled
      state[keyPath: keyPath].errorMessage = nil
      state[keyPath: keyPath].isAvailable = true
      state[keyPath: keyPath].isEnabled = isEnabled
      state[keyPath: keyPath].isPending = false
      return .none

    case .agentIntegrationToggleFinished(let agent, .unavailable(let message)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].confirmedEnabled = false
      state[keyPath: keyPath].errorMessage = message
      state[keyPath: keyPath].isAvailable = false
      state[keyPath: keyPath].isEnabled = false
      state[keyPath: keyPath].isPending = false
      return .none

    case .agentIntegrationToggleFinished(let agent, .failure(let message)):
      let keyPath = agentIntegrationKeyPath(for: agent)
      state[keyPath: keyPath].errorMessage = message
      state[keyPath: keyPath].isAvailable = true
      state[keyPath: keyPath].isEnabled = state[keyPath: keyPath].confirmedEnabled
      state[keyPath: keyPath].isPending = false
      return .none

    default:
      return .none
    }
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

  func loadAgentAvailabilityOperation(
    for agent: SupatermAgentKind
  ) -> @Sendable () async throws -> Bool {
    switch agent {
    case .claude, .codex:
      return { true }
    case .pi:
      let client = piSettingsClient
      return { try await client.isPiAvailable() }
    }
  }

  func loadSupatermIntegrationOperation(
    for agent: SupatermAgentKind
  ) -> @Sendable () async throws -> Bool {
    switch agent {
    case .claude:
      let client = claudeSettingsClient
      return { try await client.hasSupatermHooks() }
    case .codex:
      let client = codexSettingsClient
      return { try await client.hasSupatermHooks() }
    case .pi:
      let client = piSettingsClient
      return { try await client.hasSupatermIntegration() }
    }
  }

  func updateSupatermIntegrationOperation(
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
    case .pi:
      let client = piSettingsClient
      return {
        if isEnabled {
          try await client.installSupatermIntegration()
        } else {
          try await client.removeSupatermIntegration()
        }
        return try await client.hasSupatermIntegration()
      }
    }
  }

  func unavailableMessage(
    for agent: SupatermAgentKind
  ) -> String {
    switch agent {
    case .claude, .codex:
      return "\(agent.notificationTitle) is unavailable."
    case .pi:
      return PiSettingsInstallerError.piUnavailable.localizedDescription
    }
  }
}
