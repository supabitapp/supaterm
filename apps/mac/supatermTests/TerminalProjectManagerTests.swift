import Testing

@testable import supaterm

@MainActor
struct TerminalProjectManagerTests {
  @Test
  func tabsFlattenInProjectOrderAndPinnedFirst() throws {
    let first = TerminalProjectItem(name: "First")
    let second = TerminalProjectItem(name: "Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let regular = try #require(manager.createTab(title: "regular", in: first.id))
    let pinned = try #require(manager.createTab(title: "pinned", in: first.id, isPinned: true))
    let other = try #require(manager.createTab(title: "other", in: second.id))

    #expect(manager.tabs.map(\.id) == [pinned, regular, other])
  }

  @Test
  func movingTabChangesProjectAndPinLane() throws {
    let first = TerminalProjectItem(name: "First")
    let second = TerminalProjectItem(name: "Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let tabID = try #require(manager.createTab(title: "tab", in: first.id))

    manager.moveTab(tabID, to: second.id, isPinned: true, at: 0)

    #expect(manager.tabs(in: first.id).isEmpty)
    #expect(manager.tabs(in: second.id).map(\.id) == [tabID])
    #expect(manager.tab(for: tabID)?.isPinned == true)
  }

  @Test
  func closeBelowAndOthersAreProjectLocal() throws {
    let first = TerminalProjectItem(name: "First")
    let second = TerminalProjectItem(name: "Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let firstTab = try #require(manager.createTab(title: "first", in: first.id))
    let secondTab = try #require(manager.createTab(title: "second", in: first.id))
    _ = try #require(manager.createTab(title: "other", in: second.id))

    #expect(manager.tabIDsBelow(firstTab) == [secondTab])
    #expect(manager.otherTabIDs(firstTab) == [secondTab])
  }

  @Test
  func backgroundTabPreservesSelection() throws {
    let project = TerminalProjectItem(name: "Shell")
    let manager = TerminalProjectManager(projects: [project])
    let selected = try #require(manager.createTab(title: "Selected", in: project.id))

    _ = try #require(manager.createTab(title: "Background", in: project.id, selecting: false))

    #expect(manager.selectedTabId == selected)
  }
}
