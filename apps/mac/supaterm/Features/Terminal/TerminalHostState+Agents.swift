import Foundation
import SupatermCLIShared
import SupatermSupport

extension TerminalHostState {
  struct ResolvedAgentState {
    let resolution: TerminalAgentDetectionResolution
    let instances: [AgentStateInstance]
    let currentInstance: AgentStateInstance?
    let currentNativeCandidate: TerminalAgentDetectionNativeCandidate?
  }
}

extension TerminalHostState {
  func tabAgentPresentation(for tabID: TerminalTabID) -> TabAgentPresentation {
    guard let tree = trees[tabID] else {
      return TabAgentPresentation(
        status: nil,
        detailActivity: nil,
        latestResponse: nil
      )
    }

    let focusedSurfaceID = focusHistoryByTab[tabID]?.current
    let instances = tree.leaves().flatMap { surface in
      agentStateInstances(for: surface.id)
    }
    let statusCandidate = instances.compactMap { instance in
      let isFocused = agentInstanceIsFocused(
        instance,
        in: tabID,
        focusedSurfaceID: focusedSurfaceID
      )
      return tabAgentStatus(for: instance, isFocused: isFocused).map {
        (instance: instance, status: $0)
      }
    }.max { lhs, rhs in
      let lhsPriority = Self.tabAgentStatusPriority(lhs.status)
      let rhsPriority = Self.tabAgentStatusPriority(rhs.status)
      if lhsPriority != rhsPriority {
        return lhsPriority < rhsPriority
      }

      let lhsIsFocused = lhs.instance.surfaceID == focusedSurfaceID
      let rhsIsFocused = rhs.instance.surfaceID == focusedSurfaceID
      if lhsIsFocused != rhsIsFocused {
        return !lhsIsFocused && rhsIsFocused
      }

      return lhs.instance.revision < rhs.instance.revision
    }
    let focusedInstances = instances.filter { $0.surfaceID == focusedSurfaceID }
    let detailActivity = focusedInstances.filter(\.hasActivity).max {
      let lhsPriority = Self.agentActivityPriority($0.activity.phase)
      let rhsPriority = Self.agentActivityPriority($1.activity.phase)
      return lhsPriority == rhsPriority ? $0.revision < $1.revision : lhsPriority < rhsPriority
    }?.activity
    let latestResponse = focusedInstances.compactMap { instance in
      Self.latestAgentResponse(
        agent: instance.activity.identity,
        text: instance.nativePresentation?.latestResponse
      ).map { (revision: instance.revision, response: $0) }
    }.max { $0.revision < $1.revision }?.response

    return TabAgentPresentation(
      status: statusCandidate?.status,
      detailActivity: detailActivity,
      latestResponse: latestResponse
    )
  }

  func agentActivity(for tabID: TerminalTabID) -> AgentActivity? {
    guard let tree = trees[tabID] else { return nil }
    let focusedSurfaceID = focusHistoryByTab[tabID]?.current
    return Self.preferredAgentActivityInstance(
      in: tree.leaves().flatMap { agentStateInstances(for: $0.id) },
      focusedSurfaceID: focusedSurfaceID
    )?.activity
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
    let resolvedState = resolvedAgentState(for: surfaceID)
    let instances = resolvedState.instances
    let current = resolvedState.currentInstance
    let workingDirectoryPath = agentPanelWorkingDirectoryPath(
      for: surfaceID,
      agentWorkingDirectoryPath: current?.nativePresentation?.workingDirectoryPath
    )
    let actionableSessions: [PaneAgentPanelSession] = instances.compactMap { instance in
      guard let nativePresentation = instance.nativePresentation,
        nativePresentation.isActionable
      else {
        return nil
      }
      return PaneAgentPanelSession.supported(
        agent: nativePresentation.agent,
        sessionID: nativePresentation.sessionID,
        workingDirectoryPath: agentPanelWorkingDirectoryPath(
          for: surfaceID,
          agentWorkingDirectoryPath: nativePresentation.workingDirectoryPath
        )
      )
    }
    let session = actionableSessions.count == 1 ? actionableSessions[0] : nil
    let presentation = metadata.panelPresentation(
      progressRows: current?.nativePresentation?.progressRows ?? [],
      workingDirectoryPath: workingDirectoryPath,
      session: session
    )
    guard !presentation.hasContentBesidesWorkspace,
      let current,
      current.hasActivity
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

  func agentPanelWorkspaceContext(for surfaceID: UUID) -> TerminalAgentPanelWorkspaceContext? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard surfaces[surfaceID] != nil else {
      return nil
    }
    guard tabID(containing: surfaceID) != nil else {
      return nil
    }
    guard
      !agentStateStore.snapshots(for: surfaceID).isEmpty
        || agentDetectionStore.observation(for: surfaceID) != nil
    else {
      return nil
    }
    let current = resolvedAgentState(for: surfaceID).currentInstance
    let workingDirectoryPath = agentPanelWorkingDirectoryPath(
      for: surfaceID,
      agentWorkingDirectoryPath: current?.nativePresentation?.workingDirectoryPath
    )
    return TerminalAgentPanelWorkspaceContext(workingDirectoryPath: workingDirectoryPath)
  }

