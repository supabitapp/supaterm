import AppKit
import ComposableArchitecture
import GhosttyKit
import Sharing
import Testing

@testable import supaterm

@MainActor
struct TerminalTabTransferTests {
  @Test
  func sameWindowTransferMovesTopologyWithoutMovingOwnership() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let host = TerminalHostState(managesTerminalSurfaces: false, spaceID: spaces[0].id)
      let source = host.spaceManager.displayedInstance
      let destination = host.spaceManager.instance(warming: spaces[1].id)
      let tabID = source.tabCollection.createTab(title: "Moved")
      source.tabCollection.selectTab(tabID)

      let plan = try TerminalHostState.prepareLiveTabTransfer(
        TerminalTabTransferRequest(
          expectedSourceRevision: source.tabCollection.topologyRevision,
          expectedDestinationRevision: destination.tabCollection.topologyRevision,
          itemIDs: [.tab(tabID)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 0))
        ),
        from: host,
        sourceSpaceID: spaces[0].id,
        to: host,
        destinationSpaceID: spaces[1].id
      )

      let result = try TerminalHostState.commitLiveTabTransfer(plan, from: host, to: host)

      #expect(result.tabIDs == [tabID])
      #expect(source.tabCollection.tabs.isEmpty)
      #expect(destination.tabCollection.tabs.map(\.id) == [tabID])
      #expect(destination.selectedTabID == tabID)
    }
  }

  @Test
  func splitTransferMovesTheSelectedTabIntoItsPreviousTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let runtime = GhosttyRuntime()
      let host = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      let destinationTabID = host.spaceManager.tabCollection.createTab(title: "Destination")
      let sourceTabID = host.spaceManager.tabCollection.createTab(title: "Source")
      host.applySelectedTab(destinationTabID, in: space.id)
      host.applySelectedTab(sourceTabID, in: space.id)
      let destinationSurface = unbackedSurface(runtime: runtime, tabID: destinationTabID)
      let sourceSurface = unbackedSurface(runtime: runtime, tabID: sourceTabID)
      host.trees[destinationTabID] = SplitTree(view: destinationSurface)
      host.trees[sourceTabID] = SplitTree(view: sourceSurface)
      host.surfaces[destinationSurface.id] = destinationSurface
      host.surfaces[sourceSurface.id] = sourceSurface
      host.focusHistoryByTab[destinationTabID] = TerminalHostState.FocusHistory(
        current: destinationSurface.id
      )
      host.focusHistoryByTab[sourceTabID] = TerminalHostState.FocusHistory(
        current: sourceSurface.id
      )
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: UUID(),
          sourceSpaceID: space.id,
          sourceTopologyRevision: host.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.tab(sourceTabID)]
        )
      )
      let plan = try TerminalHostState.prepareLiveTabSplit(
        payload: payload,
        from: host,
        to: TerminalHostState.LiveTabSplitTarget(
          host: host,
          side: .left,
          spaceID: space.id,
          tabID: sourceTabID
        )
      )

      try TerminalHostState.commitLiveTabSplit(plan, from: host, to: host)

      #expect(host.spaceManager.tabCollection.tabs.map(\.id) == [destinationTabID])
      #expect(host.trees[sourceTabID] == nil)
      #expect(
        host.trees[destinationTabID]?.leaves().map(\.id) == [
          sourceSurface.id,
          destinationSurface.id,
        ])
      #expect(host.surfaces[sourceSurface.id] === sourceSurface)
      #expect(host.focusHistoryByTab[destinationTabID]?.current == sourceSurface.id)
    }
  }

  @Test
  func splitDestinationRejectsASelectedTabWithoutAReplacement() {
    let host = TerminalHostState(managesTerminalSurfaces: false)
    let tabID = host.spaceManager.tabCollection.createTab(title: "Only")

    #expect(
      host.liveTabSplitDestinationTabID(
        sourceTabID: tabID,
        requestedTabID: tabID,
        spaceID: host.displayedSpaceID
      ) == nil
    )
  }

  @Test
  func registryMovesTheSameLiveSurfaceBetweenWindows() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let runtime = GhosttyRuntime()
      let registry = TerminalWindowRegistry(zmxClient: .noop)
      let sourceID = UUID()
      let destinationID = UUID()
      let source = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      let destination = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      let tabID = source.spaceManager.tabCollection.createTab(title: "Moved")
      source.spaceManager.tabCollection.selectTab(tabID)
      let surface = GhosttySurfaceView(
        runtime: runtime,
        tabID: tabID.rawValue,
        workingDirectory: nil,
        context: GHOSTTY_SURFACE_CONTEXT_TAB,
        surfaceFactory: { _, _ in nil }
      )
      source.trees[tabID] = SplitTree(view: surface)
      source.surfaces[surface.id] = surface
      source.focusHistoryByTab[tabID] = TerminalHostState.FocusHistory(current: surface.id)
      let sourceWindow = register(
        source,
        id: sourceID,
        in: registry
      )
      let destinationWindow = register(
        destination,
        id: destinationID,
        in: registry
      )
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceID,
          sourceSpaceID: space.id,
          sourceTopologyRevision: source.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.tab(tabID)]
        )
      )
      var completedOperationID: TerminalTabMoveOperationID?
      #expect(
        registry.tabDragRegistry.begin(payload) {
          completedOperationID = $0
        }
      )

      let result = registry.tabDragRegistry.performTransfer(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: destinationID,
          spaceID: space.id,
          placement: .root(TerminalRootPlacement(isPinned: false, index: 0))
        )
      )

      #expect(result?.tabIDs == [tabID])
      #expect(completedOperationID == payload.moveOperationID)
      #expect(source.spaceManager.tabCollection.tabs.isEmpty)
      #expect(source.surfaces[surface.id] == nil)
      #expect(destination.spaceManager.tabCollection.tabs.map(\.id) == [tabID])
      #expect(destination.surfaces[surface.id] === surface)
      #expect(destination.trees[tabID]?.leaves().first === surface)
      withExtendedLifetime([sourceWindow, destinationWindow]) {}
    }
  }

  private func register(
    _ terminal: TerminalHostState,
    id: UUID,
    in registry: TerminalWindowRegistry
  ) -> NSWindow {
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: id,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: {}
    )
    let window = NSWindow()
    registry.updateWindow(window, for: id)
    return window
  }

  private func unbackedSurface(
    runtime: GhosttyRuntime,
    tabID: TerminalTabID
  ) -> GhosttySurfaceView {
    GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in nil }
    )
  }
}
