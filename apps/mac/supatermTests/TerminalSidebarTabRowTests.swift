import Testing

@testable import supaterm

@MainActor
struct TerminalSidebarTabRowTests {
  @Test
  func contextMenuIncludesChangeTabTitle() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "First")
    _ = terminal.spaceManager.tabCollection.createTab(title: "Second")

    #expect(
      try titles(for: tabID, terminal: terminal) == [
        "New Tab",
        "Pin Tab",
        "Move to New Group",
        "Move to Group...",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func pinnedContextMenuOmitsManualSaveLayout() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Pinned")
    _ = terminal.spaceManager.tabCollection.createTab(title: "Second")
    #expect(terminal.setTabPinned(tabID, isPinned: true) != nil)

    #expect(
      try titles(for: tabID, terminal: terminal) == [
        "New Tab",
        "Unpin Tab",
        "Move to New Group",
        "Move to Group...",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func groupedContextMenuSupportsExtractionAndRegrouping() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Grouped")
    _ = try #require(terminal.createGroup(title: "Group", containing: [tabID]))
    _ = terminal.spaceManager.tabCollection.createTab(title: "Second")

    #expect(
      try titles(for: tabID, terminal: terminal) == [
        "New Tab",
        "Pin Tab",
        "Move to New Group",
        "Move to Group...",
        "Remove from Group",
        "Change Tab Title...",
        "Close All Below",
        "Close Others",
        "Close",
      ]
    )
  }

  @Test
  func splitContextMenuIncludesMoveAllPanes() throws {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = terminal.spaceManager.tabCollection.createTab(title: "Split")

    let splitTitles = try titles(for: tabID, terminal: terminal, paneCount: 2)
    let singlePaneTitles = try titles(for: tabID, terminal: terminal, paneCount: 1)

    #expect(splitTitles.contains("Move All Panes to New Tabs"))
    #expect(!singlePaneTitles.contains("Move All Panes to New Tabs"))
  }

  private func titles(
    for tabID: TerminalTabID,
    terminal: TerminalHostState,
    paneCount: Int = 1
  ) throws -> [String] {
    let model = try #require(
      TerminalTabContextMenuModel.menu(
        for: .tab(tabID),
        contextualTabIDs: [tabID],
        snapshot: terminal.spaceManager.displayedInstance.tabSurfaceSnapshot,
        paneCount: paneCount,
        layout: .sidebar
      )
    )
    return model.items.compactMap(\.title)
  }
}
