import Foundation
import SupatermCLIShared

nonisolated struct TerminalTabCollectionSnapshot: Equatable, Sendable {
  let pinnedTabs: [TerminalTabItem]
  let regularTabs: [TerminalTabItem]
  let selectedTabID: TerminalTabID?
  let topologyRevision: UInt64

  var canonicalTabs: [TerminalTabItem] {
    pinnedTabs + regularTabs
  }

  func tabs(orderedProjectIDs: [TerminalProjectID]) -> [TerminalTabItem] {
    let tabsByID = Dictionary(uniqueKeysWithValues: canonicalTabs.map { ($0.id, $0) })
    let layout = SupatermProjectLayout.make(
      orderedProjectIDs: orderedProjectIDs,
      pinnedTabs: pinnedTabs.map {
        SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
      },
      regularTabs: regularTabs.map {
        SupatermProjectTabRecord(id: $0.id, projectID: $0.projectID)
      }
    )
    return layout.semanticTabIDs.compactMap { tabsByID[$0] }
  }
}

nonisolated struct TerminalTabSurfaceSnapshot: Equatable, Sendable {
  let spaceID: TerminalSpaceID
  let collection: TerminalTabCollectionSnapshot
  let collapsedProjectIDs: Set<TerminalProjectID>
  let isUnassignedCollapsed: Bool
}
