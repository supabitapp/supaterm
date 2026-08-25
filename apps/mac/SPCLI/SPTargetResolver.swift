import ArgumentParser
import Foundation
import SupatermCLIShared

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

private struct SPSpaceLocation {
  let id: UUID
  let windowIndex: Int
  let spaceIndex: Int
}

private struct SPTabLocation {
  let id: UUID
  let title: String
  let windowIndex: Int
  let spaceIndex: Int
  let tabIndex: Int
}

private struct SPPaneLocation {
  let id: UUID
  let windowIndex: Int
  let spaceIndex: Int
  let tabIndex: Int
}

private struct SPTreeIndex {
  let keyWindowIndex: Int?
  let singleWindowIndex: Int?
  let spacesByPath: [SPSpacePathKey: SupatermTreeSnapshot.Space]
  let spacesByID: [UUID: [SPSpaceLocation]]
  let tabsByID: [UUID: [SPTabLocation]]
  let panesByID: [UUID: [SPPaneLocation]]
  let selectedSpaceByWindow: [Int: SPSpaceLocation]
  let firstSpaceByWindow: [Int: SPSpaceLocation]
  let selectedTabBySpace: [SPSpacePathKey: SPTabLocation]
  let firstTabBySpace: [SPSpacePathKey: SPTabLocation]
  let focusedPaneByTab: [SPTabPathKey: SPPaneLocation]
  let firstPaneByTab: [SPTabPathKey: SPPaneLocation]

