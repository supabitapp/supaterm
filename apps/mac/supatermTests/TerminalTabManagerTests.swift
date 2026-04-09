import Testing

@testable import supaterm

@MainActor
struct TerminalTabManagerTests {
  @Test
  func createTabAppendsRegularTabsAfterPinnedSectionAndSelectsIt() {
    let manager = TerminalTabManager()

    let pinned = manager.createTab(title: "Pinned", icon: "terminal", isPinned: true)
    let first = manager.createTab(title: "Terminal 1", icon: "terminal")

    manager.selectTab(pinned)
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")

    #expect(manager.tabs.map(\.id) == [pinned, first, second])
    #expect(manager.selectedTabId == second)
  }

  @Test
  func lockedTitlesAreNotOverwritten() {
    let manager = TerminalTabManager()

    let editable = manager.createTab(title: "Terminal 1", icon: "terminal")
    let locked = manager.createTab(
      title: "Pinned",
      icon: "terminal",
      isTitleLocked: true
    )

    manager.updateTitle(editable, title: "zsh")
    manager.updateTitle(locked, title: "Ignored")

    #expect(manager.tabs.first(where: { $0.id == editable })?.title == "zsh")
    #expect(manager.tabs.first(where: { $0.id == locked })?.title == "Pinned")
  }

  @Test
  func setLockedTitlePreservesLiteralValueAndUnlocks() {
    let manager = TerminalTabManager()
    let tabID = manager.createTab(title: "Terminal 1", icon: "terminal")

    manager.setLockedTitle(tabID, title: "  ")

    #expect(manager.tabs.first(where: { $0.id == tabID })?.isTitleLocked == true)
    #expect(manager.tabs.first(where: { $0.id == tabID })?.title == "  ")

    manager.setLockedTitle(tabID, title: nil)
    manager.updateTitle(tabID, title: "zsh")

    #expect(manager.tabs.first(where: { $0.id == tabID })?.isTitleLocked == false)
    #expect(manager.tabs.first(where: { $0.id == tabID })?.title == "zsh")
  }

  @Test
  func closingSelectedTabPrefersNextTabBeforePrevious() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")
    let third = manager.createTab(title: "Terminal 3", icon: "terminal")

    manager.selectTab(second)
    manager.closeTab(second)
    #expect(manager.selectedTabId == third)

    manager.closeTab(third)
    #expect(manager.selectedTabId == first)

    manager.closeTab(first)
    #expect(manager.selectedTabId == nil)
    #expect(manager.tabs.isEmpty)
  }

  @Test
  func closingUnselectedTabKeepsSelection() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")
    let third = manager.createTab(title: "Terminal 3", icon: "terminal")

    manager.selectTab(second)
    manager.closeTab(first)

    #expect(manager.selectedTabId == second)
    #expect(manager.tabs.map(\.id) == [second, third])
  }

  @Test
  func tabIDsBelowFollowVisibleOrder() {
    let manager = TerminalTabManager()

    let pinned = manager.createTab(title: "Pinned", icon: "terminal", isPinned: true)
    let regularA = manager.createTab(title: "Terminal 1", icon: "terminal")
    let regularB = manager.createTab(title: "Terminal 2", icon: "terminal")

    #expect(manager.tabIDsBelow(pinned) == [regularA, regularB])
    #expect(manager.tabIDsBelow(regularA) == [regularB])
    #expect(manager.tabIDsBelow(regularB).isEmpty)
  }

  @Test
  func otherTabIDsExcludeAnchorAndPreserveOrder() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")
    let third = manager.createTab(title: "Terminal 3", icon: "terminal")

    #expect(manager.otherTabIDs(second) == [first, third])
  }

  @Test
  func togglePinnedMovesTabsAcrossSections() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")

    manager.togglePinned(second)
    #expect(manager.pinnedTabs.map(\.id) == [second])
    #expect(manager.regularTabs.map(\.id) == [first])
    #expect(manager.tabs.map(\.id) == [second, first])

    manager.togglePinned(second)
    #expect(manager.pinnedTabs.isEmpty)
    #expect(manager.tabs.map(\.id) == [first, second])
  }

  @Test
  func sectionReorderingOnlyAffectsThatSection() {
    let manager = TerminalTabManager()

    let pinnedA = manager.createTab(title: "Pinned A", icon: "terminal", isPinned: true)
    let pinnedB = manager.createTab(title: "Pinned B", icon: "terminal", isPinned: true)
    let regularA = manager.createTab(title: "Regular A", icon: "terminal")
    let regularB = manager.createTab(title: "Regular B", icon: "terminal")

    manager.setPinnedTabOrder([pinnedB, pinnedA])
    #expect(manager.tabs.map(\.id) == [pinnedB, pinnedA, regularA, regularB])

    manager.setRegularTabOrder([regularB, regularA])
    #expect(manager.tabs.map(\.id) == [pinnedB, pinnedA, regularB, regularA])
  }

  @Test
  func moveTabAppliesCrossSectionOrdersAtomically() {
    let manager = TerminalTabManager()

    let pinned = manager.createTab(title: "Pinned", icon: "terminal", isPinned: true)
    let regularA = manager.createTab(title: "Regular A", icon: "terminal")
    let regularB = manager.createTab(title: "Regular B", icon: "terminal")

    manager.moveTab(
      regularA,
      pinnedOrder: [regularA, pinned],
      regularOrder: [regularB]
    )

    #expect(manager.pinnedTabs.map(\.id) == [regularA, pinned])
    #expect(manager.regularTabs.map(\.id) == [regularB])
    #expect(manager.tabs.map(\.id) == [regularA, pinned, regularB])
  }

  @Test
  func createTabWithCurrentInsertionAddsAfterSelectedRegularTab() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")

    let third = manager.createTab(
      title: "Terminal 3",
      icon: "terminal",
      insertion: .after(first)
    )

    #expect(manager.tabs.map(\.id) == [first, third, second])
    #expect(manager.selectedTabId == third)
  }

  @Test
  func createTabAfterPinnedAnchorInsertsAtFirstRegularPosition() {
    let manager = TerminalTabManager()

    let pinnedA = manager.createTab(title: "Pinned A", icon: "terminal", isPinned: true)
    let pinnedB = manager.createTab(title: "Pinned B", icon: "terminal", isPinned: true)
    let regular = manager.createTab(title: "Regular", icon: "terminal")

    let inserted = manager.createTab(
      title: "Inserted",
      icon: "terminal",
      insertion: .after(pinnedA)
    )

    #expect(manager.tabs.map(\.id) == [pinnedA, pinnedB, inserted, regular])
  }

  @Test
  func createTabWithMissingAnchorFallsBackToEnd() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")

    let inserted = manager.createTab(
      title: "Terminal 3",
      icon: "terminal",
      insertion: .after(TerminalTabID())
    )

    #expect(manager.tabs.map(\.id) == [first, second, inserted])
  }
}
