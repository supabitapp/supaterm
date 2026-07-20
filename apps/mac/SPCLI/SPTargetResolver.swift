import ArgumentParser
import Foundation
import SupatermCLIShared

enum SPTargetSelector: Equatable, Sendable {
  case index(Int)
  case id(UUID)
  var index: Int? {
    switch self {
    case .index(let index):
      return index
    case .id:
      return nil
    }
  }

  var uuid: UUID? {
    switch self {
    case .index:
      return nil
    case .id(let id):
      return id
    }
  }
}

enum SPResolvedNewTabTarget: Equatable {
  case context(UUID)
  case space(windowIndex: Int, spaceIndex: Int)
}

enum SPResolvedSpaceTarget: Equatable {
  case context(UUID)
  case space(windowIndex: Int, spaceIndex: Int)
}

enum SPResolvedTabTarget: Equatable {
  case context(UUID)
  case tab(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
}

enum SPResolvedPaneOnlyTarget: Equatable {
  case context(UUID)
  case pane(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
}

enum SPResolvedPaneTarget: Equatable {
  case context(UUID)
  case pane(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case tab(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
}

struct SPGroupLocation: Equatable {
  let windowIndex: Int
  let spaceIndex: Int
  let groupID: UUID
  let title: String
}

struct SPResolvedNewTabPlacement: Equatable {
  let target: SPResolvedNewTabTarget
  let groupDestination: SupatermTabGroupDestination?
}

private struct SPSpacePathKey: Hashable {
  let windowIndex: Int
  let spaceIndex: Int

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.windowIndex == rhs.windowIndex && lhs.spaceIndex == rhs.spaceIndex
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(windowIndex)
    hasher.combine(spaceIndex)
  }
}

private struct SPTabPathKey: Hashable {
  let windowIndex: Int
  let spaceIndex: Int
  let tabIndex: Int

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.windowIndex == rhs.windowIndex
      && lhs.spaceIndex == rhs.spaceIndex
      && lhs.tabIndex == rhs.tabIndex
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(windowIndex)
    hasher.combine(spaceIndex)
    hasher.combine(tabIndex)
  }
}

private struct SPTreeIndex {
  let keyWindowIndex: Int?
  let singleWindowIndex: Int?
  let spacesByPath: [SPSpacePathKey: SupatermTreeSnapshot.Space]
  let spacesByID: [UUID: SPSpaceLocation]
  let tabsByID: [UUID: SPTabLocation]
  let panesByID: [UUID: SPPaneLocation]
  let groupsByID: [UUID: SPGroupLocation]
  let groupsBySpace: [SPSpacePathKey: [SPGroupLocation]]
  let groupByTabPath: [SPTabPathKey: SPGroupLocation]
  let selectedSpaceByWindow: [Int: SPSpaceLocation]
  let firstSpaceByWindow: [Int: SPSpaceLocation]
  let selectedTabBySpace: [SPSpacePathKey: SPTabLocation]
  let firstTabBySpace: [SPSpacePathKey: SPTabLocation]
  let focusedPaneByTab: [SPTabPathKey: SPPaneLocation]
  let firstPaneByTab: [SPTabPathKey: SPPaneLocation]

