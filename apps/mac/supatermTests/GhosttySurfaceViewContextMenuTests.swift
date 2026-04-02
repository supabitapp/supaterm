import AppKit
import Testing

@testable import supaterm

@MainActor
struct GhosttySurfaceViewContextMenuTests {
  @Test
  func contextMenuDisablesWritingToolsInsertion() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false)

    #expect(!menu.automaticallyInsertsWritingToolsItems)
  }

  @Test
  func contextMenuIncludesCopyOnlyWhenThereIsSelection() {
    let menuWithSelection = GhosttySurfaceView.contextMenu(hasSelection: true)
    let menuWithoutSelection = GhosttySurfaceView.contextMenu(hasSelection: false)

    #expect(menuWithSelection.items.first?.title == "Copy")
    #expect(menuWithoutSelection.items.first?.title == "Paste")
  }

  @Test
  func contextMenuIncludesChangeTerminalTitleItem() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false)

    #expect(menu.items.contains { $0.title == "Change Terminal Title..." })
  }
}
