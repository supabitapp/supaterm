import Foundation
import SupatermCLIShared

nonisolated struct TerminalAgentEvent: Equatable, Sendable {
  enum Origin: Equatable, Sendable {
    case native
    case transcript
  }

  enum ProgressSource: Equatable, Hashable, Sendable {
    case nativePlan
    case transcript
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
    case hoverMessagesUpdated([String])
    case progressUpdated([PaneAgentProgressRow], source: ProgressSource = .nativePlan)
    case sessionEnded
    case sessionResumed(transcriptPath: String?)
    case sessionStarted(transcriptPath: String?)
    case subagentStarted(nickname: String?, role: String?, transcriptPath: String? = nil)
    case subagentStopped
    case subagentTasksUpdated([String: String])
    case turnCompleted(message: String?)
    case turnRunning(detail: String?)
    case turnStarted
  }

  let scope: Scope
  let context: SupatermCLIContext?
  let processID: Int32?
  let workingDirectoryPath: String?
  let action: Action
  let origin: Origin

  init(
    scope: Scope,
    context: SupatermCLIContext? = nil,
    processID: Int32? = nil,
    workingDirectoryPath: String? = nil,
    action: Action,
    origin: Origin = .native
  ) {
    self.scope = scope
    self.context = context
    self.processID = processID
    self.workingDirectoryPath = workingDirectoryPath
    self.action = action
    self.origin = origin
  }
}

nonisolated struct TerminalAgentEventApplication: Equatable, Sendable {
  let accepted: Bool
  let changed: Bool
}
