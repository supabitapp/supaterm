import Observation

@MainActor
@Observable
final class TerminalTabCollection {
  struct ExtractionPlan {
    fileprivate let expectedTopologyRevision: UInt64
    fileprivate let topology: TerminalTabTopology
  }

  struct TransferPlan {
    fileprivate let destinationTopology: TerminalTabTopology
    fileprivate let expectedDestinationRevision: UInt64
    fileprivate let expectedSourceRevision: UInt64
    fileprivate let sourceTopology: TerminalTabTopology
    let result: TerminalTabTransferResult
  }

  private var topology = TerminalTabTopology()
  private(set) var selectedTabID: TerminalTabID?

  var topologyRevision: UInt64 { topology.revision }

  var snapshot: TerminalTabCollectionSnapshot {
    TerminalTabCollectionSnapshot(
      pinnedTabs: topology.pinnedTabIDs.compactMap { topology.tabsByID[$0] },
      regularTabs: topology.regularTabIDs.compactMap { topology.tabsByID[$0] },
      selectedTabID: selectedTabID,
      topologyRevision: topologyRevision
    )
  }

  var canonicalTabs: [TerminalTabItem] { snapshot.canonicalTabs }

  func tabs(orderedProjectIDs: [TerminalProjectID]) -> [TerminalTabItem] {
    snapshot.tabs(orderedProjectIDs: orderedProjectIDs)
  }

  func sections(projects: [TerminalProject]) -> [TerminalProjectSectionItem] {
    let projectByID = Dictionary(uniqueKeysWithValues: projects.map { ($0.id, $0) })
    let tabsByID = topology.tabsByID
    return topology.layout(orderedProjectIDs: projects.map(\.id)).sections.compactMap { section in
      guard let projectID = section.projectID, let project = projectByID[projectID] else {
        return nil
      }
      return TerminalProjectSectionItem(
        project: project,
        tabs: section.tabIDs.compactMap { tabsByID[$0] }
      )
    }
  }

  func unassignedSection(orderedProjectIDs: [TerminalProjectID]) -> TerminalUnassignedSectionItem? {
    guard
      let section = topology.layout(orderedProjectIDs: orderedProjectIDs).sections.first(where: {
        $0.projectID == nil
      })
    else { return nil }
    return TerminalUnassignedSectionItem(tabs: section.tabIDs.compactMap { topology.tabsByID[$0] })
  }

  func createTab(
    title: String,
    projectID: TerminalProjectID? = nil,
    isTitleLocked: Bool = false,
    isPinned: Bool = false
  ) -> TerminalTabID {
    let tab = TerminalTabItem(
      title: title,
      projectID: projectID,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    topology.append(tab, isPinned: isPinned)
    topology.revision += 1
    selectedTabID = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard topology.tabsByID[id] != nil else { return }
    selectedTabID = id
  }

  func clearSelection() {
    selectedTabID = nil
  }

  func updateTitle(_ id: TerminalTabID, title: String) {
    updateTab(id) { tab in
      guard !tab.isTitleLocked else { return }
      tab.title = title
    }
  }

  func setLockedTitle(_ id: TerminalTabID, title: String?) {
    updateTab(id) { tab in
      tab.isTitleLocked = title != nil
      if let title { tab.title = title }
    }
  }

  func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    updateTab(id) { $0.isDirty = isDirty }
  }

  @discardableResult
  func move(_ request: TerminalTabMoveRequest) throws -> TerminalTabMoveResult {
    var next = topology
    try next.apply(request)
    if next != topology {
      next.revision = topology.revision + 1
      topology = next
      repairSelection(orderedProjectIDs: request.orderedProjectIDs)
    }
    return TerminalTabMoveResult(
      operationID: request.operationID,
      tabIDs: request.tabIDs,
      location: request.destination,
      topologyRevision: topology.revision
    )
  }

