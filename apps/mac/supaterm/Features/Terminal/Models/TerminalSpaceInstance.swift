import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceInstance {
  let spaceID: TerminalSpaceID
  let tabManager = TerminalTabManager()
  var previousSelectedTabID: TerminalTabID?
  var collapsedTabGroupIDs: Set<TerminalTabGroupID> = []
  var pendingSession: TerminalSpaceSession?

  init(spaceID: TerminalSpaceID, pendingSession: TerminalSpaceSession? = nil) {
    self.spaceID = spaceID
    self.pendingSession = pendingSession
  }

  var tabs: [TerminalTabItem] {
    tabManager.tabs
  }

  var selectedTabID: TerminalTabID? {
    tabManager.selectedTabId
  }
}
