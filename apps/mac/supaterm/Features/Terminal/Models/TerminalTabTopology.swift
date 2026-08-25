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
        destination: SupatermProjectTabPlacement(
          projectID: request.destination.projectID,
          isPinned: request.destination.isPinned,
          index: request.destination.index
        )
      )
      pinnedTabIDs = result.pinnedTabs.map(\.id)
      regularTabIDs = result.regularTabs.map(\.id)
      for record in result.pinnedTabs + result.regularTabs {
        tabsByID[record.id]?.projectID = record.projectID
        tabsByID[record.id]?.isPinned = result.pinnedTabs.contains { $0.id == record.id }
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
    at destination: TerminalTabPlacement
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
