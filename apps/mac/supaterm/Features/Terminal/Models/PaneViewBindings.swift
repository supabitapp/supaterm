import SupatermTerminalCore

struct PaneViewBindings<View: AnyObject> {
  private var viewsByPaneID: [PaneID: View] = [:]

  var paneIDs: Set<PaneID> {
    Set(viewsByPaneID.keys)
  }

  subscript(paneID: PaneID) -> View? {
    viewsByPaneID[paneID]
  }

  mutating func bind(_ view: View, to paneID: PaneID) {
    if let previousPaneID = self.paneID(for: view) {
      viewsByPaneID.removeValue(forKey: previousPaneID)
    }
    viewsByPaneID[paneID] = view
  }

  @discardableResult
  mutating func unbind(_ paneID: PaneID) -> View? {
    viewsByPaneID.removeValue(forKey: paneID)
  }

  func paneID(for view: View) -> PaneID? {
    viewsByPaneID.first(where: { $0.value === view })?.key
  }
}
