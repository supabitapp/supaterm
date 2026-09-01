import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentEventTranslator {
  static func events(for request: SupatermAgentHookRequest) -> [TerminalAgentEvent] {
    guard let scope = scope(for: request) else { return [] }
    switch request.agent {
    case .claude, .codex:
      guard request.event.hookEventName == .sessionStart, scope.subagentID == nil else { return [] }
      return [event(request, scope: scope, action: .sessionStarted)]
    case .pi:
      return []
    }
  }

  private static func event(
    _ request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope,
    action: TerminalAgentEvent.Action
  ) -> TerminalAgentEvent {
    TerminalAgentEvent(
      scope: scope,
      context: request.context,
      processID: request.processID,
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
