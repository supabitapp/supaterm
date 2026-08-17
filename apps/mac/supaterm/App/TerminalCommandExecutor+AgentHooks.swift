import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  struct AgentHookNotification {
    let body: String
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
  }

  func handleAgentHook(_ request: SupatermAgentHookRequest) throws -> TerminalAgentHookResult {
    pruneDeadAgentProcesses()
    guard let terminal = agentTerminal(for: request),
      shouldHandleAgentHook(request, in: terminal)
    else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    if suppressesClaudeBackgroundNotification(request) {
      recordTerminalNotificationSuppression(
        for: request,
        semantic: request.event.notificationType == "agent_completed" ? .completion : .attention,
        in: terminal
      )
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let events = TerminalAgentEventTranslator.events(for: request)
    guard !events.isEmpty else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let childNotificationSemantic = childTerminalNotificationSemantic(
      for: request,
      events: events
    )
    if let childNotificationSemantic {
      recordTerminalNotificationSuppression(
        for: request,
        semantic: childNotificationSemantic,
        in: terminal
      )
    }
    if request.agent == .claude,
      request.event.notificationType == "idle_prompt",
      let sessionID = request.event.sessionID,
      terminal.agentSessionHasBackgroundWork(agent: .claude, sessionID: sessionID)
    {
      recordTerminalNotificationSuppression(for: request, semantic: .attention, in: terminal)
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    var didChange = false
    var result = TerminalAgentHookResult(desktopNotification: nil)
    for event in events {
      if event.action == .turnStarted, event.scope.subagentID == nil {
        clearRecentStructuredNotification(for: terminal, event: event)
      }
      let application = terminal.applyAgentEvent(event)
      didChange = application.changed || didChange
      guard application.accepted else { continue }
      guard
        terminal.agentSessionIsForeground(
          agent: event.scope.agent,
          sessionID: event.scope.sessionID
        )
      else {
        continue
      }
      if let notification = notification(for: event, request: request) {
        result = try handleAgentEventNotification(
          event.scope.agent,
          event: request.event,
          context: request.context,
          notification: notification
        )
      }
    }

    if didChange {
      terminal.sessionDidChange()
    }
    return result
  }

  func handleAgentEventNotification(
    _ agent: SupatermAgentKind,
    event: SupatermAgentHookEvent,
    context: SupatermCLIContext?,
    notification: AgentHookNotification
  ) throws -> TerminalAgentHookResult {
    for surfaceID in agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: event.sessionID,
      context: context
    ) {
      do {
        let result = try notifyStructuredAgent(
          TerminalNotifyRequest(
            body: notification.body,
            target: .pane(surfaceID),
            title: agent.notificationTitle,
            allowDesktopNotificationWhenAgentActive: true
          ),
          semantic: notification.semantic
        )
        return TerminalAgentHookResult(
          desktopNotification: result.desktopNotificationDisposition.shouldDeliver
            ? DesktopNotificationRequest(
              body: notification.body,
              subtitle: notification.subtitle,
              title: result.resolvedTitle,
              sourceSurfaceID: result.paneID
            )
            : nil
        )
      } catch let error as TerminalCreatePaneError {
        guard case .contextPaneNotFound = error else { throw error }
      }
    }
    return TerminalAgentHookResult(desktopNotification: nil)
  }

  private func notification(
    for event: TerminalAgentEvent,
    request: SupatermAgentHookRequest
  ) -> AgentHookNotification? {
    guard event.scope.subagentID == nil else { return nil }
    let body: String?
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
    switch event.action {
    case .attentionRequested(_, let message):
      body = message ?? request.event.notificationMessage()
      semantic = .attention
      subtitle = request.event.title ?? "Attention"
    case .turnCompleted(let message):
      body = message ?? "Agent turn complete"
      semantic = .completion
      subtitle = "Turn complete"
    default:
      return nil
    }
    guard let body = normalizedTerminalAgentDetail(body) else { return nil }
    return AgentHookNotification(body: body, semantic: semantic, subtitle: subtitle)
  }

  private func suppressesClaudeBackgroundNotification(
    _ request: SupatermAgentHookRequest
  ) -> Bool {
    request.agent == .claude
      && request.event.notificationType.map(
        SupatermClaudeHookSettings.backgroundNotificationTypes.contains
      ) == true
  }

  private func recordTerminalNotificationSuppression(
    for request: SupatermAgentHookRequest,
    semantic: TerminalHostState.NotificationSemantic,
    in terminal: TerminalHostState
  ) {
    guard
      let sessionID = request.event.sessionID,
      let surfaceID = request.context?.surfaceID
        ?? terminal.agentStateSurfaceID(agent: request.agent, sessionID: sessionID)
    else {
      return
    }
    terminal.recordTerminalNotificationSuppression(
      body: request.event.notificationMessage() ?? "",
      semantic: semantic,
      surfaceID: surfaceID,
      title: request.event.title ?? request.agent.notificationTitle
    )
  }

  private func childTerminalNotificationSemantic(
    for request: SupatermAgentHookRequest,
    events: [TerminalAgentEvent]
  ) -> TerminalHostState.NotificationSemantic? {
    guard events.contains(where: { $0.scope.subagentID != nil }) else { return nil }
    return switch request.event.hookEventName {
    case .notification: .attention
    default: nil
    }
  }

  private func clearRecentStructuredNotification(
    for terminal: TerminalHostState,
    event: TerminalAgentEvent
  ) {
    guard
      let surfaceID = terminal.agentStateSurfaceID(
        agent: event.scope.agent,
        sessionID: event.scope.sessionID
      )
    else {
      return
    }
    _ = terminal.clearRecentStructuredNotification(for: surfaceID)
  }

  private func agentTerminal(
    for request: SupatermAgentHookRequest
  ) -> TerminalHostState? {
    agentTerminal(
      agent: request.agent,
      sessionID: request.event.sessionID,
      context: request.context
    )
  }

  private func shouldHandleAgentHook(
    _ request: SupatermAgentHookRequest,
    in terminal: TerminalHostState
  ) -> Bool {
    guard request.agent == .codex,
      let sessionID = request.event.sessionID,
      !terminal.hasAgentSession(agent: .codex, sessionID: sessionID),
      let surfaceID = request.context?.surfaceID,
      let processID = request.processID
    else {
      return true
    }
    guard
      let foregroundWorkingDirectoryPath = terminal.foregroundAgentWorkingDirectoryPath(
        agent: .codex,
        processID: processID,
        for: surfaceID
      )
    else {
      return true
    }
    guard
      let workingDirectoryPath = TerminalAgentPanelWorkspaceKey(
        workingDirectoryPath: request.event.cwd
      )?.workingDirectoryPath
    else {
      return false
    }
    return workingDirectoryPath == foregroundWorkingDirectoryPath
  }

  private func agentTerminal(
    agent: SupatermAgentKind,
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> TerminalHostState? {
    let entries = registry.activeEntries()
    if let surfaceID = context?.surfaceID,
      let terminal = entries.first(where: { $0.terminal.tabID(containing: surfaceID) != nil })?.terminal
    {
      return terminal
    }
    guard let sessionID else { return nil }
    return entries.first {
      $0.terminal.hasAgentSession(agent: agent, sessionID: sessionID)
    }?.terminal
  }

  private func agentCandidateSurfaceIDs(
    agent: SupatermAgentKind,
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> [UUID] {
    var surfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      surfaceIDs.append(surfaceID)
    }
    if let sessionID,
      let terminal = agentTerminal(agent: agent, sessionID: sessionID, context: nil),
      let surfaceID = terminal.agentStateSurfaceID(agent: agent, sessionID: sessionID),
      !surfaceIDs.contains(surfaceID)
    {
      surfaceIDs.append(surfaceID)
    }
    return surfaceIDs
  }

  private func pruneDeadAgentProcesses() {
    for entry in registry.activeEntries()
    where entry.terminal.pruneDeadAgentProcesses() {
      entry.terminal.sessionDidChange()
    }
  }
}
