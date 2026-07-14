import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  struct AgentHookNotification {
    let body: String
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
  }

  func handleCommandFinished(for surfaceID: UUID) {
    agentMonitorStore.clearSessions(for: surfaceID)
    for entry in registry.activeEntries() {
      guard entry.terminal.clearAgentState(for: surfaceID) else { continue }
      entry.terminal.sessionDidChange()
      return
    }
  }

  func handleSurfaceRemoved(_ surfaceID: UUID) {
    agentMonitorStore.clearSessions(for: surfaceID)
  }

  func resumeAgentMonitoring(in terminal: TerminalHostState) {
    for target in terminal.agentTranscriptTargets() {
      _ = agentMonitorStore.track(
        scope: target.scope,
        transcriptPath: target.transcriptPath,
        context: target.context
      )
    }
  }

  func handleAgentHook(_ request: SupatermAgentHookRequest) throws -> TerminalAgentHookResult {
    pruneDeadAgentProcesses()
    let events = TerminalAgentEventTranslator.events(for: request)
    guard !events.isEmpty,
      let terminal = agentTerminal(for: request),
      shouldHandleAgentHook(request, in: terminal)
    else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let suppressesCompletionNotification =
      request.agent == .claude
      && terminal.agentSessionHasActiveGoal(
        agent: request.agent,
        sessionID: events[0].scope.sessionID
      )

    var didChange = false
    var didAccept = false
    var result = TerminalAgentHookResult(desktopNotification: nil)
    for event in events {
      if event.action == .turnStarted {
        clearRecentStructuredNotification(for: terminal, event: event)
      }
      let application = terminal.applyAgentEvent(event)
      didAccept = application.accepted || didAccept
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
      if let notification = notification(
        for: event,
        request: request,
        suppressesCompletion: suppressesCompletionNotification
      ) {
        result = try handleAgentEventNotification(
          event.scope.agent,
          event: request.event,
          context: request.context,
          notification: notification
        )
      }
    }

    updateMonitoring(
      for: request,
      events: events,
      accepted: didAccept,
      terminal: terminal
    )
    if didChange {
      terminal.sessionDidChange()
    }
    return result
  }

  func handleMonitorSnapshot(
    _ snapshot: AgentMonitorSnapshot,
    scope: TerminalAgentEvent.Scope,
    context: SupatermCLIContext?
  ) {
    guard
      let terminal = agentTerminal(
        agent: scope.agent,
        sessionID: scope.sessionID,
        context: context
      )
    else {
      clearMonitoring(scope)
      return
    }
    guard terminal.hasAgentSession(agent: scope.agent, sessionID: scope.sessionID) else {
      clearMonitoring(scope)
      return
    }
    let turnID = scope.subagentID == nil ? snapshot.status?.turnID : scope.turnID
    var actions: [TerminalAgentEvent.Action] = []
    switch snapshot.status {
    case .started:
      actions.append(.turnRunning(detail: snapshot.detail))
    case .aborted, .completed, .failed:
      actions.append(.turnCompleted(message: nil))
    case nil:
      if snapshot.detail != nil {
        actions.append(.turnRunning(detail: snapshot.detail))
      }
    }
    if scope.subagentID == nil {
      actions.append(.hoverMessagesUpdated(snapshot.hoverMessages))
      actions.append(.progressUpdated(snapshot.progressRows, source: .transcript))
    }
    var didChange = false
    for action in actions {
      let event = TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(
          agent: scope.agent,
          sessionID: scope.sessionID,
          turnID: turnID,
          subagentID: scope.subagentID
        ),
        context: context,
        action: action,
        origin: .transcript
      )
      didChange = terminal.applyAgentEvent(event).changed || didChange
    }
    if didChange {
      terminal.sessionDidChange()
    }
  }

  func handleRunningTimeoutExpired(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    guard let terminal = agentTerminal(agent: agent, sessionID: sessionID, context: context) else {
      return
    }
    guard terminal.hasAgentSession(agent: agent, sessionID: sessionID) else {
      agentMonitorStore.clearSession(agent: agent, sessionID: sessionID)
      return
    }
    let turnID = terminal.agentTurnID(agent: agent, sessionID: sessionID)
    if terminal.applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(
          agent: agent,
          sessionID: sessionID,
          turnID: turnID
        ),
        context: context,
        action: .turnCompleted(message: nil)
      )
    ).changed {
      terminal.sessionDidChange()
    }
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
            subtitle: notification.subtitle,
            target: .contextPane(surfaceID),
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
    request: SupatermAgentHookRequest,
    suppressesCompletion: Bool
  ) -> AgentHookNotification? {
    let body: String?
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
    switch event.action {
    case .attentionRequested(_, let message):
      body = message ?? request.event.notificationMessage()
      semantic = .attention
      subtitle = request.event.title ?? "Attention"
    case .turnCompleted where suppressesCompletion:
      return nil
    case .turnCompleted(let message):
      body = message
      semantic = .completion
      subtitle = "Turn complete"
    default:
      return nil
    }
    guard let body = normalizedTerminalAgentDetail(body) else { return nil }
    return AgentHookNotification(body: body, semantic: semantic, subtitle: subtitle)
  }

  private func updateMonitoring(
    for request: SupatermAgentHookRequest,
    events: [TerminalAgentEvent],
    accepted: Bool,
    terminal: TerminalHostState
  ) {
    guard accepted else { return }
    guard let sessionID = request.event.sessionID else { return }
    guard let scope = events.first?.scope else { return }
    if request.event.hookEventName == .sessionEnd
      || request.event.hookEventName == .sessionShutdown
    {
      agentMonitorStore.clearSession(agent: request.agent, sessionID: sessionID)
      return
    }
    if request.event.hookEventName == .subagentStop
      || request.event.hookEventName == .stop
    {
      agentMonitorStore.cancelTracking(scope: scope)
    } else if let transcriptPath = request.event.transcriptPath {
      _ = agentMonitorStore.track(
        scope: scope,
        transcriptPath: transcriptPath,
        context: request.context
      )
    }
    guard scope.subagentID == nil else { return }
    guard terminal.agentSessionIsForeground(agent: request.agent, sessionID: sessionID) else {
      return
    }
    if events.contains(where: { event in
      if case .attentionRequested = event.action { return true }
      return false
    }) {
      agentMonitorStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
      return
    }
    switch request.event.hookEventName {
    case .postToolUse, .userPromptSubmit, .preToolUse:
      if request.agent.drivesActivityFromTranscript,
        agentMonitorStore.isTracking(scope: scope)
      {
        agentMonitorStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
        return
      }
      agentMonitorStore.armRunningTimeout(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    case .stop:
      agentMonitorStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
    case .sessionEnd, .sessionShutdown:
      agentMonitorStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
    default:
      break
    }
  }

  private func clearMonitoring(_ scope: TerminalAgentEvent.Scope) {
    if scope.subagentID == nil {
      agentMonitorStore.clearSession(agent: scope.agent, sessionID: scope.sessionID)
    } else {
      agentMonitorStore.cancelTracking(scope: scope)
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
      request.event.transcriptPath == nil,
      let sessionID = request.event.sessionID,
      !terminal.hasAgentSession(agent: .codex, sessionID: sessionID),
      let surfaceID = request.context?.surfaceID,
      let processID = request.processID
    else {
      return true
    }
    return !terminal.hasForegroundAgentSession(
      agent: .codex,
      processID: processID,
      for: surfaceID
    )
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
    where entry.terminal.pruneDeadAgentProcesses(
      didClearSession: { [agentMonitorStore] agent, sessionID in
        agentMonitorStore.clearSession(agent: agent, sessionID: sessionID)
      }
    ) {
      entry.terminal.sessionDidChange()
    }
  }
}

extension AgentTurnStatus {
  fileprivate var turnID: String? {
    switch self {
    case .aborted(let turnID), .completed(let turnID), .failed(let turnID), .started(let turnID):
      turnID
    }
  }
}
