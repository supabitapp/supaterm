import Testing

@testable import supaterm

struct TerminalCommandPaletteStateTests {
  @Test
  func emptyQueryShowsAllRowsInOriginalOrder() {
    let state = TerminalCommandPaletteState()

    #expect(state.visibleRows == TerminalCommandPaletteRow.samples)
    #expect(state.selectedIndex == 0)
  }

  @Test
  func typoQueryMatchesSettingsRow() {
    let state = TerminalCommandPaletteState(query: "setings")

    #expect(state.visibleRows.first?.id == "settings")
  }

  @Test
  func subtitleQueryMatchesPaneRows() {
    let state = TerminalCommandPaletteState(query: "pane")

    #expect(state.visibleRows.contains(where: { $0.id == "split-right" }))
    #expect(state.visibleRows.contains(where: { $0.id == "split-down" }))
  }

  @Test
  func noMatchQueryProducesEmptyVisibleRows() {
    let state = TerminalCommandPaletteState(query: "zzzzzz")

    #expect(state.visibleRows.isEmpty)
    #expect(state.selectedIndex == 0)
  }
}
