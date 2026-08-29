import AppKit
import Testing

@testable import supaterm

@MainActor
struct GhosttySurfaceViewContextMenuTests {
  @Test
  func contextMenuDisablesWritingToolsInsertion() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false, target: NSObject())

    #expect(!menu.automaticallyInsertsWritingToolsItems)
  }

  @Test
  func contextMenuIncludesCopyOnlyWhenThereIsSelection() {
    let target = NSObject()
    let menuWithSelection = GhosttySurfaceView.contextMenu(hasSelection: true, target: target)
    let menuWithoutSelection = GhosttySurfaceView.contextMenu(hasSelection: false, target: target)

    #expect(menuWithSelection.items.first?.title == "Copy")
    #expect(menuWithoutSelection.items.first?.title == "Paste")
  }

  @Test
  func contextMenuIncludesTitleItemsInGhosttyOrder() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false, target: NSObject())

    #expect(Array(menu.items.map(\.title).suffix(2)) == ["Change Tab Title...", "Change Terminal Title..."])
  }

  @Test
  func contextMenuIncludesMoveOnlyForSplitPane() {
    let target = NSObject()
    let availableMenu = GhosttySurfaceView.contextMenu(
      hasSelection: false,
      canMoveToNewTab: true,
      target: target
    )
    let unavailableMenu = GhosttySurfaceView.contextMenu(
      hasSelection: false,
      target: target
    )
    let moveItem = availableMenu.items.first { $0.title == "Move to a New Tab" }

    #expect(moveItem?.image?.accessibilityDescription == "Move to a New Tab")
    #expect(!unavailableMenu.items.contains { $0.title == "Move to a New Tab" })
  }

  @Test
  func contextMenuUsesItemTitlesForImageAccessibilityDescriptions() {
    let menu = GhosttySurfaceView.contextMenu(hasSelection: false, target: NSObject())
    let expectedTitles = Set([
      "Split Right",
      "Split Left",
      "Split Down",
      "Split Up",
      "Close Pane",
      "Reset Terminal",
      "Change Tab Title...",
      "Change Terminal Title...",
    ])

    for item in menu.items where expectedTitles.contains(item.title) {
      #expect(item.image != nil)
      #expect(item.image?.accessibilityDescription == item.title)
    }
  }

  @Test
  func contextMenuActionsTargetTheClickedPane() {
    let target = NSObject()
    let menu = GhosttySurfaceView.contextMenu(hasSelection: true, target: target)

    for item in menu.items where item.action != nil {
      #expect(item.target === target)
    }
  }
}
