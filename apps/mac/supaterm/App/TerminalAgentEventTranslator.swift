import Foundation
import SupatermCLIShared

nonisolated enum TerminalAgentEventTranslator {
  static func events(for request: SupatermAgentHookRequest) -> [TerminalAgentEvent] {
    guard let scope = scope(for: request) else { return [] }
    if scope.subagentID != nil {
      switch request.event.hookEventName {
      case .subagentStart:
        return [
          event(
            request,
            scope: scope,
            action: .subagentStarted(type: request.event.agentType)
          )
        ]
      case .subagentStop:
        return [event(request, scope: scope, action: .subagentStopped)]
      default:
        break
      }
    }
    let translated =
      switch request.agent {
      case .claude:
        claudeEvents(for: request, scope: scope)
      case .codex:
        codexEvents(for: request, scope: scope)
      case .pi:
        piEvents(for: request, scope: scope)
      }
    return translated
  }

  private static let actionableClaudeNotifications: Set<String> = [
    "elicitation_dialog",
    "idle_prompt",
    "permission_prompt",
  ]

  private static func claudeEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    let action: TerminalAgentEvent.Action
    switch request.event.hookEventName {
    case .notification:
      guard let type = request.event.notificationType,
        actionableClaudeNotifications.contains(type)
      else {
        return []
      }
      action = .attentionRequested(
        requestID: attentionRequestID(for: request),
        message: request.event.message
      )
    case .postToolUse:
      return attentionResolutionEvents(for: request, scope: scope) + [
        event(
          request,
          scope: scope,
          action: .turnRunning(detail: request.event.toolName)
        )
      ]
    case .preToolUse:
      action = .turnRunning(detail: request.event.toolName)
    case .sessionEnd:
      action = .sessionEnded
    case .sessionStart:
      action = sessionAction(for: request)
    case .stop:
      action = .turnCompleted(message: request.event.lastAssistantMessage)
    case .userPromptSubmit:
      action = .turnStarted
    default:
      return []
    }
    return [event(request, scope: scope, action: action)]
  }

  private static func codexEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    if request.event.hookEventName == .permissionRequest {
      return [
        event(
          request,
          scope: scope,
          action: .attentionRequested(
            requestID: attentionRequestID(for: request),
            message: request.event.toolName.map { "\($0) requires approval" }
          )
        )
      ]
    }
    if request.event.hookEventName == .preToolUse,
      request.event.toolName == "request_user_input"
    {
      return [
        event(
          request,
          scope: scope,
          action: .attentionRequested(
            requestID: attentionRequestID(for: request),
            message: userQuestion(from: request.event.toolInput)
          )
        )
      ]
    }
    if request.event.hookEventName == .postToolUse,
      request.event.toolName == "request_user_input"
    {
      return attentionResolutionEvents(for: request, scope: scope)
    }
    if request.event.hookEventName == .postToolUse,
      request.event.toolName == "update_plan",
      let rows = codexPlanRows(from: request.event.toolInput)
    {
      return [event(request, scope: scope, action: .progressUpdated(rows))]
    }
    if request.event.hookEventName == .postToolUse {
      return attentionResolutionEvents(for: request, scope: scope) + [
        event(
          request,
          scope: scope,
          action: .turnRunning(detail: request.event.toolName)
        )
      ]
    }
    let action: TerminalAgentEvent.Action
    switch request.event.hookEventName {
    case .notification:
      action = .attentionRequested(
        requestID: attentionRequestID(for: request),
        message: request.event.message
      )
    case .preToolUse:
      action = .turnRunning(detail: request.event.toolName)
    case .sessionEnd:
      action = .sessionEnded
    case .sessionStart:
      action = sessionAction(for: request)
    case .stop:
      action = .turnCompleted(message: request.event.lastAssistantMessage)
    case .userPromptSubmit:
      action = .turnStarted
    default:
      return []
    }
    return [event(request, scope: scope, action: action)]
  }

  private static func piEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    let action: TerminalAgentEvent.Action
    switch request.event.hookEventName {
    case .nativeSessionStart:
      action = sessionAction(for: request)
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
      processID: request.processID,
      action: action
    )
  }

  private static func sessionAction(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentEvent.Action {
    if request.event.source == "compact" {
      return .sessionResumed(transcriptPath: request.event.transcriptPath)
    }
    return .sessionStarted(transcriptPath: request.event.transcriptPath)
  }

  private static func attentionRequestID(
    for request: SupatermAgentHookRequest
  ) -> String? {
    request.event.toolUseID.map { "id:\($0)" }
      ?? request.event.toolName.map { "tool:\($0)" }
  }

  private static func attentionResolutionEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    let requestIDs = [
      request.event.toolUseID.map { "id:\($0)" },
      request.event.toolName.map { "tool:\($0)" },
    ].compactMap(\.self)
    let resolvedRequestIDs = requestIDs.isEmpty ? [nil] : requestIDs.map(Optional.some)
    return resolvedRequestIDs.map { requestID in
      event(
        request,
        scope: scope,
        action: .attentionResolved(requestID: requestID)
      )
    }
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

  private static func codexPlanRows(
    from input: JSONValue?
  ) -> [PaneAgentProgressRow]? {
    guard let plan = input?.objectValue?["plan"]?.arrayValue else { return nil }
    var rows: [PaneAgentProgressRow] = []
    rows.reserveCapacity(plan.count)
    for (index, value) in plan.enumerated() {
      guard let item = value.objectValue,
        let title = normalized(item["step"]?.stringValue),
        let status = codexPlanStatus(item["status"]?.stringValue)
      else {
        return nil
      }
      rows.append(
        PaneAgentProgressRow(
          id: "\(index):\(title)",
          title: title,
          status: status
        )
      )
    }
    return rows
  }

  private static func userQuestion(from input: JSONValue?) -> String? {
    guard let questions = input?.objectValue?["questions"]?.arrayValue else { return nil }
    for question in questions {
      if let value = normalized(question.objectValue?["question"]?.stringValue) {
        return value
      }
    }
    return nil
  }

  private static func codexPlanStatus(
    _ value: String?
  ) -> PaneAgentProgressRow.Status? {
    switch value {
    case "completed": .completed
    case "in_progress": .running
    case "pending": .pending
    default: nil
    }
  }

  private static func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized =
      value
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
    return normalized.isEmpty ? nil : normalized
  }
}