  @discardableResult
  func assign(
    _ tabIDs: [TerminalTabID],
    to projectID: TerminalProjectID?,
    orderedProjectIDs: [TerminalProjectID]
  ) -> Bool {
    let tabIDSet = Set(tabIDs)
    guard tabIDSet.count == tabIDs.count, tabIDs.allSatisfy({ topology.tabsByID[$0] != nil })
    else { return false }
    var next = topology
    let knownProjectIDs = Set(orderedProjectIDs)
    for isPinned in [true, false] {
      let lane = isPinned ? next.pinnedTabIDs : next.regularTabIDs
      let movingIDs = lane.filter(tabIDSet.contains)
      guard !movingIDs.isEmpty else { continue }
      let destinationCount = lane.count { tabID in
        guard !tabIDSet.contains(tabID), let tab = next.tabsByID[tabID] else { return false }
        if let projectID { return tab.projectID == projectID }
        return tab.projectID.map(knownProjectIDs.contains) != true
      }
      let request = TerminalTabMoveRequest(
        expectedTopologyRevision: next.revision,
        orderedProjectIDs: orderedProjectIDs,
        tabIDs: movingIDs,
        destination: TerminalTabPlacement(
          projectID: projectID,
          isPinned: isPinned,
          index: destinationCount
        )
      )
      guard (try? next.apply(request)) != nil else { return false }
    }
    guard next != topology else { return false }
    next.revision = topology.revision + 1
    topology = next
    repairSelection(orderedProjectIDs: orderedProjectIDs)
    return true
  }

  @discardableResult
  func setTabPinned(
    _ id: TerminalTabID,
    isPinned: Bool,
    orderedProjectIDs: [TerminalProjectID]
  ) -> TerminalTabMoveResult? {
    guard
      let current = topology.placement(of: id, orderedProjectIDs: orderedProjectIDs),
      current.isPinned != isPinned
    else { return nil }
    let knownProjectIDs = Set(orderedProjectIDs)
    let lane = isPinned ? topology.pinnedTabIDs : topology.regularTabIDs
    let destinationCount = lane.count { tabID in
      guard let tab = topology.tabsByID[tabID] else { return false }
      if let projectID = current.projectID { return tab.projectID == projectID }
      return tab.projectID.map(knownProjectIDs.contains) != true
    }
    return try? move(
      TerminalTabMoveRequest(
        expectedTopologyRevision: topology.revision,
        orderedProjectIDs: orderedProjectIDs,
        tabIDs: [id],
        destination: TerminalTabPlacement(
          projectID: current.projectID,
          isPinned: isPinned,
          index: destinationCount
        )
      )
    )
  }

  @discardableResult
  func closeTab(
    _ id: TerminalTabID,
    orderedProjectIDs: [TerminalProjectID]
  ) -> Bool {
    let previousTabs = tabs(orderedProjectIDs: orderedProjectIDs)
    guard let index = previousTabs.firstIndex(where: { $0.id == id }) else { return false }
    let wasSelected = selectedTabID == id
    topology.remove(id)
    topology.revision += 1
    if wasSelected {
      let remainingTabs = tabs(orderedProjectIDs: orderedProjectIDs)
      if remainingTabs.indices.contains(index) {
        selectedTabID = remainingTabs[index].id
      } else {
        selectedTabID = remainingTabs.last?.id
      }
    }
    return true
  }