  init(snapshot: SupatermTreeSnapshot) {
    let orderedProjectIDs = snapshot.projects.map(\.id)
    var spacesByPath: [SPSpacePathKey: SupatermTreeSnapshot.Space] = [:]
    var spacesByID: [UUID: [SPSpaceLocation]] = [:]
    var tabsByID: [UUID: [SPTabLocation]] = [:]
    var panesByID: [UUID: [SPPaneLocation]] = [:]
    var selectedSpaceByWindow: [Int: SPSpaceLocation] = [:]
    var firstSpaceByWindow: [Int: SPSpaceLocation] = [:]
    var selectedTabBySpace: [SPSpacePathKey: SPTabLocation] = [:]
    var firstTabBySpace: [SPSpacePathKey: SPTabLocation] = [:]
    var focusedPaneByTab: [SPTabPathKey: SPPaneLocation] = [:]
    var firstPaneByTab: [SPTabPathKey: SPPaneLocation] = [:]

    for window in snapshot.windows {
      for space in window.spaces {
        let spaceLocation = SPSpaceLocation(
          id: space.id,
          windowIndex: window.index,
          spaceIndex: space.index
        )
        let spaceKey = SPSpacePathKey(windowIndex: window.index, spaceIndex: space.index)
        spacesByPath[spaceKey] = space
        spacesByID[space.id, default: []].append(spaceLocation)
        firstSpaceByWindow[window.index] = firstSpaceByWindow[window.index] ?? spaceLocation
        if space.id == window.displayedSpaceID { selectedSpaceByWindow[window.index] = spaceLocation }

        let tabSnapshotsByID = Dictionary(uniqueKeysWithValues: space.tabs.map { ($0.id, $0) })
        let layout = SupatermProjectLayout.make(
          orderedProjectIDs: orderedProjectIDs,
          pinnedTabs: space.tabs.filter(\.isPinned).map {
            SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
          },
          regularTabs: space.tabs.filter { !$0.isPinned }.map {
            SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
          }
        )
        let tabs = layout.semanticTabIDs.compactMap { tabSnapshotsByID[$0] }
        for (offset, tab) in tabs.enumerated() {
          let tabIndex = offset + 1
          let tabLocation = SPTabLocation(
            id: tab.id,
            title: tab.title,
            windowIndex: window.index,
            spaceIndex: space.index,
            tabIndex: tabIndex
          )
          tabsByID[tab.id, default: []].append(tabLocation)
          firstTabBySpace[spaceKey] = firstTabBySpace[spaceKey] ?? tabLocation
          if tab.isSelected { selectedTabBySpace[spaceKey] = tabLocation }
          let tabKey = SPTabPathKey(
            windowIndex: window.index,
            spaceIndex: space.index,
            tabIndex: tabIndex
          )
          for pane in tab.panes {
            let paneLocation = SPPaneLocation(
              id: pane.id,
              windowIndex: window.index,
              spaceIndex: space.index,
              tabIndex: tabIndex
            )
            panesByID[pane.id, default: []].append(paneLocation)
            firstPaneByTab[tabKey] = firstPaneByTab[tabKey] ?? paneLocation
            if pane.isFocused { focusedPaneByTab[tabKey] = paneLocation }
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
    self.selectedSpaceByWindow = selectedSpaceByWindow
    self.firstSpaceByWindow = firstSpaceByWindow
    self.selectedTabBySpace = selectedTabBySpace
    self.firstTabBySpace = firstTabBySpace
    self.focusedPaneByTab = focusedPaneByTab
    self.firstPaneByTab = firstPaneByTab
  }

  func defaultWindowIndex(context: SupatermCLIContext?) throws -> Int {
    if let context { return try validatedContextLocation(context).windowIndex }
    if let keyWindowIndex { return keyWindowIndex }
    if let singleWindowIndex { return singleWindowIndex }
    throw ValidationError("Run this command inside Supaterm or target by UUID.")
  }

  func spaceLocation(windowIndex: Int, spaceIndex: Int) -> SPSpaceLocation? {
    guard let space = spacesByPath[SPSpacePathKey(windowIndex: windowIndex, spaceIndex: spaceIndex)]
    else { return nil }
    return SPSpaceLocation(id: space.id, windowIndex: windowIndex, spaceIndex: spaceIndex)
  }

  func requireSpaceLocation(windowIndex: Int, spaceIndex: Int) throws -> SPSpaceLocation {
    guard let location = spaceLocation(windowIndex: windowIndex, spaceIndex: spaceIndex) else {
      throw ValidationError("No space exists at \(windowIndex)/\(spaceIndex).")
    }
    return location
  }

  func requireSpaceLocation(id: UUID, windowIndex: Int) throws -> SPSpaceLocation {
    guard let location = spacesByID[id]?.first(where: { $0.windowIndex == windowIndex }) else {
      throw ValidationError("No space exists with UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requireTabLocation(id: UUID) throws -> SPTabLocation {
    guard let locations = tabsByID[id] else {
      throw ValidationError("No tab exists with UUID \(id.uuidString.lowercased()).")
    }
    guard locations.count == 1, let location = locations.first else {
      throw ValidationError("More than one tab has UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func requireTabLocation(
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int
  ) throws -> SPTabLocation {
    guard
      let location = tabsByID.values.joined().first(where: {
        $0.windowIndex == windowIndex && $0.spaceIndex == spaceIndex && $0.tabIndex == tabIndex
      })
    else { throw ValidationError("No tab exists at \(spaceIndex)/\(tabIndex).") }
    return location
  }

  func requirePaneLocation(id: UUID) throws -> SPPaneLocation {
    guard let locations = panesByID[id] else {
      throw ValidationError("No pane exists with UUID \(id.uuidString.lowercased()).")
    }
    guard locations.count == 1, let location = locations.first else {
      throw ValidationError("More than one pane has UUID \(id.uuidString.lowercased()).")
    }
    return location
  }

  func ambientSpaceLocation(context: SupatermCLIContext?) throws -> SPSpaceLocation {
    if let context {
      let pane = try validatedContextLocation(context)
      return try requireSpaceLocation(windowIndex: pane.windowIndex, spaceIndex: pane.spaceIndex)
    }
    let windowIndex = try defaultWindowIndex(context: context)
    guard let location = selectedSpaceByWindow[windowIndex] ?? firstSpaceByWindow[windowIndex] else {
      throw ValidationError("No space is available in the selected window.")
    }
    return location
  }

  func ambientTabLocation(context: SupatermCLIContext?) throws -> SPTabLocation {
    if let context {
      _ = try validatedContextLocation(context)
      return try requireTabLocation(id: context.tabID)
    }
    let space = try ambientSpaceLocation(context: context)
    let key = SPSpacePathKey(windowIndex: space.windowIndex, spaceIndex: space.spaceIndex)
    guard let location = selectedTabBySpace[key] ?? firstTabBySpace[key] else {
      throw ValidationError("No tab is available in the selected space.")
    }
    return location
  }

  func ambientPaneLocation(context: SupatermCLIContext?) throws -> SPPaneLocation {
    if let context { return try validatedContextLocation(context) }
    let tab = try ambientTabLocation(context: context)
    let key = SPTabPathKey(
      windowIndex: tab.windowIndex,
      spaceIndex: tab.spaceIndex,
      tabIndex: tab.tabIndex
    )
    guard let location = focusedPaneByTab[key] ?? firstPaneByTab[key] else {
      throw ValidationError("No pane is available in the selected tab.")
    }
    return location
  }

  func validatedContextLocation(_ context: SupatermCLIContext) throws -> SPPaneLocation {
    guard
      let pane = try? requirePaneLocation(id: context.surfaceID),
      let tab = try? requireTabLocation(id: context.tabID),
      pane.windowIndex == tab.windowIndex,
      pane.spaceIndex == tab.spaceIndex,
      pane.tabIndex == tab.tabIndex
    else { throw ValidationError("The current Supaterm tab and pane no longer exist together.") }
    return pane
  }
}

enum SPSpaceReference: Equatable, Sendable {
  case index(Int)
  case id(UUID)
  case short(SPShortReference)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    if let reference = try SPShortReference.parse(trimmed) {
      return .short(try reference.require(.space))
    }
    if let index = Int(trimmed), index > 0 { return .index(index) }
    if let id = UUID(uuidString: trimmed) { return .id(id) }
    throw ValidationError("Space targets must be a 1-based index, s: ref, or UUID.")
  }
}

enum SPTabReference: Equatable, Sendable {
  case path(spaceIndex: Int, tabIndex: Int)
  case id(UUID)
  case short(SPShortReference)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    if let reference = try SPShortReference.parse(trimmed) {
      return .short(try reference.require(.tab))
    }
    if let id = UUID(uuidString: trimmed) { return .id(id) }
    let values = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    guard values.count == 2, let space = Int(values[0]), let tab = Int(values[1]), space > 0, tab > 0
    else { throw ValidationError("Tab targets must be `space/tab`, a t: ref, or UUID.") }
    return .path(spaceIndex: space, tabIndex: tab)
  }
}

enum SPPaneReference: Equatable, Sendable {
  case path(spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case id(UUID)
  case short(SPShortReference)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    if let reference = try SPShortReference.parse(trimmed) {
      return .short(try reference.require(.pane))
    }
    if let id = UUID(uuidString: trimmed) { return .id(id) }
    let values = trimmed.split(separator: "/", omittingEmptySubsequences: false)
    guard
      values.count == 3,
      let space = Int(values[0]),
      let tab = Int(values[1]),
      let pane = Int(values[2]),
      space > 0, tab > 0, pane > 0
    else { throw ValidationError("Pane targets must be `space/tab/pane`, a p: ref, or UUID.") }
    return .path(spaceIndex: space, tabIndex: tab, paneIndex: pane)
  }
}

enum SPContainerReference: Equatable, Sendable {
  case tab(SPTabReference)
  case pane(SPPaneReference)
  case id(UUID)

  static func parse(_ argument: String) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    if let reference = try SPShortReference.parse(trimmed) {
      switch reference.kind {
      case .tab: return .tab(.short(reference))
      case .pane: return .pane(.short(reference))
      case .space, .project:
        throw ValidationError("`--in` requires a t: or p: ref, got \(reference).")
      }
    }
    if let id = UUID(uuidString: trimmed) { return .id(id) }
    switch trimmed.split(separator: "/", omittingEmptySubsequences: false).count {
    case 2: return .tab(try SPTabReference.parse(trimmed))
    case 3: return .pane(try SPPaneReference.parse(trimmed))
    default: throw ValidationError("`--in` must be a tab target, pane target, or UUID.")
    }
  }
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

func resolvePublicProjectTargetRequest(
  _ reference: SPProjectReference,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermProjectTargetRequest {
  let project: SupatermSnapshotProject?
  switch reference {
  case .id(let id):
    project = snapshot.projects.first { $0.id == id }
  case .short(let short):
    let id = try short.resolve(in: snapshot.projects.map(\.id))
    project = snapshot.projects.first { $0.id == id }
  case .name(let name):
    project = snapshot.projects.first { SupatermProjectName.matches($0.name, name) }
  }
  guard let project else { throw ValidationError("No project matches the target.") }
  return SupatermProjectTargetRequest(projectID: project.id)
}

func resolvePublicNewTabTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermNewTabTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  if reference == nil, let context { return .pane(try index.validatedContextLocation(context).id) }
  return .space(try resolveSpaceLocation(reference, context: context, index: index).id)
}

func resolvePublicSpaceTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermSpaceTargetRequest {
  SupatermSpaceTargetRequest(
    spaceID: try resolveSpaceLocation(reference, context: context, index: SPTreeIndex(snapshot: snapshot)).id,
    context: context
  )
}

func resolvePublicSpaceListing(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTreeSnapshot.Window {
  let index = SPTreeIndex(snapshot: snapshot)
  let windowIndex = try index.defaultWindowIndex(context: context)
  guard let window = snapshot.windows.first(where: { $0.index == windowIndex }) else {
    throw ValidationError("No space is available in the selected window.")
  }
  return window
}

func resolvePublicTabTarget(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTabTargetRequest {
  SupatermTabTargetRequest(
    tabID: try resolveTabLocation(reference, context: context, index: SPTreeIndex(snapshot: snapshot)).id
  )
}

func resolvePublicTabTitle(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> String {
  try resolveTabLocation(reference, context: context, index: SPTreeIndex(snapshot: snapshot)).title
}

func resolvePublicPaneTarget(
  _ reference: SPPaneReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermPaneTargetRequest {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else {
    return SupatermPaneTargetRequest(paneID: try index.ambientPaneLocation(context: context).id)
  }
  switch reference {
  case .id(let id):
    return SupatermPaneTargetRequest(paneID: try index.requirePaneLocation(id: id).id)
  case .short(let short):
    let id = try short.resolve(in: index.panesByID.keys)
    return SupatermPaneTargetRequest(paneID: try index.requirePaneLocation(id: id).id)
  case .path(let spaceIndex, let tabIndex, let paneIndex):
    let windowIndex = try index.defaultWindowIndex(context: context)
    let tab = try index.requireTabLocation(
      windowIndex: windowIndex,
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
    guard
      let space = index.spacesByPath[
        SPSpacePathKey(windowIndex: windowIndex, spaceIndex: spaceIndex)
      ],
      let snapshotTab = space.tabs.first(where: { $0.id == tab.id }),
      let pane = snapshotTab.panes.first(where: { $0.index == paneIndex })
    else { throw ValidationError("No pane exists at \(spaceIndex)/\(tabIndex)/\(paneIndex).") }
    return SupatermPaneTargetRequest(paneID: pane.id)
  }
}

func resolvePublicSplitTarget(
  _ reference: SPContainerReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermNewPaneTarget {
  let index = SPTreeIndex(snapshot: snapshot)
  guard let reference else { return .pane(try index.ambientPaneLocation(context: context).id) }
  switch reference {
  case .tab(let tab):
    return .tab(try resolveTabLocation(tab, context: context, index: index).id)
  case .pane(let pane):
    return .pane(try resolvePublicPaneTarget(pane, context: context, snapshot: snapshot).paneID)
  case .id(let id):
    if index.panesByID[id] != nil { return .pane(try index.requirePaneLocation(id: id).id) }
    if index.tabsByID[id] != nil { return .tab(try index.requireTabLocation(id: id).id) }
    throw ValidationError("No tab or pane exists with UUID \(id.uuidString.lowercased()).")
  }
}

func resolvePublicTabNavigationRequest(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTabNavigationRequest {
  SupatermTabNavigationRequest(
    spaceID: try resolveSpaceLocation(reference, context: context, index: SPTreeIndex(snapshot: snapshot)).id,
    context: context
  )
}

private func resolveSpaceLocation(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  index: SPTreeIndex
) throws -> SPSpaceLocation {
  guard let reference else { return try index.ambientSpaceLocation(context: context) }
  let windowIndex = try index.defaultWindowIndex(context: context)
  switch reference {
  case .index(let spaceIndex):
    return try index.requireSpaceLocation(windowIndex: windowIndex, spaceIndex: spaceIndex)
  case .id(let id):
    return try index.requireSpaceLocation(id: id, windowIndex: windowIndex)
  case .short(let short):
    return try index.requireSpaceLocation(
      id: short.resolve(in: index.spacesByID.keys),
      windowIndex: windowIndex
    )
  }
}

private func resolveTabLocation(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  index: SPTreeIndex
) throws -> SPTabLocation {
  guard let reference else { return try index.ambientTabLocation(context: context) }
  switch reference {
  case .id(let id): return try index.requireTabLocation(id: id)
  case .short(let short): return try index.requireTabLocation(id: short.resolve(in: index.tabsByID.keys))
  case .path(let spaceIndex, let tabIndex):
    return try index.requireTabLocation(
      windowIndex: index.defaultWindowIndex(context: context),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
  }
}