  init(snapshot: SupatermTreeSnapshot) {
    var spacesByPath: [SPSpacePathKey: SupatermTreeSnapshot.Space] = [:]
    var spacesByID: [UUID: SPSpaceLocation] = [:]
    var tabsByID: [UUID: SPTabLocation] = [:]
    var panesByID: [UUID: SPPaneLocation] = [:]
    var groupsByID: [UUID: SPGroupLocation] = [:]
    var groupsBySpace: [SPSpacePathKey: [SPGroupLocation]] = [:]
    var groupByTabPath: [SPTabPathKey: SPGroupLocation] = [:]
    var selectedSpaceByWindow: [Int: SPSpaceLocation] = [:]
    var firstSpaceByWindow: [Int: SPSpaceLocation] = [:]
    var selectedTabBySpace: [SPSpacePathKey: SPTabLocation] = [:]
    var firstTabBySpace: [SPSpacePathKey: SPTabLocation] = [:]
    var focusedPaneByTab: [SPTabPathKey: SPPaneLocation] = [:]
    var firstPaneByTab: [SPTabPathKey: SPPaneLocation] = [:]

    for window in snapshot.windows {
      for space in window.spaces {
        let spaceLocation = SPSpaceLocation(windowIndex: window.index, spaceIndex: space.index)
        spacesByID[space.id] = spaceLocation
        firstSpaceByWindow[window.index] = firstSpaceByWindow[window.index] ?? spaceLocation
        if space.isSelected {
          selectedSpaceByWindow[window.index] = spaceLocation
        }

        let spaceKey = SPSpacePathKey(windowIndex: window.index, spaceIndex: space.index)
        spacesByPath[spaceKey] = space
        let tabs = space.flattenedTabs
        let tabIndexes = Dictionary(
          uniqueKeysWithValues: tabs.enumerated().map { ($0.element.id, $0.offset + 1) }
        )
        for group in tabGroups(in: space) {
          let groupLocation = SPGroupLocation(
            windowIndex: window.index,
            spaceIndex: space.index,
            groupID: group.id,
            title: group.title
          )
          groupsByID[group.id] = groupLocation
          groupsBySpace[spaceKey, default: []].append(groupLocation)
          for tab in group.tabs {
            guard let tabIndex = tabIndexes[tab.id] else { continue }
            groupByTabPath[
              SPTabPathKey(
                windowIndex: window.index,
                spaceIndex: space.index,
                tabIndex: tabIndex
              )
            ] = groupLocation
          }
        }

        for (offset, tab) in tabs.enumerated() {
          let tabIndex = offset + 1
          let tabLocation = SPTabLocation(
            windowIndex: window.index,
            spaceIndex: space.index,
            tabIndex: tabIndex
          )
          tabsByID[tab.id] = tabLocation
          firstTabBySpace[spaceKey] = firstTabBySpace[spaceKey] ?? tabLocation
          if tab.isSelected {
            selectedTabBySpace[spaceKey] = tabLocation
          }

          let tabKey = SPTabPathKey(
            windowIndex: window.index,
            spaceIndex: space.index,
            tabIndex: tabIndex
          )
          for pane in tab.panes {
            let paneLocation = SPPaneLocation(
              windowIndex: window.index,
              spaceIndex: space.index,
              tabIndex: tabIndex,
              paneIndex: pane.index
            )
            panesByID[pane.id] = paneLocation
            firstPaneByTab[tabKey] = firstPaneByTab[tabKey] ?? paneLocation
            if pane.isFocused {
              focusedPaneByTab[tabKey] = paneLocation
            }
          }
        }
      }
    }

    self.keyWindowIndex = snapshot.windows.first(where: \.isKey)?.index
    self.singleWindowIndex = snapshot.windows.count == 1 ? snapshot.windows.first?.index : nil
    self.spacesByPath = spacesByPath
    self.spacesByID = spacesByID
    self.tabsByID = tabsByID
    self.panesByID = panesByID
    self.groupsByID = groupsByID
    self.groupsBySpace = groupsBySpace
    self.groupByTabPath = groupByTabPath
    self.selectedSpaceByWindow = selectedSpaceByWindow
    self.firstSpaceByWindow = firstSpaceByWindow
    self.selectedTabBySpace = selectedTabBySpace
    self.firstTabBySpace = firstTabBySpace
    self.focusedPaneByTab = focusedPaneByTab
    self.firstPaneByTab = firstPaneByTab
  }

  func spaceLocation(id: UUID) -> SPSpaceLocation? {
    spacesByID[id]
  }

  func tabLocation(id: UUID) -> SPTabLocation? {
    tabsByID[id]
  }

  func paneLocation(id: UUID) -> SPPaneLocation? {
    panesByID[id]
  }

  func spaceLocation(windowIndex: Int, spaceIndex: Int) -> SPSpaceLocation? {
    let key = SPSpacePathKey(windowIndex: windowIndex, spaceIndex: spaceIndex)
    guard spacesByPath[key] != nil else { return nil }
    return .init(windowIndex: windowIndex, spaceIndex: spaceIndex)
  }

