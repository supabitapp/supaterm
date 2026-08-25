import Dependencies
import Sharing
import SupaTheme
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateProjectTests {
  @Test
  func createProjectAssignsTabsWithoutChangingPinLanes() throws {
    try withProjectHost { host in
      let first = try #require(host.selectedTabID)
      #expect(host.setTabPinned(first, isPinned: true) != nil)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let second = try #require(host.selectedTabID)

      let projectID = try #require(
        host.createProject(
          name: "Work",
          color: .green,
          containing: [first, second]
        )
      ).projectID

      let collection = host.spaceManager.tabCollection
      #expect(collection.tab(for: first)?.projectID == projectID)
      #expect(collection.tab(for: first)?.isPinned == true)
      #expect(collection.tab(for: second)?.projectID == projectID)
      #expect(collection.tab(for: second)?.isPinned == false)
      #expect(host.projectSections().first?.tabs.map(\.id) == [first, second])
    }
  }

  @Test
  func pinningProjectDoesNotChangeItsTabs() throws {
    try withProjectHost { host in
      let first = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let second = try #require(host.selectedTabID)
      let projectID = try #require(
        host.createProject(name: "Work", containing: [first, second])
      ).projectID
      let tabs = host.spaceManager.tabCollection.canonicalTabs

      #expect(host.setProjectPinned(projectID, isPinned: true))

      #expect(host.projects.first?.isPinned == true)
      #expect(host.spaceManager.tabCollection.canonicalTabs == tabs)
    }
  }

  @Test
  func projectPinAndReorderCommandsAreIdempotent() throws {
    try withProjectHost { host in
      let firstID = try #require(host.createProject(name: "First")).projectID
      _ = try #require(host.createProject(name: "Second"))
      let target = SupatermProjectTargetRequest(projectID: firstID.rawValue)

      _ = try host.execute(.unpin(target))
      _ = try host.execute(.unpin(target))
      _ = try host.execute(
        .reorder(SupatermReorderProjectRequest(index: 1, target: target))
      )

      #expect(host.projects.map(\.name) == ["First", "Second"])
    }
  }

  @Test
  func selectedTabsInferOneSharedProjectRoot() throws {
    try withProjectHost { host in
      let first = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let second = try #require(host.selectedTabID)
      let expected = "/tmp/work"

      let root = host.suggestedProjectRoot(
        containing: [first, second],
        workingDirectoryPaths: { _ in ["/tmp/work/subdirectory"] },
        repositoryRoot: { _ in expected }
      )

      #expect(root == expected)
    }
  }

  @Test
  func pinningTabPreservesProjectMembership() throws {
    try withProjectHost { host in
      let tabID = try #require(host.selectedTabID)
      let projectID = try #require(
        host.createProject(name: "Work", containing: [tabID])
      ).projectID

      #expect(host.setTabPinned(tabID, isPinned: true) != nil)
      #expect(host.spaceManager.tabCollection.tab(for: tabID)?.projectID == projectID)
      #expect(host.spaceManager.tabCollection.tab(for: tabID)?.isPinned == true)

      #expect(host.setTabPinned(tabID, isPinned: false) != nil)
      #expect(host.spaceManager.tabCollection.tab(for: tabID)?.projectID == projectID)
      #expect(host.spaceManager.tabCollection.tab(for: tabID)?.isPinned == false)
    }
  }

  @Test
  func projectAndUnassignedCollapseStateIsPerSpace() throws {
    try withProjectHost { host in
      let projectID = try #require(host.createProject(name: "Work")).projectID
      let firstSpaceID = host.displayedSpaceID
      let secondSpaceID = try #require(host.spaces.last?.id)

      #expect(host.setProjectCollapsed(projectID, isCollapsed: true, in: firstSpaceID))
      #expect(host.setUnassignedCollapsed(true, in: firstSpaceID))

      #expect(host.isProjectCollapsed(projectID, in: firstSpaceID))
      #expect(!host.isProjectCollapsed(projectID, in: secondSpaceID))
      #expect(host.isUnassignedCollapsed(in: firstSpaceID))
      #expect(!host.isUnassignedCollapsed(in: secondSpaceID))
    }
  }

  @Test
  func removeNonemptyProjectRequiresConfirmationAndClosesEveryAssignedTab() throws {
    try withProjectHost { host in
      let first = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let second = try #require(host.selectedTabID)
      let projectID = try #require(
        host.createProject(name: "Work", containing: [first, second])
      ).projectID
      let target = SupatermProjectTargetRequest(projectID: projectID.rawValue)

      #expect(throws: TerminalControlError.projectCloseConfirmationRequired) {
        try host.execute(.remove(SupatermRemoveProjectRequest(confirmed: false, target: target)))
      }

      let result = try host.execute(
        .remove(SupatermRemoveProjectRequest(confirmed: true, target: target))
      )

      guard case .removedProject(let removal) = result else {
        Issue.record("Expected project removal")
        return
      }
      #expect(Set(removal.removedTabIDs) == Set([first.rawValue, second.rawValue]))
      #expect(!host.containsProject(projectID))
      #expect(host.spaceManager.allTabs.allSatisfy { $0.projectID != projectID })
    }
  }

  @Test
  func emptyProjectRemovalIsImmediate() throws {
    try withProjectHost { host in
      let projectID = try #require(host.createProject(name: "Work")).projectID

      let result = try host.execute(
        .remove(
          SupatermRemoveProjectRequest(
            confirmed: false,
            target: SupatermProjectTargetRequest(projectID: projectID.rawValue)
          )
        )
      )

      guard case .removedProject(let removal) = result else {
        Issue.record("Expected project removal")
        return
      }
      #expect(removal.removedTabIDs.isEmpty)
      #expect(!host.containsProject(projectID))
    }
  }

  private func withProjectHost(
    operation: (TerminalHostState) throws -> Void
  ) throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let host = TerminalHostState(spaceID: spaces[0].id)
      host.ensureInitialTab(focusing: false, startupCommand: nil)
      try operation(host)
    }
  }
}
