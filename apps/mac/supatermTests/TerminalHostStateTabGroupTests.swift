import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateTabGroupTests {
  @Test
  func newTabInheritsSelectedGroupedAnchorAndPinnedRootLane() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
      let host = TerminalHostState(runtime: runtime, zmxSessionsEnabled: false)
      host.ensureInitialTab(focusing: false)
      let anchorTabID = try #require(host.selectedTabID)
      let groupID = try #require(
        host.createGroup(title: "Group", color: .green, containing: [anchorTabID])
      )
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      let groupedTabID = try #require(host.createTab(focusing: false))

      #expect(host.spaceManager.activeTabManager?.tabIDs(in: groupID) == [anchorTabID, groupedTabID])
      #expect(host.collapsedTabGroupIDs.contains(groupID))

      let focusedGroupedTabID = try #require(host.createTab(focusing: true))

      #expect(
        host.spaceManager.activeTabManager?.tabIDs(in: groupID)
          == [anchorTabID, groupedTabID, focusedGroupedTabID]
      )
      #expect(!host.collapsedTabGroupIDs.contains(groupID))

      #expect(host.ungroup(groupID))
      #expect(host.setTabPinned(anchorTabID, isPinned: true))
      host.selectTab(anchorTabID)

      let pinnedTabID = try #require(host.createTab(focusing: false))
      let manager = try #require(host.spaceManager.activeTabManager)

      #expect(manager.rootItemID(containing: pinnedTabID) == .tab(pinnedTabID))
      #expect(manager.isPinned(pinnedTabID) == true)
    }
  }

  @Test
  func selectingCollapsedGroupChildExpandsItsGroup() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let manager = try #require(host.spaceManager.activeTabManager)
      let first = manager.createTab(title: "First")
      let second = manager.createTab(title: "Second")
      let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      host.selectTab(first)

      #expect(!host.collapsedTabGroupIDs.contains(groupID))
      #expect(host.selectedTabID == first)
    }
  }

  @Test
  func desiredPinExtractsGroupedChildToPinnedRoot() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let manager = try #require(host.spaceManager.activeTabManager)
      let first = manager.createTab(title: "First")
      let second = manager.createTab(title: "Second")
      let groupID = try #require(manager.createGroup(title: "Group", containing: [first, second]))

      #expect(host.setTabPinned(second, isPinned: true))

      #expect(manager.pinnedRootItems.map(\.id) == [.tab(second)])
      #expect(manager.tabIDs(in: groupID) == [first])
    }
  }

  @Test
  func movingSelectedTabIntoCollapsedGroupExpandsIt() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let manager = try #require(host.spaceManager.activeTabManager)
      let source = manager.createTab(title: "Source")
      let grouped = manager.createTab(title: "Grouped")
      let groupID = try #require(manager.createGroup(title: "Group", containing: [grouped]))
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))
      host.selectTab(source)

      #expect(host.moveTab(source, to: .group(groupID, index: 1)))

      #expect(manager.selectedTabId == source)
      #expect(!host.collapsedTabGroupIDs.contains(groupID))
    }
  }

  @Test
  func closingSelectedTabExpandsCollapsedReplacementGroup() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
      let host = TerminalHostState(runtime: runtime, zmxSessionsEnabled: false)
      host.ensureInitialTab(focusing: false)
      let first = try #require(host.selectedTabID)
      let second = try #require(host.createTab(focusing: false))
      _ = try #require(host.createGroup(title: "First", containing: [first]))
      let secondGroupID = try #require(
        host.createGroup(title: "Second", containing: [second])
      )
      #expect(host.setGroupCollapsed(secondGroupID, isCollapsed: true))
      host.selectTab(first)

      host.closeTab(first)

      #expect(host.selectedTabID == second)
      #expect(!host.collapsedTabGroupIDs.contains(secondGroupID))
    }
  }

  @Test
  func closingUnrelatedTabKeepsSelectedGroupCollapsed() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let manager = try #require(host.spaceManager.activeTabManager)
      let selected = manager.createTab(title: "Selected")
      let unrelated = manager.createTab(title: "Unrelated")
      let groupID = try #require(manager.createGroup(title: "Group", containing: [selected]))
      host.selectTab(selected)
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      host.closeTab(unrelated)

      #expect(host.selectedTabID == selected)
      #expect(host.collapsedTabGroupIDs.contains(groupID))
    }
  }

  @Test
  func closeGroupResolvesConfirmationThenClosesCurrentChildrenAndRemovesGroup() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
      let host = TerminalHostState(runtime: runtime, zmxSessionsEnabled: false)
      host.ensureInitialTab(focusing: false)
      let first = try #require(host.selectedTabID)
      let second = try #require(host.createTab(focusing: false))
      let groupID = try #require(host.createGroup(title: "Group", containing: [first, second]))
      let survivor = try #require(
        host.createTab(
          focusing: false,
          at: .root(TerminalRootPlacement(isPinned: false, index: 1))
        )
      )
      let confirmingTabIDs = Set([first])
      #expect(
        TerminalHostState.anyTabNeedsCloseConfirmation(
          host.spaceManager.activeTabManager?.tabIDs(in: groupID) ?? [],
          tabNeedsCloseConfirmation: confirmingTabIDs.contains
        )
      )
      #expect(
        host.resolvedCloseRequest(
          for: .group(groupID),
          needsConfirmationOverride: true
        )
          == .request(
            TerminalCloseRequest(target: .group(groupID), needsConfirmation: true)
          )
      )

      let lateChild = try #require(
        host.createTab(
          focusing: false,
          at: .group(groupID, index: 2)
        )
      )
      host.closeGroup(groupID)

      let manager = try #require(host.spaceManager.activeTabManager)
      #expect(manager.group(for: groupID) == nil)
      #expect(host.spaceManager.tab(for: first) == nil)
      #expect(host.spaceManager.tab(for: second) == nil)
      #expect(host.spaceManager.tab(for: lateChild) == nil)
      #expect(host.spaceManager.tab(for: survivor) != nil)
    }
  }

  @Test
  func requestingCloseForEmptyGroupDeletesItImmediately() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let groupID = try #require(host.createGroup(title: "Empty", containing: []))

      host.requestCloseGroup(groupID)

      #expect(host.spaceManager.activeTabManager?.group(for: groupID) == nil)
    }
  }
}
