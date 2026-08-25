import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceInstance {
  let spaceID: TerminalSpaceID
  let tabCollection = TerminalTabCollection()
  var previousSelectedTabID: TerminalTabID?
  var collapsedProjectIDs: Set<TerminalProjectID> = []
  var isUnassignedCollapsed = false
  var pendingSession: TerminalSpaceSession?

  init(spaceID: TerminalSpaceID, pendingSession: TerminalSpaceSession? = nil) {
    self.spaceID = spaceID
    self.pendingSession = pendingSession
  }

  var tabs: [TerminalTabItem] {
    tabCollection.canonicalTabs
  }

  var selectedTabID: TerminalTabID? {
    tabCollection.selectedTabID
  }

  var tabSurfaceSnapshot: TerminalTabSurfaceSnapshot {
    TerminalTabSurfaceSnapshot(
      spaceID: spaceID,
      collection: tabCollection.snapshot,
      collapsedProjectIDs: collapsedProjectIDs,
      isUnassignedCollapsed: isUnassignedCollapsed
    )
  }
}