  func tabIDsBelow(_ id: TerminalTabID, orderedProjectIDs: [TerminalProjectID]) -> [TerminalTabID] {
    let tabs = tabs(orderedProjectIDs: orderedProjectIDs)
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return [] }
    let nextIndex = tabs.index(after: index)
    guard nextIndex < tabs.endIndex else { return [] }
    return Array(tabs[nextIndex...].map(\.id))
  }

  func tab(for id: TerminalTabID) -> TerminalTabItem? { topology.tabsByID[id] }

  func projectID(containing tabID: TerminalTabID) -> TerminalProjectID? {
    topology.tabsByID[tabID]?.projectID
  }

  func isPinned(_ tabID: TerminalTabID) -> Bool? { topology.tabsByID[tabID]?.isPinned }

  func placement(
    of tabID: TerminalTabID,
    orderedProjectIDs: [TerminalProjectID]
  ) -> TerminalTabPlacement? {
    topology.placement(of: tabID, orderedProjectIDs: orderedProjectIDs)
  }

  func restoreTabs(_ tabs: [TerminalTabItem], selectedTabID: TerminalTabID?) {
    var next = TerminalTabTopology(revision: topology.revision + 1)
    var seenTabIDs: Set<TerminalTabID> = []
    for tab in tabs.filter(\.isPinned) + tabs.filter({ !$0.isPinned })
    where seenTabIDs.insert(tab.id).inserted {
      next.append(tab, isPinned: tab.isPinned)
    }
    topology = next
    self.selectedTabID = selectedTabID.flatMap { next.tabsByID[$0]?.id } ?? tabs.first?.id
  }

  static func prepareTransfer(
    _ request: TerminalTabTransferRequest,
    from source: TerminalTabCollection,
    to destination: TerminalTabCollection
  ) throws -> TransferPlan {
    guard source !== destination else { throw TerminalTabTransferError.sameCollection }
    guard request.expectedSourceRevision == source.topology.revision else {
      throw TerminalTabTransferError.staleSource(
        expected: request.expectedSourceRevision,
        actual: source.topology.revision
      )
    }
    guard request.expectedDestinationRevision == destination.topology.revision else {
      throw TerminalTabTransferError.staleDestination(
        expected: request.expectedDestinationRevision,
        actual: destination.topology.revision
      )
    }
    var sourceTopology = source.topology
    var destinationTopology = destination.topology
    do {
      let extracted = try sourceTopology.extract(request.tabIDs)
      try destinationTopology.insert(
        extracted,
        orderedProjectIDs: request.orderedProjectIDs,
        at: request.destination
      )
    } catch let error as TerminalTabMoveError {
      throw TerminalTabTransferError.topology(error)
    }
    sourceTopology.revision += 1
    destinationTopology.revision += 1
    return TransferPlan(
      destinationTopology: destinationTopology,
      expectedDestinationRevision: request.expectedDestinationRevision,
      expectedSourceRevision: request.expectedSourceRevision,
      sourceTopology: sourceTopology,
      result: TerminalTabTransferResult(tabIDs: request.tabIDs)
    )
  }

  static func prepareExtraction(
    _ request: TerminalTabExtractionRequest,
    from source: TerminalTabCollection
  ) throws -> ExtractionPlan {
    guard request.expectedTopologyRevision == source.topology.revision else {
      throw TerminalTabTransferError.staleSource(
        expected: request.expectedTopologyRevision,
        actual: source.topology.revision
      )
    }
    var topology = source.topology
    do {
      _ = try topology.extract(request.tabIDs)
    } catch let error as TerminalTabMoveError {
      throw TerminalTabTransferError.topology(error)
    }
    topology.revision += 1
    return ExtractionPlan(
      expectedTopologyRevision: request.expectedTopologyRevision,
      topology: topology
    )
  }

  static func commitExtraction(
    _ plan: ExtractionPlan,
    from source: TerminalTabCollection
  ) throws {
    guard source.topology.revision == plan.expectedTopologyRevision else {
      throw TerminalTabTransferError.staleSource(
        expected: plan.expectedTopologyRevision,
        actual: source.topology.revision
      )
    }
    source.topology = plan.topology
    source.repairSelection(orderedProjectIDs: [])
  }

  @discardableResult
  static func commitTransfer(
    _ plan: TransferPlan,
    from source: TerminalTabCollection,
    to destination: TerminalTabCollection
  ) throws -> TerminalTabTransferResult {
    guard source !== destination else { throw TerminalTabTransferError.sameCollection }
    guard source.topology.revision == plan.expectedSourceRevision else {
      throw TerminalTabTransferError.staleSource(
        expected: plan.expectedSourceRevision,
        actual: source.topology.revision
      )
    }
    guard destination.topology.revision == plan.expectedDestinationRevision else {
      throw TerminalTabTransferError.staleDestination(
        expected: plan.expectedDestinationRevision,
        actual: destination.topology.revision
      )
    }
    source.topology = plan.sourceTopology
    destination.topology = plan.destinationTopology
    source.repairSelection(orderedProjectIDs: [])
    destination.selectedTabID = plan.result.tabIDs.first
    return plan.result
  }

  private func updateTab(_ id: TerminalTabID, update: (inout TerminalTabItem) -> Void) {
    guard var tab = topology.tabsByID[id] else { return }
    update(&tab)
    topology.tabsByID[id] = tab
  }

  private func repairSelection(orderedProjectIDs: [TerminalProjectID]) {
    guard selectedTabID.flatMap({ topology.tabsByID[$0] }) == nil else { return }
    selectedTabID = tabs(orderedProjectIDs: orderedProjectIDs).first?.id
  }
}
