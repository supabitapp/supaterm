import Testing

@testable import supaterm

@MainActor
struct TerminalTabManagerTests {
  @Test
  func pinnedTabsFloatWithinEachProjectWithoutChangingProjectOrder() {
    let firstProjectID = TerminalProjectID()
    let secondProjectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [firstProjectID, secondProjectID])

    let firstRegular = manager.createTab(projectID: firstProjectID, title: "First regular")
    let secondRegular = manager.createTab(projectID: secondProjectID, title: "Second regular")
    let firstPinned = manager.createTab(
      projectID: firstProjectID,
      title: "First pinned",
      isPinned: true
    )
    let secondPinned = manager.createTab(
      projectID: secondProjectID,
      title: "Second pinned",
      isPinned: true
    )

    #expect(manager.tabs.map(\.id) == [firstPinned, firstRegular, secondPinned, secondRegular])
    #expect(manager.tabs(in: firstProjectID).map(\.id) == [firstPinned, firstRegular])
    #expect(manager.tabs(in: secondProjectID).map(\.id) == [secondPinned, secondRegular])
  }

  @Test
  func createTabAppendsRegularTabsAfterPinnedSectionAndSelectsIt() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let pinned = manager.createTab(projectID: projectID, title: "Pinned", isPinned: true)
    let first = manager.createTab(projectID: projectID, title: "Terminal 1")

    manager.selectTab(pinned)
    let second = manager.createTab(projectID: projectID, title: "Terminal 2")

    #expect(manager.tabs.map(\.id) == [pinned, first, second])
    #expect(manager.selectedTabId == second)
  }

  @Test
  func lockedTitlesAreNotOverwritten() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let editable = manager.createTab(projectID: projectID, title: "Terminal 1")
    let locked = manager.createTab(
      projectID: projectID,
      title: "Pinned",
      isTitleLocked: true
    )

    manager.updateTitle(editable, title: "zsh")
    manager.updateTitle(locked, title: "Ignored")

    #expect(manager.tabs.first(where: { $0.id == editable })?.title == "zsh")
    #expect(manager.tabs.first(where: { $0.id == locked })?.title == "Pinned")
  }

  @Test
  func setLockedTitlePreservesLiteralValueAndUnlocks() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])
    let tabID = manager.createTab(projectID: projectID, title: "Terminal 1")

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
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let first = manager.createTab(projectID: projectID, title: "Terminal 1")
    let second = manager.createTab(projectID: projectID, title: "Terminal 2")
    let third = manager.createTab(projectID: projectID, title: "Terminal 3")

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
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let first = manager.createTab(projectID: projectID, title: "Terminal 1")
    let second = manager.createTab(projectID: projectID, title: "Terminal 2")
    let third = manager.createTab(projectID: projectID, title: "Terminal 3")

    manager.selectTab(second)
    manager.closeTab(first)

    #expect(manager.selectedTabId == second)
    #expect(manager.tabs.map(\.id) == [second, third])
  }

  @Test
  func tabIDsBelowFollowVisibleOrder() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let pinned = manager.createTab(projectID: projectID, title: "Pinned", isPinned: true)
    let regularA = manager.createTab(projectID: projectID, title: "Terminal 1")
    let regularB = manager.createTab(projectID: projectID, title: "Terminal 2")

    #expect(manager.tabIDsBelow(pinned) == [regularA, regularB])
    #expect(manager.tabIDsBelow(regularA) == [regularB])
    #expect(manager.tabIDsBelow(regularB).isEmpty)
  }

  @Test
  func otherTabIDsExcludeAnchorAndPreserveOrder() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let first = manager.createTab(projectID: projectID, title: "Terminal 1")
    let second = manager.createTab(projectID: projectID, title: "Terminal 2")
    let third = manager.createTab(projectID: projectID, title: "Terminal 3")

    #expect(manager.otherTabIDs(second) == [first, third])
  }

  @Test
  func togglePinnedMovesTabsAcrossSections() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let first = manager.createTab(projectID: projectID, title: "Terminal 1")
    let second = manager.createTab(projectID: projectID, title: "Terminal 2")

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
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let pinnedA = manager.createTab(projectID: projectID, title: "Pinned A", isPinned: true)
    let pinnedB = manager.createTab(projectID: projectID, title: "Pinned B", isPinned: true)
    let regularA = manager.createTab(projectID: projectID, title: "Regular A")
    let regularB = manager.createTab(projectID: projectID, title: "Regular B")

    manager.setPinnedTabOrder([pinnedB, pinnedA], in: projectID)
    #expect(manager.tabs.map(\.id) == [pinnedB, pinnedA, regularA, regularB])

    manager.setRegularTabOrder([regularB, regularA], in: projectID)
    #expect(manager.tabs.map(\.id) == [pinnedB, pinnedA, regularB, regularA])
  }

  @Test
  func moveTabAppliesCrossSectionOrdersAtomically() {
    let projectID = TerminalProjectID()
    let manager = TerminalTabManager(projectIDs: [projectID])

    let pinned = manager.createTab(projectID: projectID, title: "Pinned", isPinned: true)
    let regularA = manager.createTab(projectID: projectID, title: "Regular A")
    let regularB = manager.createTab(projectID: projectID, title: "Regular B")

    manager.moveTab(
      regularA,
      pinnedOrder: [regularA, pinned],
      regularOrder: [regularB]
    )

    #expect(manager.pinnedTabs.map(\.id) == [regularA, pinned])
    #expect(manager.regularTabs.map(\.id) == [regularB])
    #expect(manager.tabs.map(\.id) == [regularA, pinned, regularB])
  }

}
