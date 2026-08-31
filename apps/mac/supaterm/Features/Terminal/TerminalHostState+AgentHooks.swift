import Foundation
import SupatermCLIShared

extension TerminalHostState {
  func agentHookCandidates(
    sessionID: String,
    workingDirectoryPath: String
  ) -> [SupatermAgentHookCandidate] {
    guard
      let requestedWorkspace = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: workingDirectoryPath
      )
    else {
      return []
    }
    let codex = AgentDetectionAgentIdentity(SupatermAgentKind.codex)
    return surfaces.values.compactMap { surface in
      guard
        let tabID = tabID(containing: surface.id),
        let observation = agentDetectionStore.observation(for: surface.id),
        observation.agent == codex,
        TerminalAgentProcessInspector.isCurrent(observation.processIdentity)
      else {
        return nil
      }
      let ownedSessionID = agentStateStore.foregroundSessionID(
        for: surface.id,
        agent: .codex
      )
      let ownedSessionMatchesProcess =
        ownedSessionID.map {
          agentStateStore.sessionContainsProcessIdentity(
            agent: .codex,
            sessionID: $0,
            processIdentity: observation.processIdentity
          )
        } == true
      let commandLineArguments =
        TerminalAgentProcessInspector.commandLineArguments(
          for: observation.processIdentity
        ) ?? []
      let invocation = TerminalAgentLaunchOptions.codexInvocation(
        processWorkingDirectoryPath: TerminalAgentProcessInspector.workingDirectoryPath(
          for: observation.processIdentity
        ) ?? surface.bridge.state.pwd,
        commandLineArguments: commandLineArguments
      )
      return SupatermAgentHookCandidate(
        context: SupatermCLIContext(surfaceID: surface.id, tabID: tabID.rawValue),
        processIdentity: observation.processIdentity,
        forkParentSessionID: invocation.forkParentSessionID,
        ownedSessionMatchesProcess: ownedSessionMatchesProcess,
        sessionIDMatchesTitle: Self.agentHookSessionIDMatchesTitle(
          sessionID,
          rawTitle: surface.rawTitle
        ),
        workingDirectoryMatches: TerminalAgentPanelWorkspaceKey(
          workingDirectoryPath: invocation.effectiveWorkingDirectoryPath
        ) == requestedWorkspace,
        ownedSessionID: ownedSessionID
      )
    }
    .sorted { $0.context.surfaceID.uuidString < $1.context.surfaceID.uuidString }
  }

  func hasLiveCodexDetection(
    _ processIdentity: SupatermAgentProcessIdentity,
    for surfaceID: UUID
  ) -> Bool {
    guard
      let observation = agentDetectionStore.observation(for: surfaceID),
      observation.agent == AgentDetectionAgentIdentity(SupatermAgentKind.codex),
      observation.processIdentity == processIdentity
    else {
      return false
    }
    return TerminalAgentProcessInspector.isCurrent(processIdentity)
  }

  private static func agentHookSessionIDMatchesTitle(
    _ sessionID: String,
    rawTitle: String?
  ) -> Bool {
    guard let rawTitle else { return false }
    let renderedSessionID = codexTerminalTitleSessionID(sessionID)
    return rawTitle.split(whereSeparator: { $0.isWhitespace }).contains {
      $0 == sessionID || $0 == renderedSessionID
    }
  }

  private static func codexTerminalTitleSessionID(_ sessionID: String) -> String {
    guard sessionID.count > 32 else { return sessionID }
    return "\(sessionID.prefix(29))..."
  }
}
