import AppKit
import ComposableArchitecture
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
  func movingTabWithoutIndexWithinItsSectionIsIdempotent() throws {
    try withProjectHost { host in
      let tabID = try #require(host.selectedTabID)
      let projectID = try #require(
        host.createProject(name: "Work", containing: [tabID])
      ).projectID

      let result = try host.moveProjectTab(
        SupatermMoveTabRequest(
          index: nil,
          isPinned: false,
          projectID: projectID.rawValue,
          target: SupatermTabTargetRequest(tabID: tabID.rawValue)
        )
      )

      #expect(result.target.tabID == tabID.rawValue)
      #expect(host.projectSections().first?.tabs.map(\.id) == [tabID])
    }
  }

  @Test
  func tabNavigationUsesSemanticProjectOrder() throws {
    try withProjectHost { host in
      let first = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let projectTab = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let last = try #require(host.selectedTabID)
      _ = try #require(host.createProject(name: "Work", containing: [projectTab]))
      host.selectTab(first)
      let request = TerminalTabNavigationRequest(spaceID: host.displayedSpaceID.rawValue)

      let next = try host.nextTab(request)
      #expect(next.target.tabID == last.rawValue)

      let previous = try host.previousTab(request)
      #expect(previous.target.tabID == first.rawValue)
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
      let registry = TerminalWindowRegistry()
      let store = Store(initialState: AppFeature.State()) { AppFeature() }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let window = NSWindow()
      registry.updateWindow(window, for: windowControllerID)
      try operation(host)
      withExtendedLifetime(window) {}
    }
  }
}
