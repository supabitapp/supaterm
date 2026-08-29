import Testing

@testable import supaterm

struct TerminalSidebarTabRowTests {
  @Test
  func contextMenuIncludesChangeTabTitle() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

    #expect(
      titles == [
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
  func pinnedContextMenuOmitsManualSaveLayout() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: true,
      hasTabsBelow: true,
      hasOtherTabs: true
    ).compactMap(\.title)

    #expect(
      titles == [
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
  func groupedContextMenuSupportsExtractionAndRegrouping() {
    let titles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: true,
      hasOtherTabs: true,
      isGrouped: true
    ).compactMap(\.title)

    #expect(
      titles == [
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
  func splitContextMenuIncludesMoveAllPanes() {
    let splitTabTitles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: false,
      hasOtherTabs: false,
      paneCount: 2
    ).compactMap(\.title)
    let singlePaneTabTitles = TerminalSidebarTabRow.contextMenuItems(
      isPinned: false,
      hasTabsBelow: false,
      hasOtherTabs: false
    ).compactMap(\.title)

    #expect(splitTabTitles.contains("Move All Panes to New Tabs"))
    #expect(!singlePaneTabTitles.contains("Move All Panes to New Tabs"))
  }
}
