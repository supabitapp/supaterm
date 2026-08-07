import Foundation

nonisolated struct TerminalTabCollectionSnapshot: Equatable, Sendable {
  let rootItems: [TerminalTabRootItem]
  let selectedTabID: TerminalTabID?
  let topologyRevision: UInt64

  var tabs: [TerminalTabItem] {
    rootItems.flatMap(\.tabs)
  }
}

nonisolated struct TerminalTabSurfaceSnapshot: Equatable, Sendable {
  let spaceID: TerminalSpaceID
  let collection: TerminalTabCollectionSnapshot
  let collapsedGroupIDs: Set<TerminalTabGroupID>
}
