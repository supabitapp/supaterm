import ComposableArchitecture
import Sharing
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
  func createSpaceCommandPropagatesCatalogWithoutSelectingOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalSpaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      firstHost.handleCommand(.createSpace)
      await flushSpaceCatalogObservation()

      let newSpace = try #require(firstHost.spaces.last)
      #expect(firstHost.spaces.map(\.name) == ["A", "B"])
      #expect(secondHost.spaces.map(\.name) == ["A", "B"])
      #expect(firstHost.selectedSpaceID == newSpace.id)
      #expect(secondHost.selectedSpaceID == catalog.spaces[0].id)
      #expect(secondHost.spaceManager.tabs(in: newSpace.id).isEmpty)
      #expect(sharedCatalog.defaultSelectedSpaceID == newSpace.id)
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
        .createTab(title: "Terminal 1", icon: "terminal")
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