  func panePortScanContext(for surfaceID: UUID) -> TerminalPanePortScanContext? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard surfaces[surfaceID] != nil else {
      return nil
    }
    guard tabID(containing: surfaceID) != nil else {
      return nil
    }
    let nativeProcessIdentities = agentStateStore.snapshots(for: surfaceID).reduce(
      into: Set<TerminalAgentProcessIdentity>()
    ) {
      $0.formUnion($1.processes)
    }
    return TerminalPanePortScanContext(
      nativeProcessIdentities: nativeProcessIdentities,
      fallbackProcessIdentity: agentDetectionStore.observation(for: surfaceID)?.processIdentity
    )
  }

  func paneForegroundProcessGroupID(for surfaceID: UUID) -> Int32? {
    surfaces[surfaceID]?.processIdentity.foregroundProcessGroupID
  }

  var agentPanelIsEnabled: Bool {
    supatermSettings.codingAgentsShowPanel
  }

  func agentPanelIsActive(for surfaceID: UUID) -> Bool {
    guard agentPanelIsEnabled else {
      return false
    }
    return !agentStateStore.snapshots(for: surfaceID).isEmpty
      || agentDetectionStore.observation(for: surfaceID) != nil
      || paneAgentMetadataBySurfaceID[surfaceID]?.isEmpty == false
  }

  func showsAgentActivityDetail(for tabID: TerminalTabID) -> Bool {
    tabAgentPresentation(for: tabID).detailActivity != nil
  }

  func debugAgentSnapshot(for surfaceID: UUID) -> SupatermAppDebugSnapshot.Agent? {
    guard
      let instance = resolvedAgentState(for: surfaceID).currentInstance,
      let presentation = instance.nativePresentation
    else {
      return nil
    }
    return SupatermAppDebugSnapshot.Agent(
      kind: presentation.agent,
      sessionID: presentation.sessionID,
      phase: debugAgentPhase(instance.activity.phase)
    )
  }

  @discardableResult
  func clearAgentState(for surfaceID: UUID) -> Bool {
    let hadNativeState = !agentStateStore.snapshots(for: surfaceID).isEmpty
    let removedDetection = agentDetectionStore.clear(for: surfaceID)
    agentStateStore.clearSessions(for: surfaceID)
    if hadNativeState || removedDetection {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return hadNativeState
  }

  @discardableResult
  func pruneDeadAgentProcesses(
    isProcessCurrent: (TerminalAgentProcessIdentity) -> Bool =
      TerminalAgentProcessInspector.isCurrent
  ) -> Bool {
    let nativeChangedSurfaceIDs = agentStateStore.pruneDeadProcesses(
      isProcessCurrent: isProcessCurrent
    )
    let detectionChangedSurfaceIDs = agentDetectionStore.pruneDeadProcesses(
      isProcessCurrent: isProcessCurrent
    )
    let changedSurfaceIDs = nativeChangedSurfaceIDs.union(detectionChangedSurfaceIDs)
    for surfaceID in changedSurfaceIDs {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return !nativeChangedSurfaceIDs.isEmpty
  }

  @discardableResult
  func applyAgentDetection(
    _ observation: TerminalAgentDetectionObservation,
    for surfaceID: UUID
  ) -> Bool {
    guard surfaces[surfaceID] != nil, tabID(containing: surfaceID) != nil else {
      return false
    }
    guard agentDetectionStore.apply(observation, for: surfaceID) else { return false }
    agentPanelController?.surfaceAgentStateChanged(surfaceID)
    return true
  }

  @discardableResult
  func clearAgentDetection(for surfaceID: UUID) -> Bool {
    guard agentDetectionStore.clear(for: surfaceID) else { return false }
    agentPanelController?.surfaceAgentStateChanged(surfaceID)
    return true
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

  static func tabAgentStatusPriority(_ status: TabAgentStatus) -> Int {
    switch status {
    case .needsInput:
      return 3
    case .done:
      return 2
    case .working:
      return 1
    }
  }

  private static func preferredAgentActivityInstance(
    in instances: [AgentStateInstance],
    focusedSurfaceID: UUID?
  ) -> AgentStateInstance? {
    instances.filter(\.hasActivity).max { lhs, rhs in
      let lhsPriority = agentActivityPriority(lhs.activity.phase)
      let rhsPriority = agentActivityPriority(rhs.activity.phase)
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
  }

  private func agentInstanceIsFocused(
    _ instance: AgentStateInstance,
    in tabID: TerminalTabID,
    focusedSurfaceID: UUID?
  ) -> Bool {
    guard let surface = surfaces[instance.surfaceID] else { return false }
    return Self.surfaceActivity(
      isSelectedTab: tabID == spaceManager.selectedTabID,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusedSurfaceID,
      surface: surface
    ).isFocused
  }

  private func tabAgentStatus(
    for instance: AgentStateInstance,
    isFocused: Bool
  ) -> TabAgentStatus? {
    switch instance.activity.phase {
    case .needsInput:
      return isFocused ? nil : .needsInput
    case .running:
      return .working
    case .idle:
      guard
        !isFocused,
        let lifecycle = instance.nativePresentation?.turnLifecycle,
        case .completed = lifecycle,
        notificationStore.notifications(for: instance.surfaceID)?.contains(where: {
          $0.attentionState == .unread && $0.origin == .structuredAgent(.completion)
        }) == true
      else {
        return nil
      }
      return .done
    }
  }

  @discardableResult
  func applyAgentEvent(_ event: TerminalAgentEvent) -> TerminalAgentEventApplication {
    let previousSurfaceID = agentStateStore.surfaceID(
      agent: event.scope.agent,
      sessionID: event.scope.sessionID
    )
    if let contextSurfaceID = event.context?.surfaceID,
      tabID(containing: contextSurfaceID) == nil
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

  func hasAgentSession(agent: SupatermAgentKind, sessionID: String) -> Bool {
    agentStateStore.hasSession(agent: agent, sessionID: sessionID)
  }

  func foregroundAgentWorkingDirectoryPath(
    agent: SupatermAgentKind,
    processID: Int32,
    for surfaceID: UUID
  ) -> String? {
    agentStateStore.snapshots(for: surfaceID).first {
      $0.agent == agent && $0.isForeground && $0.processIDs.contains(processID)
    }?.workingDirectoryPath
  }

  func agentSessionIsForeground(agent: SupatermAgentKind, sessionID: String) -> Bool {
    agentStateStore.isForeground(agent: agent, sessionID: sessionID)
  }

  func agentSessionHasBackgroundWork(agent: SupatermAgentKind, sessionID: String) -> Bool {
    agentStateStore.hasBackgroundWork(agent: agent, sessionID: sessionID)
  }

  func resolvedAgentState(for surfaceID: UUID) -> ResolvedAgentState {
    let nativeCandidates = nativeAgentDetectionCandidates(for: surfaceID)
    let resolution = agentDetectionStore.resolve(
      for: surfaceID,
      nativeCandidates: nativeCandidates,
      provenProcessIdentity: agentDetectionController?.provenProcessIdentity(for: surfaceID)
    )
    switch resolution {
    case .native(let candidates):
      let sortedCandidates = candidates.sorted {
        AgentDetectionAgentIdentity($0.presentation.agent).id
          < AgentDetectionAgentIdentity($1.presentation.agent).id
      }
      let currentCandidate = sortedCandidates.max { $0.revision < $1.revision }
      let instances = sortedCandidates.map { candidate in
        agentStateInstance(candidate, surfaceID: surfaceID)
      }
      return ResolvedAgentState(
        resolution: resolution,
        instances: instances,
        currentInstance: currentCandidate.map {
          agentStateInstance($0, surfaceID: surfaceID)
        },
        currentNativeCandidate: currentCandidate
      )
    case .terminal(let observation, let nativeDetails):
      let nativePresentation = nativeDetails?.presentation
      let instance = AgentStateInstance(
        activity: AgentActivity(
          identity: observation.agent,
          phase: observation.phase,
          detail: nativePresentation?.detail
        ),
        nativePresentation: nativePresentation,
        phaseSource: .terminal,
        revision: observation.sequence,
        surfaceID: surfaceID
      )
      return ResolvedAgentState(
        resolution: resolution,
        instances: [instance],
        currentInstance: instance,
        currentNativeCandidate: nil
      )
    }
  }

  func nativeAgentDetectionCandidates(
    for surfaceID: UUID
  ) -> [TerminalAgentDetectionNativeCandidate] {
    agentStateStore.snapshots(for: surfaceID).compactMap {
      snapshot -> TerminalAgentDetectionNativeCandidate? in
      guard snapshot.isForeground,
        let presentation = agentStateStore.presentation(for: surfaceID, agent: snapshot.agent)
      else {
        return nil
      }
      return TerminalAgentDetectionNativeCandidate(
        presentation: presentation,
        revision: snapshot.revision,
        processIdentities: snapshot.processes,
        phaseAuthorityProcessIdentities: agentStateStore.phaseAuthorityProcessIdentities(
          for: surfaceID,
          agent: snapshot.agent,
          sessionID: presentation.sessionID
        )
      )
    }
  }

  private func agentStateInstance(
    _ candidate: TerminalAgentDetectionNativeCandidate,
    surfaceID: UUID
  ) -> AgentStateInstance {
    let presentation = candidate.presentation
    return AgentStateInstance(
      activity: AgentActivity(
        agent: presentation.agent,
        phase: presentation.phase,
        detail: presentation.detail
      ),
      nativePresentation: presentation,
      phaseSource: .native,
      revision: UInt64(max(0, candidate.revision)),
      surfaceID: surfaceID
    )
  }

  private func agentStateInstances(for surfaceID: UUID) -> [AgentStateInstance] {
    resolvedAgentState(for: surfaceID).instances
  }

  private func debugAgentPhase(
    _ phase: AgentActivityPhase
  ) -> SupatermAppDebugSnapshot.AgentPhase {
    switch phase {
    case .idle:
      return .idle
    case .running:
      return .running
    case .needsInput:
      return .needsInput
    }
  }

  private func agentPanelWorkingDirectoryPath(
    for surfaceID: UUID,
    agentWorkingDirectoryPath: String?
  ) -> String? {
    TerminalAgentPanelWorkspaceKey(
      workingDirectoryPath: agentWorkingDirectoryPath ?? surfaces[surfaceID]?.bridge.state.pwd
    )?.workingDirectoryPath
  }

  private static func latestAgentResponse(
    agent: AgentDetectionAgentIdentity,
    text: String?
  ) -> TabAgentResponse? {
    text.map { TabAgentResponse(agent: agent, text: $0) }
  }

  func storePaneAgentMetadata(_ metadata: PaneAgentMetadata, for surfaceID: UUID) {
    if metadata.isEmpty {
      paneAgentMetadataBySurfaceID.removeValue(forKey: surfaceID)
    } else {
      paneAgentMetadataBySurfaceID[surfaceID] = metadata
    }
  }
}
