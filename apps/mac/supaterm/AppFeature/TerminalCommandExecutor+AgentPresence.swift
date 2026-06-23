import Foundation
import SupatermAgentFeature
import SupatermCLIShared
import SupatermTerminalAgentPanelFeature
import SupatermTerminalFeature

extension TerminalCommandExecutor {
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
}
