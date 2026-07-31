import Foundation
import Observation

@MainActor
@Observable
final class TerminalSpaceInstance {
  let spaceID: TerminalSpaceID
  let tabManager = TerminalTabManager()
  var previousSelectedTabID: TerminalTabID?
  var collapsedTabGroupIDs: Set<TerminalTabGroupID> = []

  init(spaceID: TerminalSpaceID) {
    self.spaceID = spaceID
  }

  var tabs: [TerminalTabItem] {
    tabManager.tabs
  }

  var selectedTabID: TerminalTabID? {
    tabManager.selectedTabId
  }
}
