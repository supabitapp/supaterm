import Foundation
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalAgentPanelFeature
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature

extension TerminalHostState {
  public func tabAgentPresentation(for tabID: TerminalTabID) -> TabAgentPresentation {
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
    let detailActivity = agentPresenceStore.detailActivity(for: focusedSurfaceID)
    let hoverMarkdown = focusedSurfaceID.flatMap {
      Self.codexHoverMarkdown(
        paneAgentMetadataBySurfaceID[$0]?.agentHoverMessages ?? []
      )
    }
    let leaves = tree.leaves()
    let badgeActivities =
      agentPresenceStore
      .badgeInstances(across: leaves.map(\.id))
      .map(\.activity)
    let badgeInstance =
      leaves
      .enumerated()
      .flatMap { leafIndex, surface in
        agentPresenceStore.statusInstances(for: surface.id, surfaceIndex: leafIndex)
      }
      .max { lhs, rhs in
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

        if lhs.revision != rhs.revision {
          return lhs.revision < rhs.revision
        }

        return lhs.surfaceIndex > rhs.surfaceIndex
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

  public func agentActivity(for tabID: TerminalTabID) -> AgentActivity? {
    tabAgentPresentation(for: tabID).badgeActivity
  }

  func codexHoverMarkdown(for tabID: TerminalTabID) -> String? {
    tabAgentPresentation(for: tabID).hoverMarkdown
  }

  public func agentPanelPresentations(for tabID: TerminalTabID) -> [UUID: PaneAgentPanelPresentation] {
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

  public func agentPanelPresentation(for surfaceID: UUID) -> PaneAgentPanelPresentation? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard agentPanelIsActive(for: surfaceID) else {
      return nil
    }
    let metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    let session = agentPresenceStore.panelSession(for: surfaceID)
    let presentation = metadata.panelPresentation(session: session)
    if !presentation.isEmpty {
      return presentation
    }
    guard let activity = agentPresenceStore.detailActivity(for: surfaceID) else {
      return nil
    }
    switch activity.phase {
    case .running:
      return PaneAgentPanelPresentation(
        progressRows: [
          PaneAgentProgressRow(
            id: "agent-session-running",
            title: activity.detail ?? "Starting session",
            status: .running
          )
        ]
      )
    case .needsInput:
      return PaneAgentPanelPresentation(
        progressRows: [
          PaneAgentProgressRow(
            id: "agent-session-needs-input",
            title: activity.detail ?? "Needs input",
            status: .pending
          )
        ]
      )
    case .idle:
      return nil
    }
  }

  public func agentPanelSession(for surfaceID: UUID) -> PaneAgentPanelSession? {
    agentPanelPresentation(for: surfaceID)?.session
  }

  public func hasAgentPanelPresentation(for surfaceID: UUID) -> Bool {
    agentPanelPresentation(for: surfaceID) != nil
  }

  public func agentPanelPreservesSeededState(_ surfaceID: UUID) -> Bool {
    #if SUPATERM_DEMO
      DemoSeed.preservesSeededAgentState(surfaceID)
    #else
      false
    #endif
  }

  public func agentPanelRefreshContext(for surfaceID: UUID) -> TerminalAgentPanelRefreshContext? {
    guard agentPanelIsEnabled else {
      return nil
    }
    guard let surface = surfaces[surfaceID] else {
      return nil
    }
    guard tabID(containing: surfaceID) != nil else {
      return nil
    }
    guard agentPanelIsActive(for: surfaceID) else {
      return nil
    }
    let pwd = surface.bridge.state.pwd?.trimmingCharacters(in: .whitespacesAndNewlines)
    let processIDs = agentPresenceStore.processIDs(for: surfaceID)
    return TerminalAgentPanelRefreshContext(
      workingDirectoryPath: pwd,
      processIDs: processIDs
    )
  }

  public var agentPanelIsEnabled: Bool {
    supatermSettings.codingAgentsShowPanel
  }

  func agentPanelIsActive(for surfaceID: UUID) -> Bool {
    guard agentPanelIsEnabled else {
      return false
    }
    return agentPresenceStore.hasInstances(for: surfaceID)
      || paneAgentMetadataBySurfaceID[surfaceID]?.hasStructuredPanelContent == true
  }

  func showsAgentActivityDetail(for tabID: TerminalTabID) -> Bool {
    tabAgentPresentation(for: tabID).detailActivity != nil
  }

  @discardableResult
  public func registerAgentPresence(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    let changed = agentPresenceStore.register(
      agent: agent,
      surfaceID: surfaceID,
      sessionID: sessionID,
      processID: processID
    )
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  public func setAgentPresenceActivity(
    _ activity: AgentActivity,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    let changed = agentPresenceStore.setActivity(
      activity,
      surfaceID: surfaceID,
      sessionID: sessionID,
      processID: processID
    )
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  public func markAgentSessionActionable(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    let changed = agentPresenceStore.markActionable(
      agent: agent,
      surfaceID: surfaceID,
      sessionID: sessionID,
      processID: processID
    )
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  public func clearAgentPresence(
    agent: SupatermAgentKind,
    for surfaceID: UUID,
    sessionID: String?,
    processID: Int32?
  ) -> Bool {
    let changed = agentPresenceStore.remove(
      agent: agent,
      surfaceID: surfaceID,
      sessionID: sessionID,
      processID: processID
    )
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  public func clearAgentPresence(for surfaceID: UUID) -> Bool {
    let changed = agentPresenceStore.removeSurface(surfaceID)
    if changed {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return changed
  }

  @discardableResult
  public func pruneDeadAgentProcesses() -> Bool {
    pruneDeadAgentProcesses(isProcessAlive: TerminalAgentPresenceStore.isProcessAlive)
  }

  @discardableResult
  func pruneDeadAgentProcesses(isProcessAlive: (Int32) -> Bool) -> Bool {
    let changedSurfaceIDs = agentPresenceStore.pruneDeadProcesses(isProcessAlive: isProcessAlive)
    for surfaceID in changedSurfaceIDs {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return !changedSurfaceIDs.isEmpty
  }

  public func agentPresenceSnapshotsBySurfaceID() -> [UUID: [TerminalPaneAgentRecord]] {
    Dictionary(
      uniqueKeysWithValues: liveSurfaceIDs().map { surfaceID in
        (surfaceID, agentPresenceStore.snapshot(for: surfaceID))
      }
    )
    .filter { !$0.value.isEmpty }
  }

  public var hasActiveAgentWorkForQuit: Bool {
    agentPresenceStore.hasActiveWorkForQuit
  }

  @discardableResult
  public func recordAgentHoverMessages(
    _ messages: [String],
    replacing: Bool,
    for surfaceID: UUID
  ) -> Bool {
    guard tabID(containing: surfaceID) != nil else { return false }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    var nextMessages = replacing ? [] : metadata.agentHoverMessages
    for message in messages.compactMap(normalizedTerminalAgentDetail) where nextMessages.last != message {
      nextMessages.append(message)
    }
    metadata.agentHoverMessages = nextMessages
    storePaneAgentMetadata(metadata, for: surfaceID)
    return true
  }

  @discardableResult
  public func recordAgentPanelSnapshot(
    progressRows: [PaneAgentProgressRow],
    for surfaceID: UUID
  ) -> Bool {
    guard agentPanelIsEnabled || progressRows.isEmpty else {
      return false
    }
    guard tabID(containing: surfaceID) != nil else {
      return false
    }
    var metadata = paneAgentMetadataBySurfaceID[surfaceID] ?? PaneAgentMetadata()
    let original = metadata
    metadata.progressRows = progressRows
    storePaneAgentMetadata(metadata, for: surfaceID)
    if metadata != original {
      agentPanelController?.surfaceAgentStateChanged(surfaceID)
    }
    return true
  }

  @discardableResult
  public func storeAgentPanelBranchDetails(
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
  public func storeAgentPanelArtifacts(
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
  public func clearAgentPanelMetadata(for surfaceID: UUID) -> Bool {
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
