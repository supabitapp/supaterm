import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalProjectManagerTests {
  @Test
  func tabsFlattenInProjectOrderAndPinnedFirst() throws {
    let first = project("First")
    let second = project("Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let regular = try #require(manager.createTab(title: "regular", in: first.id))
    let pinned = try #require(manager.createTab(title: "pinned", in: first.id, isPinned: true))
    let other = try #require(manager.createTab(title: "other", in: second.id))

    #expect(manager.tabs.map(\.id) == [pinned, regular, other])
  }

  @Test
  func movingTabChangesProjectAndPinLane() throws {
    let first = project("First")
    let second = project("Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let tabID = try #require(manager.createTab(title: "tab", in: first.id))

    manager.moveTab(tabID, to: second.id, isPinned: true, at: 0)

    #expect(manager.tabs(in: first.id).isEmpty)
    #expect(manager.tabs(in: second.id).map(\.id) == [tabID])
    #expect(manager.tab(for: tabID)?.isPinned == true)
  }

  @Test
  func movingTabDownUsesPostRemovalLaneIndex() throws {
    let project = project("Shell")
    let manager = TerminalProjectManager(projects: [project])
    let first = try #require(manager.createTab(title: "first", in: project.id))
    let second = try #require(manager.createTab(title: "second", in: project.id))
    let third = try #require(manager.createTab(title: "third", in: project.id))

    manager.moveTab(first, to: project.id, isPinned: false, at: 2)

    #expect(manager.tabs(in: project.id).map(\.id) == [second, third, first])
  }

  @Test
  func movingTabUpPreservesSelection() throws {
    let project = project("Shell")
    let manager = TerminalProjectManager(projects: [project])
    let first = try #require(manager.createTab(title: "first", in: project.id))
    _ = try #require(manager.createTab(title: "second", in: project.id))
    let third = try #require(manager.createTab(title: "third", in: project.id))
    manager.selectTab(third)

    manager.moveTab(third, to: project.id, isPinned: false, at: 0)

    #expect(manager.tabs(in: project.id).map(\.id).first == third)
    #expect(manager.selectedTabId == third)
    #expect(manager.tab(for: first) != nil)
  }

  @Test
  func movingTabAcrossPinLaneKeepsPinnedFirst() throws {
    let project = project("Shell")
    let manager = TerminalProjectManager(projects: [project])
    let first = try #require(manager.createTab(title: "first", in: project.id))
    let second = try #require(manager.createTab(title: "second", in: project.id))

    manager.moveTab(second, to: project.id, isPinned: true, at: 0)

    #expect(manager.tabs(in: project.id).map(\.id) == [second, first])
    #expect(manager.tabs(in: project.id).map(\.isPinned) == [true, false])
  }

  @Test
  func closeBelowAndOthersAreProjectLocal() throws {
    let first = project("First")
    let second = project("Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let firstTab = try #require(manager.createTab(title: "first", in: first.id))
    let secondTab = try #require(manager.createTab(title: "second", in: first.id))
    _ = try #require(manager.createTab(title: "other", in: second.id))

    #expect(manager.tabIDsBelow(firstTab) == [secondTab])
    #expect(manager.otherTabIDs(firstTab) == [secondTab])
  }

  @Test
  func backgroundTabPreservesSelection() throws {
    let project = project("Shell")
    let manager = TerminalProjectManager(projects: [project])
    let selected = try #require(manager.createTab(title: "Selected", in: project.id))

    _ = try #require(manager.createTab(title: "Background", in: project.id, selecting: false))

    #expect(manager.selectedTabId == selected)
  }

  @Test
  func applyingProjectsReordersWholeGroupsAndReportsRemovedTabs() throws {
    let first = project("First")
    let second = project("Second")
    let manager = TerminalProjectManager(projects: [first, second])
    let firstTab = try #require(manager.createTab(title: "first", in: first.id))
    let secondTab = try #require(manager.createTab(title: "second", in: second.id))
    let pinnedFirst = TerminalProjectItem(
      id: first.id,
      directoryURL: first.directoryURL,
      isPinned: true
    )

    let reorderedRemovedTabs = manager.applyProjects([second, pinnedFirst])

    #expect(reorderedRemovedTabs.isEmpty)
    #expect(manager.projects == [second, pinnedFirst])
    #expect(manager.tabs.map(\.id) == [secondTab, firstTab])

    let removedTabs = manager.applyProjects([pinnedFirst])

    #expect(removedTabs == [secondTab])
    #expect(manager.tabs.map(\.id) == [firstTab])
    #expect(manager.selectedTabId == firstTab)
  }

  private func project(_ name: String) -> TerminalProjectItem {
    TerminalProjectItem(
      directoryURL: URL(fileURLWithPath: "/tmp/supaterm-project-manager-tests/\(name)", isDirectory: true)
    )
  }
}