  func tabLocation(windowIndex: Int, spaceIndex: Int, tabIndex: Int) -> SPTabLocation? {
    let key = SPSpacePathKey(windowIndex: windowIndex, spaceIndex: spaceIndex)
    guard
      tabIndex > 0,
      let tabs = spacesByPath[key]?.flattenedTabs,
      tabs.indices.contains(tabIndex - 1)
    else {
      return nil
    }
    return .init(
      windowIndex: windowIndex,
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
  }

  func groupLocation(id: UUID) -> SPGroupLocation? {
    groupsByID[id]
  }

  func requireSpaceLocation(id: UUID) throws -> SPSpaceLocation {
    guard let location = spaceLocation(id: id) else {
      throw ValidationError("No space exists with UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requireTabLocation(id: UUID) throws -> SPTabLocation {
    guard let location = tabLocation(id: id) else {
      throw ValidationError("No tab exists with UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requirePaneLocation(id: UUID) throws -> SPPaneLocation {
    guard let location = paneLocation(id: id) else {
      throw ValidationError("No pane exists with UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requireSpaceLocation(windowIndex: Int, spaceIndex: Int) throws -> SPSpaceLocation {
    guard let location = spaceLocation(windowIndex: windowIndex, spaceIndex: spaceIndex) else {
      throw ValidationError("No space exists at \(windowIndex)/\(spaceIndex).")
    }
    return location
  }

  func requireTabLocation(windowIndex: Int, spaceIndex: Int, tabIndex: Int) throws -> SPTabLocation {
    guard
      let location = tabLocation(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex
      )
    else {
      throw ValidationError("No tab exists at \(spaceIndex)/\(tabIndex).")
    }
    return location
  }

  func requireGroupLocation(id: UUID) throws -> SPGroupLocation {
    guard let location = groupLocation(id: id) else {
      throw ValidationError("No group exists with UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requireGroupLocation(named name: String, in space: SPSpaceLocation) throws -> SPGroupLocation {
    let key = SPSpacePathKey(windowIndex: space.windowIndex, spaceIndex: space.spaceIndex)
    let matches = groupsBySpace[key, default: []].filter { $0.title == name }
    guard let match = matches.first else {
      throw ValidationError("No group named \"\(name)\" exists in space \(space.spaceIndex).")
    }
    guard matches.count == 1 else {
      throw ValidationError(
        "More than one group is named \"\(name)\" in space \(space.spaceIndex); use a group UUID."
      )
    }
    return match
  }

  func requireGroupLocation(containing tab: SPTabLocation) throws -> SPGroupLocation {
    let key = SPTabPathKey(
      windowIndex: tab.windowIndex,
      spaceIndex: tab.spaceIndex,
      tabIndex: tab.tabIndex
    )
    guard let location = groupByTabPath[key] else {
      throw ValidationError("Tab \(tab.spaceIndex)/\(tab.tabIndex) does not belong to a group.")
    }
    return location
  }

  func defaultWindowIndex(context: SupatermCLIContext?) throws -> Int {
    if let context {
      if let paneLocation = paneLocation(id: context.surfaceID) {
        return paneLocation.windowIndex
      }
      if let tabLocation = tabLocation(id: context.tabID) {
        return tabLocation.windowIndex
      }
    }

    if let keyWindowIndex {
      return keyWindowIndex
    }

    if let singleWindowIndex {
      return singleWindowIndex
    }

    throw ValidationError("Run this command inside Supaterm or target by UUID.")
  }

  func ambientSpaceLocation(context: SupatermCLIContext?) throws -> SPSpaceLocation {
    if let context {
      if let paneLocation = paneLocation(id: context.surfaceID) {
        return .init(windowIndex: paneLocation.windowIndex, spaceIndex: paneLocation.spaceIndex)
      }
      if let tabLocation = tabLocation(id: context.tabID) {
        return .init(windowIndex: tabLocation.windowIndex, spaceIndex: tabLocation.spaceIndex)
      }
    }

    let windowIndex = try defaultWindowIndex(context: context)
    guard let spaceLocation = selectedSpaceByWindow[windowIndex] ?? firstSpaceByWindow[windowIndex] else {
      throw ValidationError("No space is available in the selected window.")
    }
    return spaceLocation
  }

  func ambientTabLocation(context: SupatermCLIContext?) throws -> SPTabLocation {
    if let context {
      if let paneLocation = paneLocation(id: context.surfaceID) {
        return .init(
          windowIndex: paneLocation.windowIndex,
          spaceIndex: paneLocation.spaceIndex,
          tabIndex: paneLocation.tabIndex
        )
      }
      if let tabLocation = tabLocation(id: context.tabID) {
        return tabLocation
      }
    }

    let spaceLocation = try ambientSpaceLocation(context: context)
    let spaceKey = SPSpacePathKey(
      windowIndex: spaceLocation.windowIndex,
      spaceIndex: spaceLocation.spaceIndex
    )
    guard let tabLocation = selectedTabBySpace[spaceKey] ?? firstTabBySpace[spaceKey] else {
      throw ValidationError("No tab is available in the selected space.")
    }
    return tabLocation
  }

  func ambientPaneLocation(context: SupatermCLIContext?) throws -> SPPaneLocation {
    if let context, let paneLocation = paneLocation(id: context.surfaceID) {
      return paneLocation
    }

    let tabLocation = try ambientTabLocation(context: context)
    let tabKey = SPTabPathKey(
      windowIndex: tabLocation.windowIndex,
      spaceIndex: tabLocation.spaceIndex,
      tabIndex: tabLocation.tabIndex
    )
    guard let paneLocation = focusedPaneByTab[tabKey] ?? firstPaneByTab[tabKey] else {
      throw ValidationError("No pane is available in the selected tab.")
    }
    return paneLocation
  }
}

enum SPTargetResolver {
  static func resolveNewTabTarget(
    window: Int?,
    space: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedNewTabTarget {
    let index = SPTreeIndex(snapshot: try snapshot())
    if let window, window < 1 {
      throw ValidationError("--window must be 1 or greater.")
    }
    if window != nil && space == nil {
      throw ValidationError("--window requires --space.")
    }

    guard let space else {
      guard let context else {
        throw ValidationError("Run this command inside a Supaterm pane or provide --space.")
      }
      return .context(context.surfaceID)
    }

    switch space {
    case .index(let spaceIndex):
      return .space(windowIndex: window ?? 1, spaceIndex: spaceIndex)

    case .id(let spaceID):
      guard window == nil else {
        throw ValidationError("--window cannot be used when --space is a UUID.")
      }
      let location = try index.requireSpaceLocation(id: spaceID)
      return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
    }
  }

  static func resolvePaneTarget(
    window: Int?,
    space: SPTargetSelector?,
    tab: SPTargetSelector?,
    pane: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedPaneTarget {
    let index = SPTreeIndex(snapshot: try snapshot())
    if let paneID = pane?.uuid {
      guard tab == nil, space == nil, window == nil else {
        throw ValidationError("--pane cannot be combined with --tab, --space, or --window when using a UUID.")
      }
      let location = try index.requirePaneLocation(id: paneID)
      return .pane(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: location.tabIndex,
        paneIndex: location.paneIndex
      )
    }

    if let tabID = tab?.uuid {
      guard pane == nil, space == nil, window == nil else {
        throw ValidationError("--tab cannot be combined with --pane, --space, or --window when using a UUID.")
      }
      let location = try index.requireTabLocation(id: tabID)
      return .tab(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: location.tabIndex
      )
    }

    if let spaceID = space?.uuid {
      guard window == nil else {
        throw ValidationError("--window cannot be used when --space is a UUID.")
      }
      let location = try index.requireSpaceLocation(id: spaceID)
      let tabIndex = tab?.index
      let paneIndex = pane?.index
      try validateTargetSelection(
        window: nil,
        space: location.spaceIndex,
        tab: tabIndex,
        pane: paneIndex,
        context: context
      )
      return try resolvedPaneTarget(
        context: context,
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    }

    let spaceIndex = space?.index
    let tabIndex = tab?.index
    let paneIndex = pane?.index
    try validateTargetSelection(
      window: window,
      space: spaceIndex,
      tab: tabIndex,
      pane: paneIndex,
      context: context
    )
    return try resolvedPaneTarget(
      context: context,
      windowIndex: window ?? 1,
      spaceIndex: spaceIndex,
      tabIndex: tabIndex,
      paneIndex: paneIndex
    )
  }

  private static func resolvedPaneTarget(
    context: SupatermCLIContext?,
    windowIndex: Int,
    spaceIndex: Int?,
    tabIndex: Int?,
    paneIndex: Int?
  ) throws -> SPResolvedPaneTarget {
    if let tabIndex, let spaceIndex {
      if let paneIndex {
        return .pane(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }
      return .tab(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex
      )
    }

    guard let context else {
      throw ValidationError("Run this command inside a Supaterm pane or provide --space and --tab.")
    }
    return .context(context.surfaceID)
  }

}

enum SPSpaceReference: Equatable, Sendable {
  case index(Int)
  case id(UUID)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("Space targets must be a 1-based index or UUID.")
    }

    if let index = Int(trimmed) {
      guard index > 0 else {
        throw ValidationError("Space targets must be 1 or greater.")
      }
      return .index(index)
    }

    guard let id = UUID(uuidString: trimmed) else {
      throw ValidationError("Space targets must be a 1-based index or UUID.")
    }
    return .id(id)
  }
}

enum SPTabReference: Equatable, Sendable {
  case path(spaceIndex: Int, tabIndex: Int)
  case id(UUID)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("Tab targets must be `space/tab` or UUID.")
    }

    if let id = UUID(uuidString: trimmed) {
      return .id(id)
    }

    let components = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    guard components.count == 2 else {
      throw ValidationError("Tab targets must be `space/tab` or UUID.")
    }

    guard
      let spaceIndex = Int(components[0]),
      let tabIndex = Int(components[1]),
      spaceIndex > 0,
      tabIndex > 0
    else {
      throw ValidationError("Tab targets must be `space/tab` with 1-based indexes or UUID.")
    }

    return .path(spaceIndex: spaceIndex, tabIndex: tabIndex)
  }
}

enum SPPaneReference: Equatable, Sendable {
  case path(spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case id(UUID)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("Pane targets must be `space/tab/pane` or UUID.")
    }

    if let id = UUID(uuidString: trimmed) {
      return .id(id)
    }

    let components = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    guard components.count == 3 else {
      throw ValidationError("Pane targets must be `space/tab/pane` or UUID.")
    }

    guard
      let spaceIndex = Int(components[0]),
      let tabIndex = Int(components[1]),
      let paneIndex = Int(components[2]),
      spaceIndex > 0,
      tabIndex > 0,
      paneIndex > 0
    else {
      throw ValidationError("Pane targets must be `space/tab/pane` with 1-based indexes or UUID.")
    }

    return .path(spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
  }
}

enum SPContainerReference: Equatable, Sendable {
  case tab(SPTabReference)
  case pane(SPPaneReference)
  case id(UUID)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("`--in` must be a tab selector, pane selector, or UUID.")
    }

    if let id = UUID(uuidString: trimmed) {
      return .id(id)
    }

    let components = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    switch components.count {
    case 2:
      return .tab(try SPTabReference.parse(trimmed))
    case 3:
      return .pane(try SPPaneReference.parse(trimmed))
    default:
      throw ValidationError("`--in` must be a tab selector, pane selector, or UUID.")
    }
  }
}

enum SPGroupReference: Equatable, Sendable {
  case id(UUID)
  case title(String)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("Group targets must be an exact title or UUID.")
    }
    if let id = UUID(uuidString: trimmed) {
      return .id(id)
    }
    return .title(trimmed)
  }
}

enum SPGroupDestinationReference: Equatable, Sendable {
  case group(SPGroupReference)
  case root
}

func parseSpaceReference(_ argument: String) throws -> SPSpaceReference {
  try SPSpaceReference.parse(argument)
}

func parseTabReference(_ argument: String) throws -> SPTabReference {
  try SPTabReference.parse(argument)
}

func parsePaneReference(_ argument: String) throws -> SPPaneReference {
  try SPPaneReference.parse(argument)
}

func parseContainerReference(_ argument: String) throws -> SPContainerReference {
  try SPContainerReference.parse(argument)
}

func parseGroupReference(_ argument: String) throws -> SPGroupReference {
  try SPGroupReference.parse(argument)
}

extension SPGroupReference: ExpressibleByArgument {
  init?(argument: String) {
    guard let value = try? parseGroupReference(argument) else { return nil }
    self = value
  }
}

func resolvePublicNewTabTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedNewTabTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try index.ambientSpaceLocation(context: nil)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }

  switch reference {
  case .index(let spaceIndex):
    return .space(
      windowIndex: try index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try index.requireSpaceLocation(id: spaceID)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }
}

func resolvePublicSpaceTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedSpaceTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try index.ambientSpaceLocation(context: nil)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }

  switch reference {
  case .index(let spaceIndex):
    return .space(
      windowIndex: try index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try index.requireSpaceLocation(id: spaceID)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }
}

func resolvePublicTabTarget(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedTabTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try index.ambientTabLocation(context: nil)
    return .tab(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex
    )
  }

  switch reference {
  case .path(let spaceIndex, let tabIndex):
    return .tab(
      windowIndex: try index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
  case .id(let tabID):
    let location = try index.requireTabLocation(id: tabID)
    return .tab(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex
    )
  }
}

func resolvePublicGroupTargetRequest(
  _ reference: SPGroupReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTabGroupTargetRequest {
  let index = SPTreeIndex(snapshot: snapshot)
  let location: SPGroupLocation
  if let reference {
    location = try resolveGroup(reference, in: nil, context: context, index: index)
  } else {
    location = try index.requireGroupLocation(containing: index.ambientTabLocation(context: context))
  }
  return .init(groupID: location.groupID)
}

func resolvePublicNewTabPlacement(
  space: SPSpaceReference?,
  group: SPGroupDestinationReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedNewTabPlacement {
  guard let group else {
    return .init(
      target: try resolvePublicNewTabTarget(space, context: context, snapshot: snapshot),
      groupDestination: nil
    )
  }

  switch group {
  case .root:
    return .init(
      target: try resolvePublicNewTabTarget(space, context: context, snapshot: snapshot),
      groupDestination: .root(isPinned: false)
    )

  case .group(let reference):
    let index = SPTreeIndex(snapshot: snapshot)
    let explicitSpace = try space.map {
      try resolveSpaceLocation($0, context: context, index: index)
    }
    let groupLocation = try resolveGroup(
      reference,
      in: explicitSpace,
      context: context,
      index: index
    )
    if let explicitSpace {
      try requireSameSpace(explicitSpace, groupLocation)
    }
    return .init(
      target: .space(
        windowIndex: groupLocation.windowIndex,
        spaceIndex: groupLocation.spaceIndex
      ),
      groupDestination: .group(groupLocation.groupID)
    )
  }
}

func resolvePublicMoveTabRequest(
  tab: SPTabReference?,
  destination: SPGroupDestinationReference,
  index destinationIndex: Int?,
  isPinned: Bool,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermMoveTabRequest {
  if let destinationIndex, destinationIndex < 1 {
    throw ValidationError("--index must be 1 or greater.")
  }

  let treeIndex = SPTreeIndex(snapshot: snapshot)
  let tabLocation = try resolveConcreteTabLocation(tab, context: context, index: treeIndex)
  let resolvedDestination: SupatermTabGroupDestination
  switch destination {
  case .root:
    resolvedDestination = .root(isPinned: isPinned)

  case .group(let reference):
    guard !isPinned else {
      throw ValidationError("--pin can only be used with --root.")
    }
    let sourceSpace = SPSpaceLocation(
      windowIndex: tabLocation.windowIndex,
      spaceIndex: tabLocation.spaceIndex
    )
    let groupLocation = try resolveGroup(
      reference,
      in: sourceSpace,
      context: context,
      index: treeIndex
    )
    try requireSameSpace(sourceSpace, groupLocation)
    resolvedDestination = .group(groupLocation.groupID)
  }

  return .init(
    destination: resolvedDestination,
    index: destinationIndex,
    target: .init(
      targetWindowIndex: tabLocation.windowIndex,
      targetSpaceIndex: tabLocation.spaceIndex,
      targetTabIndex: tabLocation.tabIndex
    )
  )
}

private func resolveSpaceLocation(
  _ reference: SPSpaceReference,
  context: SupatermCLIContext?,
  index: SPTreeIndex
) throws -> SPSpaceLocation {
  switch reference {
  case .index(let spaceIndex):
    return try index.requireSpaceLocation(
      windowIndex: index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex
    )
  case .id(let spaceID):
    return try index.requireSpaceLocation(id: spaceID)
  }
}

private func resolveConcreteTabLocation(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  index: SPTreeIndex
) throws -> SPTabLocation {
  guard let reference else {
    return try index.ambientTabLocation(context: context)
  }
  switch reference {
  case .id(let tabID):
    return try index.requireTabLocation(id: tabID)
  case .path(let spaceIndex, let tabIndex):
    return try index.requireTabLocation(
      windowIndex: index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
  }
}

private func resolveGroup(
  _ reference: SPGroupReference,
  in space: SPSpaceLocation?,
  context: SupatermCLIContext?,
  index: SPTreeIndex
) throws -> SPGroupLocation {
  switch reference {
  case .id(let groupID):
    return try index.requireGroupLocation(id: groupID)
  case .title(let title):
    return try index.requireGroupLocation(
      named: title,
      in: space ?? index.ambientSpaceLocation(context: context)
    )
  }
}

private func requireSameSpace(
  _ space: SPSpaceLocation,
  _ group: SPGroupLocation
) throws {
  guard space.windowIndex == group.windowIndex, space.spaceIndex == group.spaceIndex else {
    throw ValidationError("The destination group must belong to the target tab's space.")
  }
}

func resolvePublicPaneTarget(
  _ reference: SPPaneReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedPaneOnlyTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try index.ambientPaneLocation(context: nil)
    return .pane(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex,
      paneIndex: location.paneIndex
    )
  }

  switch reference {
  case .path(let spaceIndex, let tabIndex, let paneIndex):
    return .pane(
      windowIndex: try index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex,
      paneIndex: paneIndex
    )
  case .id(let paneID):
    let location = try index.requirePaneLocation(id: paneID)
    return .pane(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex,
      paneIndex: location.paneIndex
    )
  }
}

func resolvePublicSplitTarget(
  _ reference: SPContainerReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedPaneTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try index.ambientPaneLocation(context: nil)
    return .pane(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex,
      paneIndex: location.paneIndex
    )
  }

  switch reference {
  case .tab(let tab):
    switch try resolvePublicTabTarget(tab, context: context, snapshot: snapshot) {
    case .context(let contextPaneID):
      return .context(contextPaneID)
    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      return .tab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
    }

  case .pane(let pane):
    switch try resolvePublicPaneTarget(pane, context: context, snapshot: snapshot) {
    case .context(let contextPaneID):
      return .context(contextPaneID)
    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .pane(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    }

  case .id(let id):
    if let location = index.paneLocation(id: id) {
      return .pane(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: location.tabIndex,
        paneIndex: location.paneIndex
      )
    }
    if let location = index.tabLocation(id: id) {
      return .tab(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: location.tabIndex
      )
    }
    throw ValidationError("No tab or pane exists with UUID \(id.uuidString.lowercased()).")
  }
}

func resolvePublicSpaceNavigationRequest(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermSpaceNavigationRequest {
  let index = SPTreeIndex(snapshot: snapshot)
  if let context {
    return .init(contextPaneID: context.surfaceID)
  }
  return .init(
    targetWindowIndex: try index.defaultWindowIndex(context: nil)
  )
}

func resolvePublicTabNavigationRequest(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTabNavigationRequest {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    if let context {
      return .init(contextPaneID: context.surfaceID)
    }
    let location = try index.ambientSpaceLocation(context: nil)
    return .init(
      targetWindowIndex: location.windowIndex,
      targetSpaceIndex: location.spaceIndex
    )
  }

  switch reference {
  case .index(let spaceIndex):
    return .init(
      targetWindowIndex: try index.defaultWindowIndex(context: context),
      targetSpaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try index.requireSpaceLocation(id: spaceID)
    return .init(
      targetWindowIndex: location.windowIndex,
      targetSpaceIndex: location.spaceIndex
    )
  }
}

func validateTargetSelection(
  window: Int?,
  space: Int?,
  tab: Int?,
  pane: Int?,
  context: SupatermCLIContext?
) throws {
  if let window, window < 1 {
    throw ValidationError("--window must be 1 or greater.")
  }
  if let space, space < 1 {
    throw ValidationError("--space must be 1 or greater.")
  }
  if let tab, tab < 1 {
    throw ValidationError("--tab must be 1 or greater.")
  }
  if let pane, pane < 1 {
    throw ValidationError("--pane must be 1 or greater.")
  }
  if pane != nil && tab == nil {
    throw ValidationError("--pane requires --tab.")
  }
  if tab != nil && space == nil {
    throw ValidationError("--tab requires --space.")
  }
  if window != nil && space == nil {
    throw ValidationError("--window requires --space.")
  }
  if space != nil && tab == nil {
    throw ValidationError("--space requires --tab.")
  }
  if space == nil && tab == nil && pane == nil && context == nil {
    throw ValidationError("Run this command inside a Supaterm pane or provide --space and --tab.")
  }
}

private struct SPSpaceLocation {
  let windowIndex: Int
  let spaceIndex: Int
}

private struct SPTabLocation {
  let windowIndex: Int
  let spaceIndex: Int
  let tabIndex: Int
}

private struct SPPaneLocation {
  let windowIndex: Int
  let spaceIndex: Int
  let tabIndex: Int
  let paneIndex: Int
}
