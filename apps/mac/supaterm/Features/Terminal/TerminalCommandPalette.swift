import Foundation

struct TerminalCommandPaletteState: Equatable {
  var query = ""
  var selectedIndex = 0

  var rows: [TerminalCommandPaletteRow] {
    TerminalCommandPaletteRow.samples
  }

  mutating func moveSelection(by offset: Int) {
    guard !rows.isEmpty else {
      selectedIndex = 0
      return
    }
    selectedIndex = min(max(selectedIndex + offset, 0), rows.count - 1)
  }

  mutating func select(_ index: Int) {
    guard rows.indices.contains(index) else { return }
    selectedIndex = index
  }
}

struct TerminalCommandPaletteRow: Equatable, Identifiable {
  let id: String
  let symbol: String
  let title: String
  let subtitle: String

  static let samples: [Self] = [
    .init(id: "new-tab", symbol: "plus", title: "New Tab", subtitle: "Window"),
    .init(
      id: "split-right",
      symbol: "rectangle.righthalf.inset.filled",
      title: "Split Right",
      subtitle: "Pane"
    ),
    .init(
      id: "split-down",
      symbol: "rectangle.bottomhalf.inset.filled",
      title: "Split Down",
      subtitle: "Pane"
    ),
    .init(id: "toggle-sidebar", symbol: "sidebar.leading", title: "Toggle Sidebar", subtitle: "View"),
    .init(id: "rename-space", symbol: "square.and.pencil", title: "Rename Space", subtitle: "Spaces"),
    .init(id: "settings", symbol: "gearshape", title: "Settings", subtitle: "App"),
  ]
}
