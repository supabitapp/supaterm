import Testing

@testable import supaterm

@MainActor
struct TerminalTabManagerTests {
  @Test
  func createTabInsertsAfterSelectedTabAndSelectsIt() {
    let manager = TerminalTabManager()

    let first = manager.createTab(title: "Terminal 1", icon: "terminal")
    let second = manager.createTab(title: "Terminal 2", icon: "terminal")

    manager.selectTab(first)
    let third = manager.createTab(title: "Terminal 3", icon: "terminal")

    #expect(manager.tabs.map(\.id) == [first, third, second])
    #expect(manager.selectedTabId == third)
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
}
