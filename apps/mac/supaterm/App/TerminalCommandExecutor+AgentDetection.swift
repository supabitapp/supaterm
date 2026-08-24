import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

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

  func agentDetectionExplain(
    _ target: TerminalPaneTarget
  ) async throws -> SupatermAgentDetectionExplainResult {
    let resolved = try executeTargeted(
      operation: { entry in
        let pane = try entry.terminal.resolvePaneTarget(target)
        return (
          host: entry.terminal,
          surfaceID: pane.anchorSurface.id,
          target: try entry.terminal.paneTarget(
            spaceID: pane.spaceID,
            tabID: pane.tabID,
            surfaceID: pane.anchorSurface.id,
            tree: pane.tree
          )
        )
      },
      rewrite: { value, windowIndex in
        (
          host: value.host,
          surfaceID: value.surfaceID,
          target: TerminalWindowRegistry.rewrite(value.target, windowIndex: windowIndex)
        )
      }
    )
    let explanation = await resolved.host.detailedAgentDetectionExplanation(
      for: resolved.surfaceID
    )
    return resolved.host.debugAgentDetectionExplainResult(
      target: resolved.target,
      explanation: explanation
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
