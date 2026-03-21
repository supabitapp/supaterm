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
  func closingSelectedTabFallsBackToAdjacentSelection() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")
    let third = manager.createTab(title: "Terminal 3", icon: "terminal")

    manager.selectTab(second)
    manager.closeTab(second)
    #expect(manager.selectedTabId == first)

    manager.closeTab(first)
    #expect(manager.selectedTabId == third)

    manager.closeTab(third)
    #expect(manager.selectedTabId == nil)
    #expect(manager.tabs.isEmpty)
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
}
