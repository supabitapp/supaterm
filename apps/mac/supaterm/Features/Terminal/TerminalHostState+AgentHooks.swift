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
      return SupatermAgentHookCandidate(
        context: SupatermCLIContext(surfaceID: surface.id, tabID: tabID.rawValue),
        processIdentity: SupatermAgentProcessIdentity(
          processID: observation.processIdentity.processID,
          startTimeMicroseconds: observation.processIdentity.startTimeMicroseconds
        ),
        forkParentSessionID: TerminalAgentLaunchOptions.codexForkParentSessionID(
          commandLineArguments: commandLineArguments
        ),
        ownedSessionMatchesProcess: ownedSessionMatchesProcess,
        sessionIDMatchesTitle: Self.agentHookSessionIDMatchesTitle(
          sessionID,
          rawTitle: surface.rawTitle
        ),
        workingDirectoryMatches: codexAgentHookWorkingDirectoryMatches(
          requestedWorkspace: requestedWorkspace,
          processIdentity: observation.processIdentity,
          commandLineArguments: commandLineArguments,
          terminalWorkingDirectoryPath: surface.bridge.state.pwd
        ),
        ownedSessionID: ownedSessionID
      )
    }
    .sorted { $0.context.surfaceID.uuidString < $1.context.surfaceID.uuidString }
  }

  func hasLiveCodexDetection(
    _ processIdentity: SupatermAgentProcessIdentity,
    for surfaceID: UUID
  ) -> Bool {
    let terminalProcessIdentity = TerminalAgentProcessIdentity(
      processID: processIdentity.processID,
      startTimeMicroseconds: processIdentity.startTimeMicroseconds
    )
    guard
      let observation = agentDetectionStore.observation(for: surfaceID),
      observation.agent == AgentDetectionAgentIdentity(SupatermAgentKind.codex),
      observation.processIdentity == terminalProcessIdentity
    else {
      return false
    }
    return TerminalAgentProcessInspector.isCurrent(terminalProcessIdentity)
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
  commandLineArguments: [String],
  terminalWorkingDirectoryPath: String?
) -> Bool {
  let processWorkingDirectoryPath = TerminalAgentProcessInspector.workingDirectoryPath(
    for: processIdentity
  )
  let effectiveWorkingDirectoryPath = codexAgentHookWorkingDirectoryPath(
    processWorkingDirectoryPath: processWorkingDirectoryPath,
    commandLineArguments: commandLineArguments,
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
