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

  static func resolveSpaceTarget(
    window: Int?,
    space: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedSpaceTarget {
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

  static func resolveTabTarget(
    window: Int?,
    space: SPTargetSelector?,
    tab: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedTabTarget {
    if let tabID = tab?.uuid {
      guard space == nil, window == nil else {
        throw ValidationError("--tab cannot be combined with --space or --window when using a UUID.")
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
      guard let tabIndex = tab?.index else {
        throw ValidationError("--space requires --tab.")
      }
      return .tab(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: tabIndex
      )
    }

    if let window, window < 1 {
      throw ValidationError("--window must be 1 or greater.")
    }
    if let spaceIndex = space?.index, spaceIndex < 1 {
      throw ValidationError("--space must be 1 or greater.")
    }
    if let tabIndex = tab?.index, tabIndex < 1 {
      throw ValidationError("--tab must be 1 or greater.")
    }
    if tab == nil {
      guard let context else {
        throw ValidationError("Run this command inside a Supaterm pane or provide --space and --tab.")
      }
      return .context(context.surfaceID)
    }
    guard let spaceIndex = space?.index else {
      throw ValidationError("--tab requires --space.")
    }
    return .tab(
      windowIndex: window ?? 1,
      spaceIndex: spaceIndex,
      tabIndex: tab!.index!
    )
  }

  static func resolvePaneOnlyTarget(
    window: Int?,
    space: SPTargetSelector?,
    tab: SPTargetSelector?,
    pane: SPTargetSelector?,
    context: SupatermCLIContext?,
    snapshot: @autoclosure () throws -> SupatermTreeSnapshot
  ) throws -> SPResolvedPaneOnlyTarget {
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

    if let spaceID = space?.uuid {
      guard window == nil else {
        throw ValidationError("--window cannot be used when --space is a UUID.")
      }
      let location = try snapshot().requireSpaceLocation(id: spaceID)
      guard let tabIndex = tab?.index else {
        throw ValidationError("--pane requires --tab.")
      }
      guard let paneIndex = pane?.index else {
        throw ValidationError("--pane requires --tab and --pane.")
      }
      return .pane(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    }

    if let window, window < 1 {
      throw ValidationError("--window must be 1 or greater.")
    }
    if let spaceIndex = space?.index, spaceIndex < 1 {
      throw ValidationError("--space must be 1 or greater.")
    }
    if let tabIndex = tab?.index, tabIndex < 1 {
      throw ValidationError("--tab must be 1 or greater.")
    }
    if let paneIndex = pane?.index, paneIndex < 1 {
      throw ValidationError("--pane must be 1 or greater.")
    }
    if pane == nil {
      guard let context else {
        throw ValidationError("Run this command inside a Supaterm pane or provide --space, --tab, and --pane.")
      }
      return .context(context.surfaceID)
    }
    guard let spaceIndex = space?.index else {
      throw ValidationError("--tab requires --space.")
    }
    guard let tabIndex = tab?.index else {
      throw ValidationError("--pane requires --tab.")
    }
    return .pane(
      windowIndex: window ?? 1,
      spaceIndex: spaceIndex,
      tabIndex: tabIndex,
      paneIndex: pane!.index!
    )
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

func resolvePublicNewTabTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedNewTabTarget {
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try ambientSpaceLocation(context: nil, snapshot: snapshot)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }

  switch reference {
  case .index(let spaceIndex):
    return .space(
      windowIndex: try defaultWindowIndex(context: context, snapshot: snapshot),
      spaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try snapshot.requireSpaceLocation(id: spaceID)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }
}

func resolvePublicSpaceTarget(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedSpaceTarget {
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try ambientSpaceLocation(context: nil, snapshot: snapshot)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }

  switch reference {
  case .index(let spaceIndex):
    return .space(
      windowIndex: try defaultWindowIndex(context: context, snapshot: snapshot),
      spaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try snapshot.requireSpaceLocation(id: spaceID)
    return .space(windowIndex: location.windowIndex, spaceIndex: location.spaceIndex)
  }
}

func resolvePublicTabTarget(
  _ reference: SPTabReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedTabTarget {
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try ambientTabLocation(context: nil, snapshot: snapshot)
    return .tab(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex
    )
  }

  switch reference {
  case .path(let spaceIndex, let tabIndex):
    return .tab(
      windowIndex: try defaultWindowIndex(context: context, snapshot: snapshot),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex
    )
  case .id(let tabID):
    let location = try snapshot.requireTabLocation(id: tabID)
    return .tab(
      windowIndex: location.windowIndex,
      spaceIndex: location.spaceIndex,
      tabIndex: location.tabIndex
    )
  }
}

func resolvePublicPaneTarget(
  _ reference: SPPaneReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPResolvedPaneOnlyTarget {
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try ambientPaneLocation(context: nil, snapshot: snapshot)
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
      windowIndex: try defaultWindowIndex(context: context, snapshot: snapshot),
      spaceIndex: spaceIndex,
      tabIndex: tabIndex,
      paneIndex: paneIndex
    )
  case .id(let paneID):
    let location = try snapshot.requirePaneLocation(id: paneID)
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
  guard let reference else {
    if let context {
      return .context(context.surfaceID)
    }
    let location = try ambientPaneLocation(context: nil, snapshot: snapshot)
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
    if let location = snapshot.paneLocation(id: id) {
      return .pane(
        windowIndex: location.windowIndex,
        spaceIndex: location.spaceIndex,
        tabIndex: location.tabIndex,
        paneIndex: location.paneIndex
      )
    }
    if let location = snapshot.tabLocation(id: id) {
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
  if let context {
    return .init(contextPaneID: context.surfaceID)
  }
  return .init(
    targetWindowIndex: try defaultWindowIndex(context: nil, snapshot: snapshot)
  )
}

func resolvePublicTabNavigationRequest(
  _ reference: SPSpaceReference?,
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SupatermTabNavigationRequest {
  guard let reference else {
    if let context {
      return .init(contextPaneID: context.surfaceID)
    }
    let location = try ambientSpaceLocation(context: nil, snapshot: snapshot)
    return .init(
      targetWindowIndex: location.windowIndex,
      targetSpaceIndex: location.spaceIndex
    )
  }

  switch reference {
  case .index(let spaceIndex):
    return .init(
      targetWindowIndex: try defaultWindowIndex(context: context, snapshot: snapshot),
      targetSpaceIndex: spaceIndex
    )
  case .id(let spaceID):
    let location = try snapshot.requireSpaceLocation(id: spaceID)
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

private func defaultWindowIndex(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> Int {
  if let context {
    if let paneLocation = snapshot.paneLocation(id: context.surfaceID) {
      return paneLocation.windowIndex
    }
    if let tabLocation = snapshot.tabLocation(id: context.tabID) {
      return tabLocation.windowIndex
    }
  }

  if let window = snapshot.windows.first(where: \.isKey) {
    return window.index
  }

  if snapshot.windows.count == 1, let window = snapshot.windows.first {
    return window.index
  }

  throw ValidationError("Run this command inside Supaterm or target by UUID.")
}

private func ambientSpaceLocation(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPSpaceLocation {
  if let context {
    if let paneLocation = snapshot.paneLocation(id: context.surfaceID) {
      return .init(windowIndex: paneLocation.windowIndex, spaceIndex: paneLocation.spaceIndex)
    }
    if let tabLocation = snapshot.tabLocation(id: context.tabID) {
      return .init(windowIndex: tabLocation.windowIndex, spaceIndex: tabLocation.spaceIndex)
    }
  }

  let windowIndex = try defaultWindowIndex(context: context, snapshot: snapshot)
  guard
    let window = snapshot.windows.first(where: { $0.index == windowIndex }),
    let space = window.spaces.first(where: \.isSelected) ?? window.spaces.first
  else {
    throw ValidationError("No space is available in the selected window.")
  }

  return .init(windowIndex: window.index, spaceIndex: space.index)
}

private func ambientTabLocation(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPTabLocation {
  if let context {
    if let paneLocation = snapshot.paneLocation(id: context.surfaceID) {
      return .init(
        windowIndex: paneLocation.windowIndex,
        spaceIndex: paneLocation.spaceIndex,
        tabIndex: paneLocation.tabIndex
      )
    }
    if let tabLocation = snapshot.tabLocation(id: context.tabID) {
      return tabLocation
    }
  }

  let spaceLocation = try ambientSpaceLocation(context: nil, snapshot: snapshot)
  guard
    let window = snapshot.windows.first(where: { $0.index == spaceLocation.windowIndex }),
    let space = window.spaces.first(where: { $0.index == spaceLocation.spaceIndex }),
    let tab = space.tabs.first(where: \.isSelected) ?? space.tabs.first
  else {
    throw ValidationError("No tab is available in the selected space.")
  }

  return .init(
    windowIndex: spaceLocation.windowIndex,
    spaceIndex: space.index,
    tabIndex: tab.index
  )
}

private func ambientPaneLocation(
  context: SupatermCLIContext?,
  snapshot: SupatermTreeSnapshot
) throws -> SPPaneLocation {
  if let context, let paneLocation = snapshot.paneLocation(id: context.surfaceID) {
    return paneLocation
  }

  let tabLocation = try ambientTabLocation(context: context, snapshot: snapshot)
  guard
    let window = snapshot.windows.first(where: { $0.index == tabLocation.windowIndex }),
    let space = window.spaces.first(where: { $0.index == tabLocation.spaceIndex }),
    let tab = space.tabs.first(where: { $0.index == tabLocation.tabIndex }),
    let pane = tab.panes.first(where: \.isFocused) ?? tab.panes.first
  else {
    throw ValidationError("No pane is available in the selected tab.")
  }

  return .init(
    windowIndex: tabLocation.windowIndex,
    spaceIndex: tabLocation.spaceIndex,
    tabIndex: tab.index,
    paneIndex: pane.index
  )
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
