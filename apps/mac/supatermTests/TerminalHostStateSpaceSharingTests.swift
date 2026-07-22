import ComposableArchitecture
import Sharing
import SupatermTerminalCore
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateSpaceSharingTests {
  @Test
  func newHostsUsePersistedDefaultSpaceSelection() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      #expect(firstHost.spaces.map(\.name) == ["A", "B"])
      #expect(firstHost.selectedSpaceID == catalog.spaces[1].id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[1].id)
    }
  }

  @Test
  func sharedCatalogChangesPropagateWithoutChangingExistingSelections() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      _ = firstHost.spaceManager.selectSpace(catalog.spaces[1].id)

      catalog.spaces[1].name = "Shell"
      $sharedCatalog.withLock { $0 = catalog }
      await flushSpaceCatalogObservation()

      #expect(firstHost.spaces.map(\.name) == ["A", "Shell"])
      #expect(secondHost.spaces.map(\.name) == ["A", "Shell"])
      #expect(firstHost.selectedSpaceID == catalog.spaces[1].id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
    }
  }

  @Test
  func persistedDefaultSeedsOnlyNewHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      catalog.defaultSelectedSpaceID = catalog.spaces[1].id
      $sharedCatalog.withLock { $0 = catalog }
      await flushSpaceCatalogObservation()

      let thirdHost = TerminalHostState(managesTerminalSurfaces: false)

      #expect(firstHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(thirdHost.selectedSpaceID == catalog.spaces[1].id)
    }
  }

  @Test
  func selectSpaceCommandPersistsDefaultWithoutChangingOtherHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      firstHost.handleCommand(.selectSpace(catalog.spaces[1].id))
      await flushSpaceCatalogObservation()

      #expect(firstHost.selectedSpaceID == catalog.spaces[1].id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(sharedCatalog.defaultSelectedSpaceID == catalog.spaces[1].id)
    }
  }

  @Test
  func adjacentSpaceCommandsWrapAndPersistDefaultSelection() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B", "C"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      host.handleCommand(.previousSpace)

      #expect(host.selectedSpaceID == catalog.spaces[2].id)
      #expect(sharedCatalog.defaultSelectedSpaceID == catalog.spaces[2].id)

      host.handleCommand(.nextSpace)

      #expect(host.selectedSpaceID == catalog.spaces[0].id)
      #expect(sharedCatalog.defaultSelectedSpaceID == catalog.spaces[0].id)
    }
  }

  @Test
  func createSpaceCommandPropagatesCatalogWithoutSelectingOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState()
      let secondHost = TerminalHostState()

      firstHost.handleCommand(.createSpace(name: "Build"))
      await flushSpaceCatalogObservation()

      let newSpace = try #require(firstHost.spaces.last)
      #expect(firstHost.spaces.map(\.name) == ["A", "Build"])
      #expect(secondHost.spaces.map(\.name) == ["A", "Build"])
      #expect(firstHost.selectedSpaceID == newSpace.id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(secondHost.spaceManager.tabs(in: newSpace.id).isEmpty)
      #expect(sharedCatalog.defaultSelectedSpaceID == newSpace.id)
    }
  }

  @Test
  func createSpaceWithoutFocusKeepsSelectionAndDefault() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let selectedSpaceID = host.selectedSpaceID
      let selectedTabID = host.selectedTabID
      let previousSelectedSpaceID = host.previousSelectedSpaceID

      let createdSpaceID = try host.createSpace(named: "Build", focus: false)

      #expect(host.selectedSpaceID == selectedSpaceID)
      #expect(host.selectedTabID == selectedTabID)
      #expect(host.previousSelectedSpaceID == previousSelectedSpaceID)
      #expect(sharedCatalog.defaultSelectedSpaceID == selectedSpaceID)
      #expect(host.spaceManager.tabs(in: createdSpaceID).count == 1)
    }
  }

  @Test
  func renameSpacePropagatesCatalogToOtherHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      let spaceID = catalog.spaces[0].id

      firstHost.handleCommand(.renameSpace(spaceID, "Shell"))
      await flushSpaceCatalogObservation()

      #expect(firstHost.spaces.map(\.name) == ["Shell"])
      #expect(secondHost.spaces.map(\.name) == ["Shell"])
      #expect(sharedCatalog.spaces.map(\.name) == ["Shell"])
    }
  }

  @Test
  func closingLastTabInSelectedSpaceSelectsAnotherNonEmptySpace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)
      let firstSpaceID = catalog.spaces[0].id
      let secondSpaceID = catalog.spaces[1].id
      let firstTabID = host.spaceManager.tabManager(for: firstSpaceID)?
        .createTab(title: "Terminal 1")
      let secondTabID = host.spaceManager.tabManager(for: secondSpaceID)?
        .createTab(title: "Terminal 2")
      _ = host.applySelectedSpace(firstSpaceID)

      host.performCloseTab(try #require(firstTabID))

      #expect(host.selectedSpaceID == secondSpaceID)
      #expect(host.spaceManager.selectedTabID(in: secondSpaceID) == secondTabID)
      #expect(host.spaceManager.tabs(in: firstSpaceID).isEmpty)
    }
  }

  @Test
  func closeSpaceRejectsOnlyRemainingSpace() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      #expect(throws: TerminalControlError.onlyRemainingSpace) {
        _ = try host.closeSpace(TerminalSpaceTarget(spaceID: catalog.spaces[0].id.rawValue))
      }
    }
  }

  @Test
  func createSpaceRejectsBlankName() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      #expect(throws: TerminalControlError.invalidSpaceName) {
        _ = try host.createSpace(named: "   ")
      }
    }
  }

  @Test
  func createSpaceRejectsDuplicateName() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      #expect(throws: TerminalControlError.spaceNameUnavailable) {
        _ = try host.createSpace(named: "A")
      }
    }
  }

  @Test
  func renameSpaceRejectsDuplicateNameWithoutMutation() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let host = TerminalHostState(managesTerminalSurfaces: false)

      #expect(throws: TerminalControlError.spaceNameUnavailable) {
        try host.renameSpace(catalog.spaces[1].id, to: "A")
      }
      #expect(host.spaces.map(\.name) == ["A", "B"])
    }
  }

  @Test
  func newSharedSpaceDoesNotCreateTabsInOtherHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      _ = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      let newSpace = PersistedTerminalSpace(name: "B")
      catalog.spaces.append(newSpace)
      catalog.defaultSelectedSpaceID = newSpace.id
      $sharedCatalog.withLock { $0 = catalog }
      await flushSpaceCatalogObservation()

      #expect(secondHost.spaces.map(\.name) == ["A", "B"])
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(secondHost.spaceManager.tabs(in: newSpace.id).isEmpty)
    }
  }

  @Test
  func deletingSharedSpaceRemovesLocalTabsAndKeepsPersistedDefault() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      _ = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      let removedTabID = secondHost.spaceManager.tabManager(for: catalog.spaces[1].id)?
        .createTab(title: "Terminal 1")
      #expect(removedTabID != nil)
      _ = secondHost.spaceManager.selectSpace(catalog.spaces[1].id)

      catalog = TerminalSpaceCatalog(
        defaultSelectedSpaceID: catalog.spaces[0].id,
        spaces: [catalog.spaces[0]]
      )
      $sharedCatalog.withLock { $0 = catalog }
      await flushSpaceCatalogObservation()

      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      if let removedTabID {
        #expect(secondHost.spaceManager.tab(for: removedTabID) == nil)
      }
      #expect(sharedCatalog.defaultSelectedSpaceID == catalog.spaces[0].id)
    }
  }

  private func makeCatalog(
    _ spaceNames: [String],
    defaultSelectedIndex: Int = 0
  ) -> TerminalSpaceCatalog {
    let spaces = spaceNames.map { PersistedTerminalSpace(name: $0) }
    return TerminalSpaceCatalog(
      defaultSelectedSpaceID: spaces[defaultSelectedIndex].id,
      spaces: spaces
    )
  }

  private func flushSpaceCatalogObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}
