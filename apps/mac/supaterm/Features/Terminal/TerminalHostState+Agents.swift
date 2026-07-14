import Foundation
import SupatermCLIShared

struct TerminalAgentTranscriptTarget {
  let scope: TerminalAgentEvent.Scope
  let transcriptPath: String
  let context: SupatermCLIContext
}

extension TerminalHostState {
  func tabAgentPresentation(for tabID: TerminalTabID) -> TabAgentPresentation {
    guard let tree = trees[tabID] else {
      return TabAgentPresentation(
        badgeActivities: [],
        badgeActivity: nil,
        badgeActivityIsFocused: false,
        detailActivity: nil,
        hoverMarkdown: nil
      )
    }

    let focusedSurfaceID = focusHistoryByTab[tabID]?.current
    let instances = tree.leaves().flatMap { surface in
      agentStateInstances(for: surface.id)
    }
    let badgeActivities = instances.map(\.activity)
    let badgeInstance = instances.filter(\.presentation.hasActivity).max { lhs, rhs in
      let lhsPriority = Self.agentActivityPriority(lhs.activity.phase)
      let rhsPriority = Self.agentActivityPriority(rhs.activity.phase)
      if lhsPriority != rhsPriority {
        return lhsPriority < rhsPriority
      }

      let lhsIsFocused = lhs.surfaceID == focusedSurfaceID
      let rhsIsFocused = rhs.surfaceID == focusedSurfaceID
      if lhsIsFocused != rhsIsFocused {
        return !lhsIsFocused && rhsIsFocused
      }

      return lhs.revision < rhs.revision
    }
    let focusedInstances = instances.filter { $0.surfaceID == focusedSurfaceID }
    let detailActivity = focusedInstances.filter(\.presentation.hasActivity).max {
      let lhsPriority = Self.agentActivityPriority($0.activity.phase)
      let rhsPriority = Self.agentActivityPriority($1.activity.phase)
      return lhsPriority == rhsPriority ? $0.revision < $1.revision : lhsPriority < rhsPriority
    }?.activity
    let hoverMarkdown = focusedInstances.max { $0.revision < $1.revision }.flatMap {
      Self.codexHoverMarkdown($0.presentation.hoverMessages)
    }

    let badgeActivityIsFocused =
      badgeInstance.map { instance in
        Self.surfaceActivity(
          isSelectedTab: tabID == spaceManager.selectedTabID,
          windowIsVisible: windowActivity.isVisible,
          windowIsKey: windowActivity.isKeyWindow,
          focusedSurfaceID: focusedSurfaceID,
          surfaceID: instance.surfaceID
        ).isFocused
      } ?? false

    return TabAgentPresentation(
      badgeActivities: badgeActivities,
      badgeActivity: badgeInstance?.activity,
      badgeActivityIsFocused: badgeActivityIsFocused,
      detailActivity: detailActivity,
      hoverMarkdown: hoverMarkdown
    )
  }

  func agentActivity(for tabID: TerminalTabID) -> AgentActivity? {
    tabAgentPresentation(for: tabID).badgeActivity
  }

  func codexHoverMarkdown(for tabID: TerminalTabID) -> String? {
    tabAgentPresentation(for: tabID).hoverMarkdown
  }

  func agentPanelPresentations(for tabID: TerminalTabID) -> [UUID: PaneAgentPanelPresentation] {
    guard agentPanelIsEnabled else {
      return [:]
    }
    guard let tree = trees[tabID] else {
      return [:]
    }
    return Dictionary(
      uniqueKeysWithValues: tree.leaves().compactMap { surface in
        guard let presentation = agentPanelPresentation(for: surface.id) else {
          return nil
        }
        return (surface.id, presentation)
      }
    )
  }

