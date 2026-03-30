import ArgumentParser
import Foundation
import SupatermCLIShared

enum SPTargetSelector: Equatable, Sendable {
  case index(Int)
  case id(UUID)

  static func parse(
    _ argument: String,
    flag: String
  ) throws -> Self {
    let trimmed = argument.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else {
      throw ValidationError("\(flag) must be a 1-based index or UUID.")
    }

    if let index = Int(trimmed) {
      guard index > 0 else {
        throw ValidationError("\(flag) must be 1 or greater.")
      }
      return .index(index)
    }

    guard let id = UUID(uuidString: trimmed) else {
      throw ValidationError("\(flag) must be a 1-based index or UUID.")
    }
    return .id(id)
  }

  var index: Int? {
    switch self {
    case .index(let index):
      return index
    case .id:
      return nil
    }
  }

  var usesUUID: Bool {
    switch self {
    case .index:
      return false
    case .id:
      return true
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

enum SPResolvedPaneTarget: Equatable {
  case context(UUID)
  case pane(windowIndex: Int, spaceIndex: Int, tabIndex: Int, paneIndex: Int)
  case tab(windowIndex: Int, spaceIndex: Int, tabIndex: Int)
}

enum SPTargetResolver {
  static func resolveNewTabTarget(
    window: Int?,
    space: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedNewTabTarget {
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
      let location = try snapshot().requireSpaceLocation(id: spaceID)
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
    if let paneID = pane?.uuid {
      guard tab == nil, space == nil, window == nil else {
        throw ValidationError("--pane cannot be combined with --tab, --space, or --window when using a UUID.")
      }
      let location = try snapshot().requirePaneLocation(id: paneID)
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
      let location = try snapshot().requireTabLocation(id: tabID)
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
      let location = try snapshot().requireSpaceLocation(id: spaceID)
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

func parseSpaceTarget(_ argument: String) throws -> SPTargetSelector {
  try SPTargetSelector.parse(argument, flag: "--space")
}

func parseTabTarget(_ argument: String) throws -> SPTargetSelector {
  try SPTargetSelector.parse(argument, flag: "--tab")
}

func parsePaneTarget(_ argument: String) throws -> SPTargetSelector {
  try SPTargetSelector.parse(argument, flag: "--pane")
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

private extension SupatermTreeSnapshot {
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

  func spaceLocation(id: UUID) -> SPSpaceLocation? {
    for window in windows {
      for space in window.spaces where space.id == id {
        return .init(windowIndex: window.index, spaceIndex: space.index)
      }
    }
    return nil
  }

  func tabLocation(id: UUID) -> SPTabLocation? {
    for window in windows {
      for space in window.spaces {
        for tab in space.tabs where tab.id == id {
          return .init(
            windowIndex: window.index,
            spaceIndex: space.index,
            tabIndex: tab.index
          )
        }
      }
    }
    return nil
  }

  func paneLocation(id: UUID) -> SPPaneLocation? {
    for window in windows {
      for space in window.spaces {
        for tab in space.tabs {
          for pane in tab.panes where pane.id == id {
            return .init(
              windowIndex: window.index,
              spaceIndex: space.index,
              tabIndex: tab.index,
              paneIndex: pane.index
            )
          }
        }
      }
    }
    return nil
  }
}
