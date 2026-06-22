import Foundation
import SupatermAgentFeature
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalAgentPanelFeature
import SupatermTerminalCore
import SupatermTerminalFeature
import SupatermTerminalModels

extension TerminalCommandExecutor {
  struct AgentHookNotification {
    let body: String
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
  }

  struct AgentHookSessionRegistration {
    let didBeginSession: Bool
    let replacedForegroundSessionID: String?

    static let none = AgentHookSessionRegistration(
      didBeginSession: false,
      replacedForegroundSessionID: nil
    )
  }

  func handleCommandFinished(for surfaceID: UUID) {
    agentSessionStore.clearSessions(for: surfaceID)
    for entry in registry.activeEntries() where entry.terminal.clearAgentPresence(for: surfaceID) {
      entry.terminal.sessionDidChange()
      break
    }
  }

  public func restoreAgentSessions(from recordsBySurfaceID: [UUID: [TerminalPaneAgentRecord]]) {
    for (surfaceID, records) in recordsBySurfaceID {
      agentSessionStore.restoreSessions(from: records, surfaceID: surfaceID)
    }
  }

  func handleAgentHook(_ request: SupatermAgentHookRequest) throws -> TerminalAgentHookResult {
    pruneDeadAgentProcesses()
    let sessionRegistration = registerAgentHookSession(request)
    clearReplacedForegroundSessionIfNeeded(request, sessionRegistration: sessionRegistration)
    let routesToForegroundSession = routesAgentHookToForegroundSession(request)

    switch request.event.hookEventName {
    case .sessionStart:
      return handleSessionStartAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
      )

    case .unsupported:
      return TerminalAgentHookResult(desktopNotification: nil)

    case .postToolUse, .preToolUse:
      return handleToolStateAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession,
        didBeginSession: sessionRegistration.didBeginSession
      )

