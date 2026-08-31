import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentEventTranslator {
  static func events(for request: SupatermAgentHookRequest) -> [TerminalAgentEvent] {
    guard let scope = scope(for: request) else { return [] }
    switch request.agent {
    case .claude:
      guard request.event.hookEventName == .sessionStart, scope.subagentID == nil else { return [] }
      return [event(request, scope: scope, action: .sessionStarted)]
    case .codex:
      guard let sessionStart = request.codexRootSessionStart,
        request.inheritedSessionID == nil || request.inheritedSessionID == sessionStart.sessionID
      else {
        return []
      }
      return [event(request, scope: scope, action: .sessionStarted)]
    case .pi:
      return piEvents(for: request, scope: scope)
    }
  }

  private static func piEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    let action: TerminalAgentEvent.Action
    switch request.event.hookEventName {
    case .nativeSessionStart:
      action = request.event.source == "compact" ? .sessionResumed : .sessionStarted
    case .agentStart:
      action = .turnStarted
    case .agentEnd:
      switch request.event.stopReason {
      case "aborted", "error", "length":
        action = .attentionRequested(requestID: nil, message: request.event.message)
      default:
        action = .turnCompleted(message: request.event.message)
      }
    case .sessionShutdown:
      action = .sessionEnded
    default:
      return []
    }
    return [event(request, scope: scope, action: action)]
  }

  private static func event(
    _ request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope,
    action: TerminalAgentEvent.Action
  ) -> TerminalAgentEvent {
    TerminalAgentEvent(
      scope: scope,
      context: request.context,
      process: request.process,
      workingDirectoryPath: request.event.cwd,
      action: action
    )
  }

  private static func scope(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentEvent.Scope? {
    guard let sessionID = request.event.sessionID else { return nil }
    return TerminalAgentEvent.Scope(
      agent: request.agent,
      sessionID: sessionID,
      turnID: request.event.turnID,
      subagentID: request.event.agentID
    )
  }
}
