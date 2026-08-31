import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceInstance {
  let spaceID: TerminalSpaceID
  let tabCollection = TerminalTabCollection()
  let tabSelectionState = TerminalTabSelectionState()
  var previousSelectedTabID: TerminalTabID?
  var collapsedTabGroupIDs: Set<TerminalTabGroupID> = []
  var pendingSession: TerminalSpaceSession?

  init(spaceID: TerminalSpaceID, pendingSession: TerminalSpaceSession? = nil) {
    self.spaceID = spaceID
    self.pendingSession = pendingSession
  }

  var tabs: [TerminalTabItem] {
    tabCollection.tabs
  }

  var selectedTabID: TerminalTabID? {
    tabCollection.selectedTabID
  }

  var tabSurfaceSnapshot: TerminalTabSurfaceSnapshot {
    TerminalTabSurfaceSnapshot(
      spaceID: spaceID,
      collection: tabCollection.snapshot,
      collapsedGroupIDs: collapsedTabGroupIDs
    )
  }
}
