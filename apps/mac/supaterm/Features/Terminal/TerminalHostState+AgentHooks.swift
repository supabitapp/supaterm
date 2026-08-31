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
      return SupatermAgentHookCandidate(
        context: SupatermCLIContext(surfaceID: surface.id, tabID: tabID.rawValue),
        processID: observation.processIdentity.processID,
        processStartTimeMicroseconds: observation.processIdentity.startTimeMicroseconds,
        sessionIDMatchesTitle: Self.agentHookSessionIDMatchesTitle(
          sessionID,
          rawTitle: surface.rawTitle
        ),
        workingDirectoryMatches: codexAgentHookWorkingDirectoryMatches(
          requestedWorkspace: requestedWorkspace,
          processIdentity: observation.processIdentity,
          terminalWorkingDirectoryPath: surface.bridge.state.pwd
        ),
        ownedSessionID: ownedSessionID
      )
    }
    .sorted { $0.context.surfaceID.uuidString < $1.context.surfaceID.uuidString }
  }

  func hasLiveCodexDetection(
    processID: Int32,
    processStartTimeMicroseconds: UInt64,
    for surfaceID: UUID
  ) -> Bool {
    let processIdentity = TerminalAgentProcessIdentity(
      processID: processID,
      startTimeMicroseconds: processStartTimeMicroseconds
    )
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

func codexAgentHookWorkingDirectoryMatches(
  requestedWorkspace: TerminalAgentPanelWorkspaceKey,
  processIdentity: TerminalAgentProcessIdentity,
  terminalWorkingDirectoryPath: String?
) -> Bool {
  let processWorkingDirectoryPath = TerminalAgentProcessInspector.workingDirectoryPath(
    for: processIdentity
  )
  let effectiveWorkingDirectoryPath = codexAgentHookWorkingDirectoryPath(
    processWorkingDirectoryPath: processWorkingDirectoryPath,
    commandLineArguments: TerminalAgentProcessInspector.commandLineArguments(
      for: processIdentity
    ) ?? [],
    terminalWorkingDirectoryPath: terminalWorkingDirectoryPath
  )
  return TerminalAgentPanelWorkspaceKey(
    workingDirectoryPath: effectiveWorkingDirectoryPath
  ) == requestedWorkspace
}

func codexAgentHookWorkingDirectoryPath(
  processWorkingDirectoryPath: String?,
  commandLineArguments: [String],
  terminalWorkingDirectoryPath: String?
) -> String? {
  TerminalAgentLaunchOptions.codexWorkingDirectoryPath(
    processWorkingDirectoryPath: processWorkingDirectoryPath ?? terminalWorkingDirectoryPath,
    commandLineArguments: commandLineArguments
  )
}
