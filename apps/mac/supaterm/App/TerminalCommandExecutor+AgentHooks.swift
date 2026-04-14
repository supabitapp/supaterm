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
    registerAgentHookSession(request)
    let routesToForegroundSession = routesAgentHookToForegroundSession(request)

    switch request.event.hookEventName {
    case .sessionStart:
      return handleSessionStartAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
      )

    case .unsupported:
      return .init(desktopNotification: nil)

    case .postToolUse, .preToolUse:
      return handleToolStateAgentHook(
        request,
        routesToForegroundSession: routesToForegroundSession
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

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didReceiveCodexSidebarSnapshot snapshot: CodexSidebarSnapshot,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    _ = updateCodexHoverMessages(
      snapshot.hoverMessages,
      replacing: true,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    _ = updateAgentActivity(
      .init(
        kind: agent,
        phase: snapshot.status?.isFinal == true ? .idle : .running,
        detail: snapshot.status?.isFinal == true ? nil : snapshot.detail
      ),
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  func terminalAgentSessionStore(
    _ store: TerminalAgentSessionStore,
    didExpireRunningTimeoutFor agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) {
    _ = updateAgentActivity(
      .init(kind: agent, phase: .idle, detail: nil),
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  func handleRunningAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return .init(desktopNotification: nil)
    }
    _ = setAgentActivity(
      .init(
        kind: request.agent,
        phase: .running
      ),
      agent: request.agent,
      sessionID: sessionID,
      context: request.context
    )
    return .init(desktopNotification: nil)
  }

  func handleUserPromptSubmitAgentHook(
    _ request: SupatermAgentHookRequest
  ) -> TerminalAgentHookResult {
    guard let sessionID = prepareAgentTurn(request) else {
      return .init(desktopNotification: nil)
    }
    if request.agent == .codex {
      _ = agentSessionStore.beginCodexTracking(
        sessionID: sessionID,
        context: request.context
      )
    } else {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .running),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    return .init(desktopNotification: nil)
  }

  func handleSessionStartAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return .init(desktopNotification: nil)
    }
    if let sessionID = request.event.sessionID {
      agentSessionStore.cancelRunningTimeout(agent: request.agent, sessionID: sessionID)
      if request.agent == .codex {
        _ = agentSessionStore.beginCodexTracking(
          sessionID: sessionID,
          context: request.context
        )
      }
    }
    return .init(desktopNotification: nil)
  }

  func handleToolStateAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return .init(desktopNotification: nil)
    }
    return handleRunningAgentHook(request)
  }

  func handleUserPromptSubmitAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return .init(desktopNotification: nil)
    }
    return handleUserPromptSubmitAgentHook(request)
  }

  func handleStopAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) throws -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return .init(desktopNotification: nil)
    }
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .idle),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
      if request.agent == .codex {
        _ = updateCodexHoverMessages(
          event.lastAssistantMessage.map { [$0] } ?? [],
          replacing: true,
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
      }
    }
    guard
      let body = event.lastAssistantMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
      !body.isEmpty
    else {
      return .init(desktopNotification: nil)
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: .init(
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
      return .init(desktopNotification: nil)
    }
    _ = clearAgentActivity(agent: request.agent, sessionID: sessionID, context: request.context)
    if request.agent == .codex {
      _ = clearCodexHoverMessages(
        agent: request.agent,
        context: request.context,
        sessionID: sessionID
      )
    }
    agentSessionStore.clearSession(agent: request.agent, sessionID: sessionID)
    return .init(desktopNotification: nil)
  }

  func handleAttentionAgentHook(
    _ request: SupatermAgentHookRequest,
    routesToForegroundSession: Bool
  ) throws -> TerminalAgentHookResult {
    guard routesToForegroundSession else {
      return .init(desktopNotification: nil)
    }
    let event = request.event
    if let sessionID = event.sessionID {
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .needsInput),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
    }
    guard let body = event.notificationMessage(), !body.isEmpty else {
      return .init(desktopNotification: nil)
    }
    return try handleAgentEventNotification(
      request.agent,
      event: event,
      context: request.context,
      notification: .init(
        body: body,
        semantic: .attention,
        subtitle: event.title ?? "Attention"
      )
    )
  }

  func registerAgentHookSession(
    _ request: SupatermAgentHookRequest
  ) {
    guard let sessionID = request.event.sessionID else { return }
    if request.event.hookEventName == .sessionStart {
      agentSessionStore.beginSession(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context,
        transcriptPath: request.event.transcriptPath
      )
      return
    }
    if agentSessionStore.hasSession(agent: request.agent, sessionID: sessionID) {
      agentSessionStore.updateSession(
        agent: request.agent,
        sessionID: sessionID,
        context: request.context,
        transcriptPath: request.event.transcriptPath
      )
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
          .init(
            body: notification.body,
            subtitle: notification.subtitle,
            target: .contextPane(surfaceID),
            title: title,
            allowDesktopNotificationWhenAgentActive: true
          ),
          semantic: notification.semantic
        )
        return .init(
          desktopNotification: result.desktopNotificationDisposition.shouldDeliver
            ? .init(
              body: notification.body,
              subtitle: notification.subtitle,
              title: result.resolvedTitle
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
          return .init(desktopNotification: nil)
        }
      }
    }

    return .init(desktopNotification: nil)
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
  func setAgentActivity(
    _ activity: TerminalHostState.AgentActivity,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    guard updateAgentActivity(activity, agent: agent, sessionID: sessionID, context: context)
    else {
      return false
    }
    switch activity.phase {
    case .running where agent == .codex:
      agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    case .running:
      agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
      agentSessionStore.armRunningTimeout(agent: agent, sessionID: sessionID, context: context)
    default:
      agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
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
  func clearCodexHoverMessages(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) -> Bool {
    updateCodexHoverMessages(
      [],
      replacing: true,
      agent: agent,
      sessionID: sessionID,
      context: context
    )
  }

  @discardableResult
  func updateCodexHoverMessages(
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
      where entry.terminal.recordCodexHoverMessages(
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
  func clearAgentActivity(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    agentSessionStore.cancelTranscriptMonitor(agent: agent, sessionID: sessionID)
    agentSessionStore.cancelRunningTimeout(agent: agent, sessionID: sessionID)
    return updateAgentActivity(nil, agent: agent, sessionID: sessionID, context: context)
  }

  @discardableResult
  func updateAgentActivity(
    _ activity: TerminalHostState.AgentActivity?,
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
      for entry in registry.activeEntries() {
        if let activity {
          if entry.terminal.setAgentActivity(activity, for: surfaceID) {
            return true
          }
        } else if entry.terminal.clearAgentActivity(for: surfaceID) {
          return true
        }
      }
    }
    return false
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
