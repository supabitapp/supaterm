import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentChildKind: String, Codable, Equatable, Sendable {
  case subagent
  case unknown
  case workflow
}

nonisolated enum TerminalAgentProgressMutation: Equatable, Sendable {
  case remove(id: String)
  case replace([PaneAgentProgressRow])
  case upsert(id: String, title: String?, status: PaneAgentProgressRow.Status?)
}

nonisolated struct TerminalAgentEvent: Equatable, Sendable {
  enum Process: Equatable, Sendable {
    case detected(TerminalAgentProcessIdentity)
    case emitter(Int32)
  }

  struct Scope: Equatable, Hashable, Sendable {
    let agent: SupatermAgentKind
    let sessionID: String
    let turnID: String?
    let subagentID: String?

    init(
      agent: SupatermAgentKind,
      sessionID: String,
      turnID: String? = nil,
      subagentID: String? = nil
    ) {
      self.agent = agent
      self.sessionID = sessionID
      self.turnID = turnID
      self.subagentID = subagentID
    }

    func hash(into hasher: inout Hasher) {
      hasher.combine(agent.rawValue)
      hasher.combine(sessionID)
      hasher.combine(turnID)
      hasher.combine(subagentID)
    }
  }

  enum Action: Equatable, Sendable {
    case attentionRequested(requestID: String?, message: String?)
    case attentionResolved(requestID: String?)
    case progressUpdated(TerminalAgentProgressMutation)
    case sessionEnded
    case sessionResumed
    case sessionStarted
    case subagentStarted(
      kind: TerminalAgentChildKind = .subagent,
      role: String?
    )
    case subagentStopped
    case subagentsReconciled(
      liveSubagentIDs: Set<String>,
      hasActiveTeammate: Bool,
      hasActiveWorkflow: Bool
    )
    case turnCompleted(message: String?)
    case turnContinuesInBackground
    case turnRunning(detail: String?)
    case turnStarted
  }

  let scope: Scope
  let context: SupatermCLIContext?
  let process: Process?
  let workingDirectoryPath: String?
  let action: Action

  init(
    scope: Scope,
    context: SupatermCLIContext? = nil,
    process: Process?,
    workingDirectoryPath: String? = nil,
    action: Action
  ) {
    self.scope = scope
    self.context = context
    self.process = process
    self.workingDirectoryPath = workingDirectoryPath
    self.action = action
  }

  init(
    scope: Scope,
    context: SupatermCLIContext? = nil,
    processID: Int32? = nil,
    workingDirectoryPath: String? = nil,
    action: Action
  ) {
    self.init(
      scope: scope,
      context: context,
      process: processID.map(Process.emitter),
      workingDirectoryPath: workingDirectoryPath,
      action: action
    )
  }
}

nonisolated struct TerminalAgentEventApplication: Equatable, Sendable {
  let accepted: Bool
  let changed: Bool
}
