import SupatermCLIShared

extension TerminalHostState {
  func agentHookCandidates(
    agent: SupatermAgentKind,
    sessionID: String,
    workingDirectoryPath: String,
    processID: Int32?,
    processTree: TerminalAgentProcessTreeSnapshot
  ) -> [SupatermAgentHookCandidate] {
    guard
      let workspace = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: workingDirectoryPath
      )
    else {
      return []
    }
    let identity = AgentDetectionAgentIdentity(agent)
    return surfaces.values.compactMap { surface in
      guard let tabID = tabID(containing: surface.id) else { return nil }
      let observation = agentDetectionStore.observation(for: surface.id).flatMap {
        $0.agent == identity ? $0 : nil
      }
      let paneProcessIdentity = surface.processIdentity
      let foregroundProcessMatch = Self.agentHookProcessMatch(
        processTree.isRelated(
          processID: processID,
          foregroundProcessGroupID: paneProcessIdentity.foregroundProcessGroupID
        )
      )
      let sessionIDMatchesTitle = Self.agentHookSessionIDMatchesTitle(
        sessionID,
        rawTitle: surface.rawTitle,
        ownedSessionID: agentStateStore.foregroundSessionID(for: surface.id, agent: agent)
      )
      guard observation != nil || foregroundProcessMatch == .matching || sessionIDMatchesTitle else {
        return nil
      }
      let candidateProcessIdentity = agentHookCandidateProcessIdentity(
        foregroundProcessMatch: foregroundProcessMatch,
        emitterProcessIdentity: processTree.identity(for: processID),
        observedProcessIdentity: observation?.processIdentity,
        foregroundProcessIdentity: processTree.identity(
          foregroundProcessGroupID: paneProcessIdentity.foregroundProcessGroupID
        )
      )
      guard let candidateProcessIdentity else { return nil }
      let workingDirectoryMatch = agentHookWorkingDirectoryMatch(
        workspace: workspace,
        processWorkingDirectoryPath: TerminalAgentProcessInspector.codexWorkingDirectoryPath(
          for: candidateProcessIdentity
        ),
        terminalWorkingDirectoryPath: surface.bridge.state.pwd
      )
      return SupatermAgentHookCandidate(
        context: SupatermCLIContext(surfaceID: surface.id, tabID: tabID.rawValue),
        processID: candidateProcessIdentity.processID,
        sessionIDMatchesTitle: sessionIDMatchesTitle,
        processMatch: Self.agentHookProcessMatch(
          processTree.isRelated(
            processID: processID,
            candidate: candidateProcessIdentity
          )
        ),
        workingDirectoryMatch: workingDirectoryMatch
      )
    }
  }

  private static func agentHookSessionIDMatchesTitle(
    _ sessionID: String,
    rawTitle: String?,
    ownedSessionID: String?
  ) -> Bool {
    guard ownedSessionID == nil || ownedSessionID == sessionID else { return false }
    return rawTitle == sessionID || rawTitle?.hasPrefix("\(sessionID) | ") == true
  }

  private static func agentHookProcessMatch(
    _ isRelated: Bool?
  ) -> SupatermAgentHookProcessMatch {
    switch isRelated {
    case true: .matching
    case false: .different
    case nil: .unknown
    }
  }
}

func agentHookWorkingDirectoryMatch(
  workspace: TerminalAgentPanelWorkspaceKey,
  processWorkingDirectoryPath: String?,
  terminalWorkingDirectoryPath: String?
) -> SupatermAgentHookWorkingDirectoryMatch {
  let candidateWorkspace =
    TerminalAgentPanelWorkspaceKey(
      workingDirectoryPath: processWorkingDirectoryPath
    ) ?? TerminalAgentPanelWorkspaceKey(workingDirectoryPath: terminalWorkingDirectoryPath)
  guard let candidateWorkspace else { return .unknown }
  return candidateWorkspace == workspace ? .exact : .different
}

func agentHookCandidateProcessIdentity(
  foregroundProcessMatch: SupatermAgentHookProcessMatch,
  emitterProcessIdentity: TerminalAgentProcessIdentity?,
  observedProcessIdentity: TerminalAgentProcessIdentity?,
  foregroundProcessIdentity: TerminalAgentProcessIdentity?
) -> TerminalAgentProcessIdentity? {
  observedProcessIdentity
    ?? foregroundProcessIdentity
    ?? (foregroundProcessMatch == .matching ? emitterProcessIdentity : nil)
}