    case .userPromptSubmit:
      return handleUserPromptSubmitAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
      )

    case .stop:
      return try handleStopAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
      )

    case .sessionEnd:
      return handleSessionEndAgentHook(request)

    case .notification:
      return try handleAttentionAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
      )
    }
  }

  func handleMonitorSnapshot(
    _ snapshot: AgentMonitorSnapshot,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    _ = updateAgentPanelSnapshot(
      progressRows: snapshot.progressRows,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    guard let status = snapshot.status else { return }
    _ = updateAgentHoverMessages(
      snapshot.hoverMessages,
      replacing: true,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    _ = updateAgentPresenceActivity(
      TerminalHostState.AgentActivity(
        kind: agent,
        phase: status.isFinal ? .idle : .running,
        detail: status.isFinal ? nil : snapshot.detail
      ),
      sessionID: sessionID,
      context: context
    )
  }

  func handleRunningTimeoutExpired(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    _ = updateAgentPresenceActivity(
      TerminalHostState.AgentActivity(kind: agent, phase: .idle, detail: nil),
      sessionID: sessionID,
      context: context
    )
  }

  func handleRunningAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    _ = setAgentPresenceActivity(
      TerminalHostState.AgentActivity(
        kind: request.agent,
        phase: .running
      ),
      sessionID: sessionID,
      context: request.context,
      processID: request.processID
    )
    return TerminalAgentHookResult(desktopNotification: nil)
  }

  func handleUserPromptSubmitAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    _ = agentSessionStore.beginAgentPanelTracking(
      agent: request.agent,
      sessionID: sessionID,
      context: request.context
    )
    _ = markAgentSessionActionable(
      agent: request.agent,
      sessionID: sessionID,
      context: request.context,
      processID: request.processID
    )
    if !request.agent.drivesActivityFromTranscript {
      _ = setAgentPresenceActivity(
        TerminalHostState.AgentActivity(kind: request.agent, phase: .running),
        sessionID: sessionID,
        context: request.context,
        processID: request.processID
      )
    }
    return TerminalAgentHookResult(desktopNotification: nil)
  }

  func handleSessionStartAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    if let sessionID = request.event.sessionID {
      agentSessionStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
      _ = registerAgentPresence(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context,
        processID: request.processID
      )
      _ = agentSessionStore.beginAgentPanelTracking(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    return TerminalAgentHookResult(desktopNotification: nil)
  }

  func handleToolStateAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool,
    didBeginSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let result = handleRunningAgentHook(request)
    if didBeginSession, let sessionID = request.event.sessionID {
      _ = agentSessionStore.beginAgentPanelTracking(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    return result
  }

  func handleUserPromptSubmitAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    return handleUserPromptSubmitAgentHook(request)
  }

  func handleStopAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) throws -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentPresenceActivity(
        TerminalHostState.AgentActivity(kind: request.agent, phase: .idle),
        sessionID: sessionID,
        context: request.context,
        processID: request.processID
      )
      if request.agent.drivesActivityFromTranscript {
        _ = updateAgentHoverMessages(
          event.lastAssistantMessage.map { [$0] } ?? [],
          replacing: true,
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
        _ = clearAgentPanelSnapshot(
          agent: request.agent,
          context: request.context,
          sessionID: sessionID
        )
      }
    }
    guard
      let body = event.lastAssistantMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
      !body.isEmpty
    else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: AgentHookNotification(
        body: body,
        semantic: .completion,
        subtitle: "Turn complete"
      )
    )
  }

  func handleSessionEndAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = request.event.sessionID else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    _ = clearAgentPresence(
      agent: request.agent,
      sessionID: sessionID,
      context: request.context,
      processID: request.processID
    )
    if request.agent.drivesActivityFromTranscript {
      _ = clearAgentHoverMessages(
        agent: request.agent,
        context: request.context,
        sessionID: sessionID
      )
    }
    _ = clearAgentPanelSnapshot(
      agent: request.agent,
      context: request.context,
      sessionID: sessionID
    )
    agentSessionStore.clearSession(agent: request.agent, sessionID: sessionID)
    return TerminalAgentHookResult(desktopNotification: nil)
  }

  func handleAttentionAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) throws -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentPresenceActivity(
        TerminalHostState.AgentActivity(kind: request.agent, phase: .needsInput),
        sessionID: sessionID,
        context: request.context,
        processID: request.processID
      )
    }
    guard let body = event.notificationMessage(), !body.isEmpty else {
      return TerminalAgentHookResult(desktopNotification: nil)
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: AgentHookNotification(
        body: body,
        semantic: .attention,
        subtitle: event.title ?? "Attention"
      )
    )
  }

  func registerAgentHookSession(
    _ request: SupatermAgentHookRequest
  ) -> AgentHookSessionRegistration {
    guard let sessionID = request.event.sessionID else { return .none }
    let sessionExists = agentSessionStore.hasSession(agent: request.agent, sessionID: sessionID)
    if request.event.hookEventName == .sessionStart
      || shouldRecoverAgentSessionBinding(request, sessionExists: sessionExists)
    {
      let replacedForegroundSessionID = agentSessionStore.beginSession(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context,
        transcriptPath: request.event.transcriptPath
      )
      return AgentHookSessionRegistration(
        didBeginSession: true,
        replacedForegroundSessionID: replacedForegroundSessionID
      )
    }
    guard sessionExists else { return .none }
    agentSessionStore.updateSession(
      agent: request.agent,
      sessionID: sessionID,
      context: request.context,
      transcriptPath: request.event.transcriptPath
    )
    return AgentHookSessionRegistration(didBeginSession: false, replacedForegroundSessionID: nil)
  }

  func clearReplacedForegroundSessionIfNeeded(
    _ request: SupatermAgentHookRequest,
    sessionRegistration: AgentHookSessionRegistration
  ) {
    guard let sessionID = sessionRegistration.replacedForegroundSessionID else { return }
    _ = clearAgentPresence(
      agent: request.agent,
      sessionID: sessionID,
      context: request.context,
      processID: nil
    )
    _ = clearAgentHoverMessages(
      agent: request.agent,
      context: request.context,
      sessionID: sessionID
    )
    _ = clearAgentPanelSnapshot(
      agent: request.agent,
      context: request.context,
      sessionID: sessionID
    )
  }

  func shouldRecoverAgentSessionBinding(
    _ request: SupatermAgentHookRequest,
    sessionExists: Bool
  ) -> Bool {
    guard request.agent.recoversSessionsFromToolHooks,
      request.context != nil,
      !sessionExists
    else {
      return false
    }
    switch request.event.hookEventName {
    case .postToolUse, .preToolUse, .userPromptSubmit:
      return true
    case .notification, .sessionEnd, .sessionStart, .stop, .unsupported:
      return false
    }
  }

  func handleAgentEventNotification(
    _ agent: SupatermAgentKind,
    event: SupatermAgentHookEvent,
    context: SupatermCLIContext?,
    notification: AgentHookNotification
  ) throws -> TerminalAgentHookResult {
    let title = agent.notificationTitle
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: event.sessionID,
      context: context
    )

    for surfaceID in candidateSurfaceIDs {
      do {
        let result = try notifyStructuredAgent(
          TerminalNotifyRequest(
            body: notification.body,
            subtitle: notification.subtitle,
            target: .contextPane(surfaceID),
            title: title,
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
        guard case .contextPaneNotFound = error else {
          throw error
        }
        if let sessionID = event.sessionID {
          agentSessionStore.clearRecordedSessionIfSurfaceMatches(
            agent: agent,
            sessionID: sessionID,
            surfaceID: surfaceID
          )
          for entry in registry.activeEntries()
          where entry.terminal.clearAgentPresence(
            agent: agent,
            for: surfaceID,
            sessionID: sessionID,
            processID: nil
          ) {
            entry.terminal.sessionDidChange()
            break
          }
          return TerminalAgentHookResult(desktopNotification: nil)
        }
      }
    }

    return TerminalAgentHookResult(desktopNotification: nil)
  }

  func prepareAgentTurn(
    _ request: SupatermAgentHookRequest
  ) -> String? {
    guard let sessionID = request.event.sessionID else { return nil }
    clearRecentStructuredNotifications(
      agent: request.agent,
      context: request.context,
      sessionID: sessionID
    )
    return sessionID
  }

  @discardableResult
  func registerAgentPresence(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.registerAgentPresence(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  func markAgentSessionActionable(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.markAgentSessionActionable(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  func setAgentPresenceActivity(
    _ activity: TerminalHostState.AgentActivity,
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32?
  ) -> Bool {
    guard
      updateAgentPresenceActivity(
        activity,
        sessionID: sessionID,
        context: context,
        processID: processID
      )
    else {
      return false
    }
    let agent = activity.kind
    switch activity.phase {
    case .running where agent.drivesActivityFromTranscript:
      agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    case .running:
      if !agent.keepsPanelTrackingWhenNotRunning {
        agentSessionStore.cancelAgentPanelTracking(agent: agent, sessionID: sessionID)
      }
      agentSessionStore.armRunningTimeout(agent: agent, sessionID: sessionID, context: context)
    default:
      if !agent.keepsPanelTrackingWhenNotRunning {
        agentSessionStore.cancelAgentPanelTracking(agent: agent, sessionID: sessionID)
      }
      agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    }
    return true
  }

  func clearRecentStructuredNotifications(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.clearRecentStructuredNotification(for: surfaceID) {
        break
      }
    }
  }

  @discardableResult
  func clearAgentHoverMessages(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) -> Bool {
    updateAgentHoverMessages(
      [],
      replacing: true,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  @discardableResult
  func updateAgentHoverMessages(
    _ messages: [String],
    replacing: Bool,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.recordAgentHoverMessages(
        messages,
        replacing: replacing,
        for: surfaceID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  func clearAgentPanelSnapshot(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) -> Bool {
    updateAgentPanelSnapshot(
      progressRows: [],
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  @discardableResult
  func updateAgentPanelSnapshot(
    progressRows: [PaneAgentProgressRow],
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.recordAgentPanelSnapshot(
        progressRows: progressRows,
        for: surfaceID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  func clearAgentPresence(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32?
  ) -> Bool {
    agentSessionStore.cancelAgentPanelTracking(agent: agent, sessionID: sessionID)
    agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.clearAgentPresence(
        agent: agent,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      ) {
        return true
      }
    }
    return false
  }

  @discardableResult
  func updateAgentPresenceActivity(
    _ activity: TerminalHostState.AgentActivity,
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32? = nil
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: activity.kind,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in registry.activeEntries()
      where entry.terminal.setAgentPresenceActivity(
        activity,
        for: surfaceID,
        sessionID: sessionID,
        processID: processID
      ) {
        return true
      }
    }
    return false
  }

  func pruneDeadAgentProcesses() {
    for entry in registry.activeEntries() where entry.terminal.pruneDeadAgentProcesses() {
      entry.terminal.sessionDidChange()
    }
  }

  func agentCandidateSurfaceIDs(
    agent: SupatermAgentKind,
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> [UUID] {
    var candidateSurfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      candidateSurfaceIDs.append(surfaceID)
    }
    if let sessionID,
      let surfaceID = agentSessionStore.sessionSurfaceID(agent: agent, sessionID: sessionID),
      !candidateSurfaceIDs.contains(surfaceID)
    {
      candidateSurfaceIDs.append(surfaceID)
    }
    return candidateSurfaceIDs
  }

  func routesAgentHookToForegroundSession(
    _ request: SupatermAgentHookRequest
  ) -> Bool {
    guard let sessionID = request.event.sessionID else { return true }
    return agentSessionStore.shouldRouteSession(agent: request.agent, sessionID: sessionID)
  }
}
