import ComposableArchitecture
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStatePinnedTabSharingTests {
  @Test
  func pinningTabPersistsAndPropagatesAcrossHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState(managesTerminalSurfaces: false)

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      #expect(sharedCatalog.tabs(in: selectedSpaceID).map(\.id) == [tabID])
      #expect(receiver.spaceManager.tabs(in: selectedSpaceID).map(\.id) == [tabID])
      #expect(receiver.spaceManager.tabs(in: selectedSpaceID).allSatisfy { $0.isPinned })
    }
  }

  @Test
  func renamingPinnedTabPropagatesAcrossHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState(managesTerminalSurfaces: false)

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let sharedTab = try #require(receiver.spaceManager.tab(for: tabID))
      #expect(sharedTab.title == "Pinned Shell")
      #expect(sharedTab.isTitleLocked)
    }
  }

  @Test
  func renamingPinnedTabDoesNotRebuildExistingPinnedTabsInOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let receiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(receiverPaneIDs == originalReceiverPaneIDs)
      #expect(receiver.spaceManager.tab(for: tabID)?.title == "Pinned Shell")
      #expect(receiver.spaceManager.tab(for: tabID)?.isTitleLocked == true)
    }
  }

  @Test
  func paneChangesDoNotRebuildExistingPinnedTabsInOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(originalReceiverPaneIDs.count == 1)

      _ = try writer.createPane(
        .init(
          initialInput: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      await flushPinnedTabCatalogObservation()

      let receiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      #expect(receiverPaneIDs == originalReceiverPaneIDs)

      let restored = TerminalHostState()
      await flushPinnedTabCatalogObservation()
      #expect(restored.trees[tabID]?.leaves().count == 1)

      writer.handleCommand(.savePinnedTabLayout(tabID))
      await flushPinnedTabCatalogObservation()

      let restoredAfterSave = TerminalHostState()
      await flushPinnedTabCatalogObservation()
      #expect(restoredAfterSave.trees[tabID]?.leaves().count == 2)
    }
  }

  @Test
  func renamingPinnedTabDoesNotSaveUnsavedLayoutChanges() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      _ = try writer.createPane(
        .init(
          initialInput: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
        )
      )
      await flushPinnedTabCatalogObservation()

      writer.setLockedTabTitle("Pinned Shell", for: tabID)
      await flushPinnedTabCatalogObservation()

      let restored = TerminalHostState()
      await flushPinnedTabCatalogObservation()

      #expect(restored.trees[tabID]?.leaves().count == 1)
      #expect(restored.spaceManager.tab(for: tabID)?.title == "Pinned Shell")
      #expect(restored.spaceManager.tab(for: tabID)?.isTitleLocked == true)
    }
  }

  @Test
  func unpinningPinnedTabConvertsExistingCopiesIntoRegularTabs() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let originalReceiverPaneIDs = try #require(receiver.trees[tabID]?.leaves().map(\.id))
      @Shared(.terminalPinnedTabCatalog) var sharedCatalog = .default
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      #expect(writer.spaceManager.tab(for: tabID)?.isPinned == false)
      #expect(receiver.spaceManager.tab(for: tabID)?.isPinned == false)
      #expect(receiver.regularTabs.map(\.id).contains(tabID))
      #expect(receiver.trees[tabID]?.leaves().map(\.id) == originalReceiverPaneIDs)
      #expect(sharedCatalog.tabs(in: selectedSpaceID).isEmpty)
    }
  }

  @Test
  func repinningSharedTabPromotesRegularCopiesInsteadOfDuplicatingThem() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let writer = TerminalHostState()
      let receiver = TerminalHostState()

      writer.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let tabID = try #require(writer.selectedTabID)
      let selectedSpaceID = try #require(writer.selectedSpaceID)

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      writer.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      receiver.handleCommand(.togglePinned(tabID))
      await flushPinnedTabCatalogObservation()

      let writerTabs = writer.spaceManager.tabs(in: selectedSpaceID)
      #expect(writerTabs.map(\.id) == [tabID])
      #expect(writerTabs.map(\.isPinned) == [true])
      #expect(writer.regularTabs.isEmpty)
      #expect(Set(writerTabs.map(\.id)).count == writerTabs.count)
    }
  }

  @Test
  func removingSharedSpacePrunesPinnedTabs() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedSpaceCatalog = .default
      @Shared(.terminalPinnedTabCatalog) var sharedPinnedTabCatalog = .default

      let firstSpace = PersistedTerminalSpace(name: "A")
      let secondSpace = PersistedTerminalSpace(name: "B")
      $sharedSpaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: firstSpace.id,
          spaces: [firstSpace, secondSpace]
        )
      }
      $sharedPinnedTabCatalog.withLock {
        $0 = TerminalPinnedTabCatalog(
          spaces: [
            .init(
              id: secondSpace.id,
              tabs: [
                .init(
                  id: TerminalTabID(),
                  session: .init(
                    isPinned: true,
                    lockedTitle: "Pinned",
                    focusedPaneIndex: 0,
                    root: .leaf(.init(workingDirectoryPath: nil))
                  )
                )
              ]
            )
          ]
        )
      }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      $sharedSpaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: firstSpace.id,
          spaces: [firstSpace]
        )
      }
      await flushPinnedTabCatalogObservation()

      #expect(host.spaces.map(\.id) == [firstSpace.id])
      #expect(sharedPinnedTabCatalog.spaces.isEmpty)
    }
  }

  @Test
  func restorationSnapshotExcludesPinnedTabsAndRestoreUsesSharedCatalog() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
      initializeGhosttyForTests()
    } operation: {
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

      let pinnedTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(pinnedTabID))
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))

      let selectedSpaceID = try #require(host.selectedSpaceID)
      let snapshot = host.restorationSnapshot()

      #expect(snapshot.spaces.first(where: { $0.id == selectedSpaceID })?.tabs.count == 1)
      #expect(snapshot.spaces.flatMap(\.tabs).allSatisfy { !$0.isPinned })

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).map(\.isPinned) == [true, false])
      #expect(restored.spaceManager.tabs(in: selectedSpaceID).map(\.id).contains(pinnedTabID))
    }
  }

  private func flushPinnedTabCatalogObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}
