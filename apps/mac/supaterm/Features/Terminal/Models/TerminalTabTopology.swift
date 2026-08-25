import SupatermCLIShared

struct TerminalTabTopology: Equatable {
  struct ExtractedTabs {
    let tabIDs: [TerminalTabID]
    let tabsByID: [TerminalTabID: TerminalTabItem]
  }

  var tabsByID: [TerminalTabID: TerminalTabItem] = [:]
  var pinnedTabIDs: [TerminalTabID] = []
  var regularTabIDs: [TerminalTabID] = []
  var revision: UInt64 = 0

  func layout(orderedProjectIDs: [TerminalProjectID]) -> SupatermProjectLayoutResult<
    TerminalTabID, TerminalProjectID
  > {
    SupatermProjectLayout.make(
      orderedProjectIDs: orderedProjectIDs,
      pinnedTabs: records(for: pinnedTabIDs),
      regularTabs: records(for: regularTabIDs)
    )
  }

  func placement(
    of tabID: TerminalTabID,
    orderedProjectIDs: [TerminalProjectID]
  ) -> TerminalTabPlacement? {
    let isPinned: Bool
    if pinnedTabIDs.contains(tabID) {
      isPinned = true
    } else if regularTabIDs.contains(tabID) {
      isPinned = false
    } else {
      return nil
    }
    guard let tab = tabsByID[tabID] else { return nil }
    let knownProjectIDs = Set(orderedProjectIDs)
    let projectID = tab.projectID.flatMap { knownProjectIDs.contains($0) ? $0 : nil }
    let lane = isPinned ? pinnedTabIDs : regularTabIDs
    let sectionIDs = lane.filter {
      guard let item = tabsByID[$0] else { return false }
      if let projectID {
        return item.projectID == projectID
      }
      return item.projectID.map(knownProjectIDs.contains) != true
    }
    guard let index = sectionIDs.firstIndex(of: tabID) else { return nil }
    return TerminalTabPlacement(projectID: projectID, isPinned: isPinned, index: index)
  }

  mutating func apply(_ request: TerminalTabMoveRequest) throws {
    guard request.expectedTopologyRevision == revision else {
      throw TerminalTabMoveError.staleTopology(
        expected: request.expectedTopologyRevision,
        actual: revision
      )
    }
    guard !request.tabIDs.isEmpty else { throw TerminalTabMoveError.emptyTabs }
    var seenTabIDs: Set<TerminalTabID> = []
    for tabID in request.tabIDs {
      guard seenTabIDs.insert(tabID).inserted else {
        throw TerminalTabMoveError.duplicateTab(tabID)
      }
      guard tabsByID[tabID] != nil else { throw TerminalTabMoveError.tabNotFound(tabID) }
    }
    do {
      let result = try SupatermProjectLayout.move(
        orderedProjectIDs: request.orderedProjectIDs,
        pinnedTabs: records(for: pinnedTabIDs),
        regularTabs: records(for: regularTabIDs),
        movingTabIDs: request.tabIDs,
        destination: request.destination
      )
      pinnedTabIDs = result.pinnedTabs.map(\.id)
      regularTabIDs = result.regularTabs.map(\.id)
      let pinnedTabIDSet = Set(pinnedTabIDs)
      for record in result.pinnedTabs + result.regularTabs {
        tabsByID[record.id]?.projectID = record.projectID
        tabsByID[record.id]?.isPinned = pinnedTabIDSet.contains(record.id)
      }
    } catch SupatermProjectTabMoveError.unknownProject {
      throw TerminalTabMoveError.staleProjects
    } catch {
      throw TerminalTabMoveError.invalidDestination(request.destination)
    }
  }

  mutating func extract(_ tabIDs: [TerminalTabID]) throws -> ExtractedTabs {
    guard !tabIDs.isEmpty else { throw TerminalTabMoveError.emptyTabs }
    var seenTabIDs: Set<TerminalTabID> = []
    var extractedTabsByID: [TerminalTabID: TerminalTabItem] = [:]
    let canonicalIDs = pinnedTabIDs + regularTabIDs
    let requestedIDs = Set(tabIDs)
    for tabID in tabIDs {
      guard seenTabIDs.insert(tabID).inserted else {
        throw TerminalTabMoveError.duplicateTab(tabID)
      }
      guard let tab = tabsByID[tabID] else { throw TerminalTabMoveError.tabNotFound(tabID) }
      extractedTabsByID[tabID] = tab
    }
    let orderedTabIDs = canonicalIDs.filter(requestedIDs.contains)
    pinnedTabIDs.removeAll(where: requestedIDs.contains)
    regularTabIDs.removeAll(where: requestedIDs.contains)
    for tabID in requestedIDs {
      tabsByID[tabID] = nil
    }
    return ExtractedTabs(tabIDs: orderedTabIDs, tabsByID: extractedTabsByID)
  }

  mutating func insert(
    _ extracted: ExtractedTabs,
    orderedProjectIDs: [TerminalProjectID],
    at destination: TerminalTabTransferDestination
  ) throws {
    switch destination {
    case .assign(let projectID):
      try insert(extracted, orderedProjectIDs: orderedProjectIDs, assigning: projectID)
    case .move(let placement):
      try insert(extracted, orderedProjectIDs: orderedProjectIDs, movingTo: placement)
    case .preserve:
      try insertPreserving(extracted, orderedProjectIDs: orderedProjectIDs)
    }
  }

