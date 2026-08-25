public struct SupatermProjectTabRecord<TabID: Hashable & Sendable, ProjectID: Hashable & Sendable>:
  Equatable, Sendable
{
  public let id: TabID
  public let projectID: ProjectID?

  public init(id: TabID, projectID: ProjectID?) {
    self.id = id
    self.projectID = projectID
  }
}

public struct SupatermProjectLayoutSection<
  TabID: Hashable & Sendable,
  ProjectID: Hashable & Sendable
>: Equatable, Sendable {
  public let projectID: ProjectID?
  public let pinnedTabIDs: [TabID]
  public let regularTabIDs: [TabID]

  public var tabIDs: [TabID] {
    pinnedTabIDs + regularTabIDs
  }
}

public struct SupatermProjectLayoutResult<
  TabID: Hashable & Sendable,
  ProjectID: Hashable & Sendable
>: Equatable, Sendable {
  public let sections: [SupatermProjectLayoutSection<TabID, ProjectID>]

  public var semanticTabIDs: [TabID] {
    sections.flatMap(\.tabIDs)
  }
}

public struct SupatermProjectTabPlacement<ProjectID: Hashable & Sendable>: Equatable, Sendable {
  public let projectID: ProjectID?
  public let isPinned: Bool
  public let index: Int

  public init(projectID: ProjectID?, isPinned: Bool, index: Int) {
    self.projectID = projectID
    self.isPinned = isPinned
    self.index = index
  }
}

public struct SupatermProjectTabMoveResult<
  TabID: Hashable & Sendable,
  ProjectID: Hashable & Sendable
>: Equatable, Sendable {
  public let pinnedTabs: [SupatermProjectTabRecord<TabID, ProjectID>]
  public let regularTabs: [SupatermProjectTabRecord<TabID, ProjectID>]
}

public enum SupatermProjectTabMoveError: Error, Equatable {
  case emptyTabs
  case duplicateTab
  case tabNotFound
  case unknownProject
  case invalidIndex
}

public enum SupatermProjectLayout {
  public static func make<TabID: Hashable & Sendable, ProjectID: Hashable & Sendable>(
    orderedProjectIDs: [ProjectID],
    pinnedTabs: [SupatermProjectTabRecord<TabID, ProjectID>],
    regularTabs: [SupatermProjectTabRecord<TabID, ProjectID>]
  ) -> SupatermProjectLayoutResult<TabID, ProjectID> {
    var knownProjectIDs: Set<ProjectID> = []
    let orderedProjectIDs = orderedProjectIDs.filter { knownProjectIDs.insert($0).inserted }
    var pinnedTabsByProjectID: [ProjectID: [TabID]] = [:]
    var regularTabsByProjectID: [ProjectID: [TabID]] = [:]
    var unassignedPinnedTabIDs: [TabID] = []
    var unassignedRegularTabIDs: [TabID] = []

    for tab in pinnedTabs {
      if let projectID = tab.projectID, knownProjectIDs.contains(projectID) {
        pinnedTabsByProjectID[projectID, default: []].append(tab.id)
      } else {
        unassignedPinnedTabIDs.append(tab.id)
      }
    }
    for tab in regularTabs {
      if let projectID = tab.projectID, knownProjectIDs.contains(projectID) {
        regularTabsByProjectID[projectID, default: []].append(tab.id)
      } else {
        unassignedRegularTabIDs.append(tab.id)
      }
    }

    var sections: [SupatermProjectLayoutSection<TabID, ProjectID>] =
      orderedProjectIDs.compactMap { projectID in
        let pinnedTabIDs = pinnedTabsByProjectID[projectID, default: []]
        let regularTabIDs = regularTabsByProjectID[projectID, default: []]
        guard !pinnedTabIDs.isEmpty || !regularTabIDs.isEmpty else { return nil }
        return SupatermProjectLayoutSection(
          projectID: projectID,
          pinnedTabIDs: pinnedTabIDs,
          regularTabIDs: regularTabIDs
        )
      }
    if !unassignedPinnedTabIDs.isEmpty || !unassignedRegularTabIDs.isEmpty {
      sections.append(
        SupatermProjectLayoutSection(
          projectID: nil,
          pinnedTabIDs: unassignedPinnedTabIDs,
          regularTabIDs: unassignedRegularTabIDs
        )
      )
    }
    return SupatermProjectLayoutResult(sections: sections)
  }