  func agentPanelPresentation(for surfaceID: UUID) -> PaneAgentPanelPresentation? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard agentPanelIsActive(for: surfaceID) else {
      return nil
    }
    let metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    let instances = agentStateInstances(for: surfaceID)
    let current = currentAgentStateInstance(in: instances)
    let workingDirectoryPath = agentPanelWorkingDirectoryPath(
      for: surfaceID,
      agentWorkingDirectoryPath: current?.presentation.workingDirectoryPath
    )
    let actionableSessions: [PaneAgentPanelSession] = instances.compactMap { instance in
      guard instance.presentation.isActionable else { return nil }
      return PaneAgentPanelSession.supported(
        agent: instance.presentation.agent,
        sessionID: instance.presentation.sessionID,
        workingDirectoryPath: agentPanelWorkingDirectoryPath(
          for: surfaceID,
          agentWorkingDirectoryPath: instance.presentation.workingDirectoryPath
        )
      )
    }
    let session = actionableSessions.count == 1 ? actionableSessions[0] : nil
    let presentation = metadata.panelPresentation(
      progressRows: current?.presentation.progressRows ?? [],
      activeChildren: current?.presentation.activeChildren ?? [],
      workingDirectoryPath: workingDirectoryPath,
      session: session
    )
    guard !presentation.hasContentBesidesWorkspace,
      let current,
      current.presentation.hasActivity
    else {
      return presentation.isEmpty ? nil : presentation
    }
    switch current.activity.phase {
    case .running:
      return PaneAgentPanelPresentation(
        progressRows: [
          PaneAgentProgressRow(
            id: "agent-session-running",
            title: current.activity.detail ?? "Starting session",
            status: .running
          )
        ],
        workingDirectoryPath: workingDirectoryPath
      )
    case .needsInput:
      return PaneAgentPanelPresentation(
        progressRows: [
          PaneAgentProgressRow(
            id: "agent-session-needs-input",
            title: current.activity.detail ?? "Needs input",
            status: .pending
          )
        ],
        workingDirectoryPath: workingDirectoryPath
      )
    case .idle:
      return presentation.isEmpty ? nil : presentation
    }
  }

  func agentPanelRefreshContext(for surfaceID: UUID) -> TerminalAgentPanelRefreshContext? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard surfaces[surfaceID] != nil else {
      return nil
    }
    guard tabID(containing: surfaceID) != nil else {
      return nil
    }
    guard agentPanelIsActive(for: surfaceID) else {
      return nil
    }
    let current = currentAgentStateInstance(in: agentStateInstances(for: surfaceID))
    let workingDirectoryPath = agentPanelWorkingDirectoryPath(
      for: surfaceID,
      agentWorkingDirectoryPath: current?.presentation.workingDirectoryPath
    )
    let processIDs = agentStateStore.snapshots(for: surfaceID).reduce(into: Set<Int32>()) {
      $0.formUnion($1.processIDs)
    }
    return TerminalAgentPanelRefreshContext(
      workingDirectoryPath: workingDirectoryPath,
      processIDs: processIDs
    )
  }

  var agentPanelIsEnabled: Bool {
    supatermSettings.codingAgentsShowPanel
  }

  func agentPanelIsActive(for surfaceID: UUID) -> Bool {
    guard agentPanelIsEnabled else {
      return false
    }
    return !agentStateStore.snapshots(for: surfaceID).isEmpty
      || paneAgentMetadataBySurfaceID[surfaceID]?.isEmpty == false
  }

  func showsAgentActivityDetail(for tabID: TerminalTabID) -> Bool {
    tabAgentPresentation(for: tabID).detailActivity != nil
  }

  @discardableResult
  func clearAgentState(for surfaceID: UUID) -> Bool {
    let changed = !agentStateStore.snapshots(for: surfaceID).isEmpty
    agentStateStore.clearSessions(for: surfaceID)
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  func pruneDeadAgentProcesses(
    isProcessCurrent: (TerminalAgentProcessIdentity) -> Bool =
      TerminalAgentProcessInspector.isCurrent,
    didClearSession: (SupatermAgentKind, String) -> Void = { _, _ in }
  ) -> Bool {
    let changedSurfaceIDs = agentStateStore.pruneDeadProcesses(
      isProcessCurrent: isProcessCurrent,
      didClearSession: didClearSession
    )
    for surfaceID in changedSurfaceIDs {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return !changedSurfaceIDs.isEmpty
  }

  func agentStateRecords(for surfaceID: UUID) -> [TerminalPaneAgentRecord] {
    agentStateStore.snapshots(for: surfaceID).map(TerminalPaneAgentRecord.init(snapshot:))
  }

  @discardableResult
  func storeAgentPanelBranchDetails(
    _ branchDetails: PaneAgentBranchDetails?,
    for surfaceID: UUID
  ) -> Bool {
    guard agentPanelIsEnabled || branchDetails == nil else {
      return false
    }
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    guard metadata.branchDetails != branchDetails else { return false }
    metadata.branchDetails = branchDetails
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  @discardableResult
  func storeAgentPanelArtifacts(
    _ artifacts: [PaneAgentArtifact],
    for surfaceID: UUID
  ) -> Bool {
    guard agentPanelIsEnabled || artifacts.isEmpty else {
      return false
    }
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    guard metadata.artifacts != artifacts else { return false }
    metadata.artifacts = artifacts
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  @discardableResult
  func clearAgentPanelMetadata(for surfaceID: UUID) -> Bool {
    paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID) != nil
  }

  static func agentActivityPriority(_ phase: AgentActivityPhase) -> Int {
    switch phase {
    case .needsInput:
      return 2
    case .running:
      return 1
    case .idle:
      return 0
    }
  }

  @discardableResult
  func applyAgentEvent(_ event: TerminalAgentEvent) -> TerminalAgentEventApplication {
    let previousSurfaceID = agentStateStore.surfaceID(
      agent: event.scope.agent,
      sessionID: event.scope.sessionID
    )
    if let contextSurfaceID = event.context?.surfaceID,
      tabID(containing: contextSurfaceID) == nil,
      previousSurfaceID == nil
    {
      return TerminalAgentEventApplication(accepted: false, changed: false)
    }
    let surfaceID = event.context?.surfaceID ?? previousSurfaceID
    let before = surfaceID.map(agentStateStore.snapshots(for:)) ?? []
    let accepted = agentStateStore.apply(event)
    let resolvedSurfaceID =
      surfaceID
      ?? agentStateStore.surfaceID(
        agent: event.scope.agent,
        sessionID: event.scope.sessionID
      )
    guard let resolvedSurfaceID else {
      return TerminalAgentEventApplication(accepted: accepted, changed: false)
    }
    let changed = before != agentStateStore.snapshots(for: resolvedSurfaceID)
    if changed {
      agentPanelController?.surfaceAgentStateChanged(resolvedSurfaceID)
    }
    return TerminalAgentEventApplication(accepted: accepted, changed: changed)
  }

  func agentStateSurfaceID(agent: SupatermAgentKind, sessionID: String) -> UUID? {
    agentStateStore.surfaceID(agent: agent, sessionID: sessionID)
  }

  func agentTurnID(agent: SupatermAgentKind, sessionID: String) -> String? {
    guard let surfaceID = agentStateStore.surfaceID(agent: agent, sessionID: sessionID),
      let snapshot = agentStateStore.snapshots(for: surfaceID).first(where: {
        $0.agent == agent && $0.sessionID == sessionID
      })
    else {
      return nil
    }
    switch snapshot.turnLifecycle {
    case .active(let turnID), .completed(let turnID):
      return turnID
    case .unseen:
      return nil
    }
  }

  func hasAgentSession(agent: SupatermAgentKind, sessionID: String) -> Bool {
    agentStateStore.hasSession(agent: agent, sessionID: sessionID)
  }

  func hasForegroundAgentSession(
    agent: SupatermAgentKind,
    processID: Int32,
    for surfaceID: UUID
  ) -> Bool {
    agentStateStore.snapshots(for: surfaceID).contains {
      $0.agent == agent && $0.isForeground && $0.processIDs.contains(processID)
    }
  }

  func agentSessionIsForeground(agent: SupatermAgentKind, sessionID: String) -> Bool {
    agentStateStore.isForeground(agent: agent, sessionID: sessionID)
  }

  func agentTranscriptTargets() -> [TerminalAgentTranscriptTarget] {
    liveSurfaceIDs().flatMap { surfaceID -> [TerminalAgentTranscriptTarget] in
      guard let context = agentContext(for: surfaceID) else { return [] }
      return agentStateStore.snapshots(for: surfaceID).flatMap { snapshot in
        var targets: [TerminalAgentTranscriptTarget] = []
        if let transcriptPath = snapshot.transcriptPath {
          targets.append(
            TerminalAgentTranscriptTarget(
              scope: TerminalAgentEvent.Scope(
                agent: snapshot.agent,
                sessionID: snapshot.sessionID
              ),
              transcriptPath: transcriptPath,
              context: context
            )
          )
        }
        targets.append(
          contentsOf: snapshot.activeChildren.compactMap { child in
            guard let transcriptPath = child.transcriptPath else { return nil }
            return TerminalAgentTranscriptTarget(
              scope: TerminalAgentEvent.Scope(
                agent: snapshot.agent,
                sessionID: child.sessionID,
                turnID: child.turnID,
                subagentID: child.subagentID
              ),
              transcriptPath: transcriptPath,
              context: context
            )
          }
        )
        return targets
      }
    }
  }

  private func agentContext(for surfaceID: UUID) -> SupatermCLIContext? {
    tabID(containing: surfaceID).map {
      SupatermCLIContext(surfaceID: surfaceID, tabID: $0.rawValue)
    }
  }

  private func agentStateInstances(for surfaceID: UUID) -> [AgentStateInstance] {
    agentStateStore.snapshots(for: surfaceID).compactMap { snapshot in
      guard snapshot.isForeground,
        let presentation = agentStateStore.presentation(for: surfaceID, agent: snapshot.agent)
      else {
        return nil
      }
      return AgentStateInstance(
        presentation: presentation,
        revision: snapshot.revision,
        surfaceID: surfaceID
      )
    }
    .sorted { $0.activity.kind.rawValue < $1.activity.kind.rawValue }
  }

  private func currentAgentStateInstance(
    in instances: [AgentStateInstance]
  ) -> AgentStateInstance? {
    instances.max { $0.revision < $1.revision }
  }

  private func agentPanelWorkingDirectoryPath(
    for surfaceID: UUID,
    agentWorkingDirectoryPath: String?
  ) -> String? {
    TerminalAgentPanelWorkspaceKey(
      workingDirectoryPath: agentWorkingDirectoryPath ?? surfaces[surfaceID]?.bridge.state.pwd
    )?.workingDirectoryPath
  }

  static func codexHoverMarkdown(_ messages: [String]) -> String? {
    guard !messages.isEmpty else { return nil }
    return messages.joined(separator: "\n\n")
  }

  func storePaneAgentMetadata(_ metadata: PaneAgentMetadata, for surfaceID: UUID) {
    if metadata.isEmpty {
      paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID)
    } else {
      paneAgentMetadataBySurfaceID[surfaceID] = metadata
    }
  }
}
