import Foundation
import FuzzyMatch

struct TerminalCommandPaletteState: Equatable {
  let allRows: [TerminalCommandPaletteRow]
  var query: String
  var selectedIndex: Int
  var visibleRows: [TerminalCommandPaletteRow]

  init(
    query: String = "",
    selectedIndex: Int = 0,
    allRows: [TerminalCommandPaletteRow] = TerminalCommandPaletteRow.samples
  ) {
    self.allRows = allRows
    self.query = query
    visibleRows = Self.visibleRows(for: query, in: allRows)
    self.selectedIndex = Self.clampedSelection(selectedIndex, visibleRows.count)
  }

  mutating func moveSelection(by offset: Int) {
    selectedIndex = Self.clampedSelection(selectedIndex + offset, visibleRows.count)
  }

  mutating func select(_ index: Int) {
    guard visibleRows.indices.contains(index) else { return }
    selectedIndex = index
  }

  mutating func updateQuery(_ query: String) {
    self.query = query
    visibleRows = Self.visibleRows(for: query, in: allRows)
    selectedIndex = Self.clampedSelection(0, visibleRows.count)
  }

  private static let matcher = FuzzyMatcher()

  private static func clampedSelection(_ index: Int, _ rowCount: Int) -> Int {
    guard rowCount > 0 else { return 0 }
    return min(max(index, 0), rowCount - 1)
  }

  private static func visibleRows(
    for query: String,
    in allRows: [TerminalCommandPaletteRow]
  ) -> [TerminalCommandPaletteRow] {
    guard !query.isEmpty else { return allRows }

    let preparedQuery = matcher.prepare(query)
    var buffer = matcher.makeBuffer()
    let scoredRows: [ScoredRow] = allRows.enumerated().compactMap { element in
      let (index, row) = element
      guard let match = matcher.score(row.searchableText, against: preparedQuery, buffer: &buffer) else {
        return nil
      }
      return ScoredRow(index: index, row: row, score: match.score)
    }

    return scoredRows
      .sorted { lhs, rhs in
        if lhs.score == rhs.score {
          return lhs.index < rhs.index
        }
        return lhs.score > rhs.score
      }
      .map(\.row)
  }
}

struct TerminalCommandPaletteRow: Equatable, Identifiable {
  let id: String
  let symbol: String
  let title: String
  let subtitle: String

  var searchableText: String {
    "\(title) \(subtitle)"
  }

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

private struct ScoredRow {
  let index: Int
  let row: TerminalCommandPaletteRow
  let score: Double
}