  public static func move<TabID: Hashable & Sendable, ProjectID: Hashable & Sendable>(
    orderedProjectIDs: [ProjectID],
    pinnedTabs: [SupatermProjectTabRecord<TabID, ProjectID>],
    regularTabs: [SupatermProjectTabRecord<TabID, ProjectID>],
    movingTabIDs: [TabID],
    destination: SupatermProjectTabPlacement<ProjectID>
  ) throws -> SupatermProjectTabMoveResult<TabID, ProjectID> {
    guard !movingTabIDs.isEmpty else { throw SupatermProjectTabMoveError.emptyTabs }
    guard Set(movingTabIDs).count == movingTabIDs.count else {
      throw SupatermProjectTabMoveError.duplicateTab
    }
    let tabs = pinnedTabs + regularTabs
    guard Set(tabs.map(\.id)).count == tabs.count else {
      throw SupatermProjectTabMoveError.duplicateTab
    }
    let tabsByID = Dictionary(uniqueKeysWithValues: tabs.map { ($0.id, $0) })
    guard movingTabIDs.allSatisfy({ tabsByID[$0] != nil }) else {
      throw SupatermProjectTabMoveError.tabNotFound
    }
    let knownProjectIDs = Set(orderedProjectIDs)
    if let projectID = destination.projectID, !knownProjectIDs.contains(projectID) {
      throw SupatermProjectTabMoveError.unknownProject
    }

    let semanticTabIDs = make(
      orderedProjectIDs: orderedProjectIDs,
      pinnedTabs: pinnedTabs,
      regularTabs: regularTabs
    ).semanticTabIDs
    let movingTabIDSet = Set(movingTabIDs)
    let orderedMovingTabs: [SupatermProjectTabRecord<TabID, ProjectID>] =
      semanticTabIDs.compactMap { tabID in
        guard movingTabIDSet.contains(tabID), let tab = tabsByID[tabID] else { return nil }
        return SupatermProjectTabRecord(id: tab.id, projectID: destination.projectID)
      }
    var remainingPinnedTabs = pinnedTabs.filter { !movingTabIDSet.contains($0.id) }
    var remainingRegularTabs = regularTabs.filter { !movingTabIDSet.contains($0.id) }
    if destination.isPinned {
      try insert(
        orderedMovingTabs,
        in: &remainingPinnedTabs,
        at: destination,
        knownProjectIDs: knownProjectIDs
      )
    } else {
      try insert(
        orderedMovingTabs,
        in: &remainingRegularTabs,
        at: destination,
        knownProjectIDs: knownProjectIDs
      )
    }
    return SupatermProjectTabMoveResult(
      pinnedTabs: remainingPinnedTabs,
      regularTabs: remainingRegularTabs
    )
  }

  private static func insert<TabID: Hashable & Sendable, ProjectID: Hashable & Sendable>(
    _ movingTabs: [SupatermProjectTabRecord<TabID, ProjectID>],
    in lane: inout [SupatermProjectTabRecord<TabID, ProjectID>],
    at destination: SupatermProjectTabPlacement<ProjectID>,
    knownProjectIDs: Set<ProjectID>
  ) throws {
    let sectionTabs = lane.filter { tab in
      if let projectID = destination.projectID {
        return tab.projectID == projectID
      }
      return tab.projectID.map(knownProjectIDs.contains) != true
    }
    guard (0...sectionTabs.count).contains(destination.index) else {
      throw SupatermProjectTabMoveError.invalidIndex
    }
    let insertionIndex: Int
    if destination.index < sectionTabs.count {
      insertionIndex = lane.firstIndex { $0.id == sectionTabs[destination.index].id }!
    } else if let lastTabID = sectionTabs.last?.id {
      insertionIndex = lane.firstIndex { $0.id == lastTabID }! + 1
    } else {
      insertionIndex = lane.endIndex
    }
    lane.insert(contentsOf: movingTabs, at: insertionIndex)
  }
}