  private mutating func insert(
    _ extracted: ExtractedTabs,
    orderedProjectIDs: [TerminalProjectID],
    movingTo destination: TerminalTabPlacement
  ) throws {
    for tabID in extracted.tabIDs {
      guard tabsByID[tabID] == nil else {
        throw TerminalTabTransferError.destinationContainsTab(tabID)
      }
      tabsByID[tabID] = extracted.tabsByID[tabID]
      regularTabIDs.append(tabID)
    }
    try apply(
      TerminalTabMoveRequest(
        expectedTopologyRevision: revision,
        orderedProjectIDs: orderedProjectIDs,
        tabIDs: extracted.tabIDs,
        destination: destination
      )
    )
  }

  private mutating func insert(
    _ extracted: ExtractedTabs,
    orderedProjectIDs: [TerminalProjectID],
    assigning projectID: TerminalProjectID?
  ) throws {
    let knownProjectIDs = Set(orderedProjectIDs)
    if let projectID, !knownProjectIDs.contains(projectID) {
      throw TerminalTabMoveError.staleProjects
    }
    let orderedTabIDs = orderedTabIDs(in: extracted, orderedProjectIDs: orderedProjectIDs)
    try validateInsertion(of: orderedTabIDs, from: extracted)
    for tabID in orderedTabIDs {
      guard var tab = extracted.tabsByID[tabID] else {
        throw TerminalTabMoveError.tabNotFound(tabID)
      }
      tab.projectID = projectID
      tabsByID[tabID] = tab
    }
    let pinnedTabIDs = orderedTabIDs.filter { tabsByID[$0]?.isPinned == true }
    let regularTabIDs = orderedTabIDs.filter { tabsByID[$0]?.isPinned == false }
    insertAtSectionEnd(
      pinnedTabIDs,
      isPinned: true,
      projectID: projectID,
      knownProjectIDs: knownProjectIDs
    )
    insertAtSectionEnd(
      regularTabIDs,
      isPinned: false,
      projectID: projectID,
      knownProjectIDs: knownProjectIDs
    )
  }

  private mutating func insertPreserving(
    _ extracted: ExtractedTabs,
    orderedProjectIDs: [TerminalProjectID]
  ) throws {
    let knownProjectIDs = Set(orderedProjectIDs)
    let orderedTabIDs = orderedTabIDs(in: extracted, orderedProjectIDs: orderedProjectIDs)
    try validateInsertion(of: orderedTabIDs, from: extracted)
    for tabID in orderedTabIDs {
      guard let tab = extracted.tabsByID[tabID] else {
        throw TerminalTabMoveError.tabNotFound(tabID)
      }
      tabsByID[tabID] = tab
      insertAtSectionEnd(
        [tabID],
        isPinned: tab.isPinned,
        projectID: tab.projectID.flatMap { knownProjectIDs.contains($0) ? $0 : nil },
        knownProjectIDs: knownProjectIDs
      )
    }
  }

  private func orderedTabIDs(
    in extracted: ExtractedTabs,
    orderedProjectIDs: [TerminalProjectID]
  ) -> [TerminalTabID] {
    SupatermProjectLayout.make(
      orderedProjectIDs: orderedProjectIDs,
      pinnedTabs: extracted.tabIDs.compactMap { tabID in
        guard let tab = extracted.tabsByID[tabID], tab.isPinned else { return nil }
        return SupatermProjectTabRecord(id: tabID, projectID: tab.projectID)
      },
      regularTabs: extracted.tabIDs.compactMap { tabID in
        guard let tab = extracted.tabsByID[tabID], !tab.isPinned else { return nil }
        return SupatermProjectTabRecord(id: tabID, projectID: tab.projectID)
      }
    ).semanticTabIDs
  }

  private func validateInsertion(
    of tabIDs: [TerminalTabID],
    from extracted: ExtractedTabs
  ) throws {
    for tabID in tabIDs {
      guard tabsByID[tabID] == nil else {
        throw TerminalTabTransferError.destinationContainsTab(tabID)
      }
      guard extracted.tabsByID[tabID] != nil else {
        throw TerminalTabMoveError.tabNotFound(tabID)
      }
    }
  }

  private mutating func insertAtSectionEnd(
    _ tabIDs: [TerminalTabID],
    isPinned: Bool,
    projectID: TerminalProjectID?,
    knownProjectIDs: Set<TerminalProjectID>
  ) {
    guard !tabIDs.isEmpty else { return }
    var lane = isPinned ? pinnedTabIDs : regularTabIDs
    let lastSectionIndex = lane.lastIndex { tabID in
      guard let tab = tabsByID[tabID] else { return false }
      if let projectID { return tab.projectID == projectID }
      return tab.projectID.map(knownProjectIDs.contains) != true
    }
    lane.insert(contentsOf: tabIDs, at: lastSectionIndex.map { $0 + 1 } ?? lane.endIndex)
    if isPinned {
      pinnedTabIDs = lane
    } else {
      regularTabIDs = lane
    }
  }

  mutating func append(_ tab: TerminalTabItem, isPinned: Bool) {
    var tab = tab
    tab.isPinned = isPinned
    tabsByID[tab.id] = tab
    if isPinned {
      pinnedTabIDs.append(tab.id)
    } else {
      regularTabIDs.append(tab.id)
    }
  }

  mutating func remove(_ tabID: TerminalTabID) {
    tabsByID[tabID] = nil
    pinnedTabIDs.removeAll { $0 == tabID }
    regularTabIDs.removeAll { $0 == tabID }
  }

  private func records(
    for tabIDs: [TerminalTabID]
  ) -> [SupatermProjectTabRecord<TerminalTabID, TerminalProjectID>] {
    tabIDs.compactMap { tabID in
      tabsByID[tabID].map {
        SupatermProjectTabRecord(id: tabID, projectID: $0.projectID)
      }
    }
  }
}
