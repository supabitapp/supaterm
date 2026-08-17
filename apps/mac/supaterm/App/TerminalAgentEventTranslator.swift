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
            action: subagentStartedAction(for: request)
          )
        ]
      case .subagentStop:
        return [
          event(
            request,
            scope: scope,
            action: .subagentStopped
          )
        ]
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

  private static func subagentStartedAction(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentEvent.Action {
    let role = AgentHookText.normalized(request.event.agentType)
    return .subagentStarted(
      kind: childKind(agent: request.agent, role: role),
      nickname: nil,
      role: request.agent == .codex && role?.lowercased() == "default" ? nil : role
    )
  }

  private static func claudeEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    if let mutation = claudeTaskHookMutation(for: request) {
      return [
        event(
          request,
          scope: rootScope(scope),
          action: .progressUpdated(mutation)
        )
      ]
    }
    let action: TerminalAgentEvent.Action
    switch request.event.hookEventName {
    case .notification:
      guard let type = request.event.notificationType,
        SupatermClaudeHookSettings.actionableNotificationTypes.contains(type)
      else {
        return []
      }
      action = .attentionRequested(
        requestID: attentionRequestID(for: request),
        message: request.event.message
      )
    case .postToolUse:
      let resolutionEvents = attentionResolutionEvents(for: request, scope: scope)
      let progressEvents =
        claudeToolProgressMutation(for: request).map {
          [
            event(
              request,
              scope: rootScope(scope),
              action: .progressUpdated($0)
            )
          ]
        } ?? []
      guard scope.subagentID == nil else {
        return resolutionEvents + progressEvents + subagentActivityEvents(for: request, scope: scope)
      }
      if !progressEvents.isEmpty {
        return resolutionEvents + progressEvents
      }
      return resolutionEvents + [
        event(
          request,
          scope: scope,
          action: .turnRunning(detail: request.event.toolName)
        )
      ]
    case .preToolUse:
      guard scope.subagentID == nil else {
        return subagentActivityEvents(for: request, scope: scope)
      }
      action = .turnRunning(detail: request.event.toolName)
    case .sessionEnd:
      action = .sessionEnded
    case .sessionStart:
      action = sessionAction(for: request)
    case .stop:
      let stopAction: TerminalAgentEvent.Action =
        hasActiveClaudeBackgroundWork(request.event)
        ? .turnContinuesInBackground
        : .turnCompleted(message: request.event.lastAssistantMessage)
      guard scope.subagentID == nil,
        let tasks = request.event.payload["background_tasks"]?.arrayValue
      else {
        return [event(request, scope: scope, action: stopAction)]
      }
      let liveSubagentIDs = activeClaudeTasks(tasks, ofType: "subagent")
        .compactMap { $0["id"]?.stringValue }
      return [
        event(
          request,
          scope: scope,
          action: .subagentsReconciled(
            liveSubagentIDs: Set(liveSubagentIDs),
            hasActiveTeammate: !activeClaudeTasks(tasks, ofType: "teammate").isEmpty,
            hasActiveWorkflow: !activeClaudeTasks(tasks, ofType: "workflow").isEmpty
          )
        ),
        event(request, scope: scope, action: stopAction),
      ]
    case .userPromptSubmit:
      action = .turnStarted
    default:
      return []
    }
    return [event(request, scope: scope, action: action)]
  }

  private static func activeClaudeTasks(
    _ tasks: [JSONValue],
    ofType type: String
  ) -> [JSONObject] {
    tasks.compactMap { task in
      guard let task = task.objectValue,
        task["type"]?.stringValue == type,
        let status = task["status"]?.stringValue,
        status == "running" || status == "pending"
      else {
        return nil
      }
      return task
    }
  }

  private static func hasActiveClaudeBackgroundWork(
    _ event: SupatermAgentHookEvent
  ) -> Bool {
    if event.payload["session_crons"]?.arrayValue?.isEmpty == false {
      return true
    }
    return event.payload["background_tasks"]?.arrayValue?.contains {
      guard let status = $0.objectValue?["status"]?.stringValue else { return false }
      return status == "running" || status == "pending"
    } == true
  }

  private static func childKind(
    agent: SupatermAgentKind,
    role: String?
  ) -> TerminalAgentChildKind {
    if role?.lowercased() == "workflow-subagent" {
      return .workflow
    }
    return agent == .codex ? .subagent : .unknown
  }

  private static func subagentActivityEvents(
    for request: SupatermAgentHookRequest,
    scope: TerminalAgentEvent.Scope
  ) -> [TerminalAgentEvent] {
    guard
      let detail = ClaudeToolActivity.detail(
        toolName: request.event.toolName,
        toolInput: request.event.toolInput
      )
    else {
      return []
    }
    return [event(request, scope: scope, action: .turnRunning(detail: detail))]
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
      return [event(request, scope: scope, action: .progressUpdated(.replace(rows)))]
    }
    if request.event.hookEventName == .postToolUse {
      let resolutionEvents = attentionResolutionEvents(for: request, scope: scope)
      guard scope.subagentID == nil else { return resolutionEvents }
      return resolutionEvents + [
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
      guard scope.subagentID == nil else { return [] }
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
      workingDirectoryPath: request.event.cwd,
      action: action
    )
  }

  private static func sessionAction(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentEvent.Action {
    if request.event.source == "compact" {
      return .sessionResumed
    }
    return .sessionStarted
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

  private static func rootScope(
    _ scope: TerminalAgentEvent.Scope
  ) -> TerminalAgentEvent.Scope {
    TerminalAgentEvent.Scope(
      agent: scope.agent,
      sessionID: scope.sessionID,
      turnID: scope.turnID
    )
  }

  private static func claudeToolProgressMutation(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentProgressMutation? {
    switch request.event.toolName {
    case "TaskCreate":
      guard let input = request.event.toolInput?.objectValue,
        let title = AgentHookText.normalized(input["subject"]?.stringValue),
        let response = request.event.payload["tool_response"]?.objectValue,
        let task = response["task"]?.objectValue,
        let id = AgentHookText.normalized(task["id"]?.stringValue)
      else {
        return nil
      }
      return .upsert(id: id, title: title, status: .pending)
    case "TaskUpdate":
      guard let input = request.event.toolInput?.objectValue,
        let id = claudeTaskID(from: input)
      else {
        return nil
      }
      let title = AgentHookText.normalized(input["subject"]?.stringValue)
      let rawStatus = AgentHookText.normalized(input["status"]?.stringValue)
      if rawStatus == "deleted" {
        return .remove(id: id)
      }
      let status = rawStatus.flatMap(progressStatus)
      guard rawStatus == nil || status != nil else { return nil }
      guard title != nil || status != nil else { return nil }
      return .upsert(id: id, title: title, status: status)
    case "TodoWrite":
      guard let todos = request.event.toolInput?.objectValue?["todos"]?.arrayValue else {
        return nil
      }
      var rows: [PaneAgentProgressRow] = []
      rows.reserveCapacity(todos.count)
      for (index, value) in todos.enumerated() {
        guard let todo = value.objectValue,
          let title = AgentHookText.normalized(todo["content"]?.stringValue),
          let status = progressStatus(todo["status"]?.stringValue)
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
      return .replace(rows)
    default:
      return nil
    }
  }

  private static func claudeTaskHookMutation(
    for request: SupatermAgentHookRequest
  ) -> TerminalAgentProgressMutation? {
    let status: PaneAgentProgressRow.Status
    switch request.event.hookEventName {
    case .taskCompleted: status = .completed
    case .taskCreated: status = .pending
    default: return nil
    }
    guard
      let id = AgentHookText.normalized(request.event.payload["task_id"]?.stringValue),
      let title = AgentHookText.normalized(request.event.payload["task_subject"]?.stringValue)
    else {
      return nil
    }
    return .upsert(id: id, title: title, status: status)
  }

  private static func claudeTaskID(from input: JSONObject) -> String? {
    AgentHookText.normalized(
      input["taskId"]?.stringValue
        ?? input["id"]?.stringValue
        ?? input["task_id"]?.stringValue
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
        let title = AgentHookText.normalized(item["step"]?.stringValue),
        let status = progressStatus(item["status"]?.stringValue)
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
      if let value = AgentHookText.normalized(question.objectValue?["question"]?.stringValue) {
        return value
      }
    }
    return nil
  }

  private static func progressStatus(
    _ value: String?
  ) -> PaneAgentProgressRow.Status? {
    switch value {
    case "completed": .completed
    case "in_progress": .running
    case "pending": .pending
    default: nil
    }
  }
}
