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
  func contextMenuIncludesTitleItemsInGhosttyOrder() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false)

    #expect(Array(menu.items.map(\.title).suffix(2)) == ["Change Tab Title...", "Change Terminal Title..."])
  }
}
