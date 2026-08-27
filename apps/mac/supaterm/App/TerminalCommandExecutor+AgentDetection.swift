import Foundation
import SupatermCLIShared
import SupatermSupport

extension TerminalCommandExecutor {
  func agentDetectionReload() async throws -> SupatermAgentDetectionReloadResult {
    guard let agentDetectionRuleRepository else {
      throw AgentDetectionCommandError.unavailable
    }
    guard let overrideDirectory = await agentDetectionRuleRepository.overrideDirectoryPath() else {
      throw AgentDetectionCommandError.localOverridesDisabled
    }
    let snapshot = try await agentDetectionRuleRepository.reload()
    return SupatermAgentDetectionReloadResult(
      generation: snapshot.generation,
      overrideDirectory: overrideDirectory,
      manifests: snapshot.manifests.map(\.socketInfo)
    )
  }
}

extension AgentDetectionManifestSnapshot {
  var socketInfo: SupatermAgentDetectionManifestInfo {
    SupatermAgentDetectionManifestInfo(
      agentID: agent.id,
      displayName: agent.displayName,
      version: version,
      origin: source.origin == .local ? .local : .bundled,
      path: source.path
    )
  }
}

private enum AgentDetectionCommandError: LocalizedError {
  case unavailable
  case localOverridesDisabled

  var errorDescription: String? {
    switch self {
    case .unavailable:
      "Agent detection is unavailable."
    case .localOverridesDisabled:
      "This Supaterm instance does not have a local agent detection directory."
    }
  }
}
