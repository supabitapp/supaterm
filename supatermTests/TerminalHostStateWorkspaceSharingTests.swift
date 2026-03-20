import ComposableArchitecture
import Sharing
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateWorkspaceSharingTests {
  @Test
  func newHostsUsePersistedDefaultWorkspaceSelection() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"], defaultSelectedIndex: 1)
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      #expect(firstHost.workspaces.map(\.name) == ["A", "B"])
      #expect(firstHost.selectedWorkspaceID == catalog.workspaces[1].id)
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[1].id)
    }
  }

  @Test
  func sharedCatalogChangesPropagateWithoutChangingExistingSelections() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      _ = firstHost.workspaceManager.selectWorkspace(catalog.workspaces[1].id)

      catalog.workspaces[1].name = "Shell"
      $sharedCatalog.withLock { $0 = catalog }
      await flushWorkspaceCatalogObservation()

      #expect(firstHost.workspaces.map(\.name) == ["A", "Shell"])
      #expect(secondHost.workspaces.map(\.name) == ["A", "Shell"])
      #expect(firstHost.selectedWorkspaceID == catalog.workspaces[1].id)
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
    }
  }

  @Test
  func persistedDefaultSeedsOnlyNewHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      catalog.defaultSelectedWorkspaceID = catalog.workspaces[1].id
      $sharedCatalog.withLock { $0 = catalog }
      await flushWorkspaceCatalogObservation()

      let thirdHost = TerminalHostState(managesTerminalSurfaces: false)

      #expect(firstHost.selectedWorkspaceID == catalog.workspaces[0].id)
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
      #expect(thirdHost.selectedWorkspaceID == catalog.workspaces[1].id)
    }
  }

  @Test
  func selectWorkspaceCommandPersistsDefaultWithoutChangingOtherHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      firstHost.handleCommand(.selectWorkspace(catalog.workspaces[1].id))
      await flushWorkspaceCatalogObservation()

      #expect(firstHost.selectedWorkspaceID == catalog.workspaces[1].id)
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
      #expect(sharedCatalog.defaultSelectedWorkspaceID == catalog.workspaces[1].id)
    }
  }

  @Test
  func createWorkspaceCommandPropagatesCatalogWithoutSelectingOtherHosts() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      let catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      let firstHost = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      firstHost.handleCommand(.createWorkspace)
      await flushWorkspaceCatalogObservation()

      let newWorkspace = try #require(firstHost.workspaces.last)
      #expect(firstHost.workspaces.map(\.name) == ["A", "B"])
      #expect(secondHost.workspaces.map(\.name) == ["A", "B"])
      #expect(firstHost.selectedWorkspaceID == newWorkspace.id)
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
      #expect(secondHost.workspaceManager.tabs(in: newWorkspace.id).isEmpty)
      #expect(sharedCatalog.defaultSelectedWorkspaceID == newWorkspace.id)
    }
  }

  @Test
  func newSharedWorkspaceDoesNotCreateTabsInOtherHosts() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A"])
      $sharedCatalog.withLock { $0 = catalog }

      _ = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)

      let newWorkspace = PersistedTerminalWorkspace(name: "B")
      catalog.workspaces.append(newWorkspace)
      catalog.defaultSelectedWorkspaceID = newWorkspace.id
      $sharedCatalog.withLock { $0 = catalog }
      await flushWorkspaceCatalogObservation()

      #expect(secondHost.workspaces.map(\.name) == ["A", "B"])
      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
      #expect(secondHost.workspaceManager.tabs(in: newWorkspace.id).isEmpty)
    }
  }

  @Test
  func deletingSharedWorkspaceRemovesLocalTabsAndKeepsPersistedDefault() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.terminalWorkspaceCatalog) var sharedCatalog = .default
      var catalog = makeCatalog(["A", "B"])
      $sharedCatalog.withLock { $0 = catalog }

      _ = TerminalHostState(managesTerminalSurfaces: false)
      let secondHost = TerminalHostState(managesTerminalSurfaces: false)
      let removedTabID = secondHost.workspaceManager.tabManager(for: catalog.workspaces[1].id)?
        .createTab(title: "Terminal 1", icon: "terminal")
      #expect(removedTabID != nil)
      _ = secondHost.workspaceManager.selectWorkspace(catalog.workspaces[1].id)

      catalog = TerminalWorkspaceCatalog(
        defaultSelectedWorkspaceID: catalog.workspaces[0].id,
        workspaces: [catalog.workspaces[0]]
      )
      $sharedCatalog.withLock { $0 = catalog }
      await flushWorkspaceCatalogObservation()

      #expect(secondHost.selectedWorkspaceID == catalog.workspaces[0].id)
      if let removedTabID {
        #expect(secondHost.workspaceManager.tab(for: removedTabID) == nil)
      }
      #expect(sharedCatalog.defaultSelectedWorkspaceID == catalog.workspaces[0].id)
    }
  }

  private func makeCatalog(
    _ workspaceNames: [String],
    defaultSelectedIndex: Int = 0
  ) -> TerminalWorkspaceCatalog {
    let workspaces = workspaceNames.map { PersistedTerminalWorkspace(name: $0) }
    return TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: workspaces[defaultSelectedIndex].id,
      workspaces: workspaces
    )
  }

  private func flushWorkspaceCatalogObservation() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}
