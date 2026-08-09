import AppKit
import ComposableArchitecture
import GhosttyKit
import Sharing
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalTabTransferTests {
  enum SelfSplitCase: CaseIterable, Sendable {
    case groupedLeft
    case groupedRight
    case rootLeft
    case rootRight

    var groupTitle: String? {
      switch self {
      case .groupedLeft, .groupedRight: "Group"
      case .rootLeft, .rootRight: nil
      }
    }

    var side: TerminalTabSplitSide {
      switch self {
      case .groupedLeft, .rootLeft: .left
      case .groupedRight, .rootRight: .right
      }
    }
  }

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
  func registryTransfersWholeGroupToEmptyWindowWithIdentityMetadataAndChildOrder() throws {
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
      let sourceWindowID = UUID()
      let destinationWindowID = UUID()
      let source = TerminalHostState(
        runtime: runtime,
        managesTerminalSurfaces: false,
        spaceID: space.id
      )
      let destination = TerminalHostState(
        runtime: runtime,
        managesTerminalSurfaces: false,
        spaceID: space.id
      )
      let first = source.spaceManager.tabCollection.createTab(title: "First")
      let second = source.spaceManager.tabCollection.createTab(title: "Second")
      let groupID = try #require(
        source.createGroup(title: "Build", color: .purple, containing: [second, first])
      ).groupID
      #expect(source.setPinned(.group(groupID), isPinned: true) != nil)
      source.applySelectedTab(first, in: space.id)
      #expect(source.setGroupCollapsed(groupID, isCollapsed: true))
      let sourceWindow = register(source, id: sourceWindowID, in: registry)
      let destinationWindow = register(destination, id: destinationWindowID, in: registry)
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceWindowID,
          sourceSpaceID: space.id,
          sourceTopologyRevision: source.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.group(groupID)],
        )
      )

      let result = try #require(
        registry.transferTab(
          payload,
          to: TerminalTabDragRegistry.Destination(
            windowControllerID: destinationWindowID,
            spaceID: space.id,
            expectedTopologyRevision: destination.spaceManager.tabCollection.topologyRevision,
            placement: .root(TerminalRootPlacement(isPinned: false, index: 0))
          )
        )
      )
      let group = try #require(destination.spaceManager.tabCollection.group(for: groupID))

      #expect(result.tabIDs == [second, first])
      #expect(source.spaceManager.tabCollection.rootItems.isEmpty)
      #expect(destination.spaceManager.tabCollection.rootItems.map(\.id) == [.group(groupID)])
      #expect(group.title == "Build")
      #expect(group.color == .purple)
      #expect(group.lifetime == .automatic)
      #expect(!group.isPinned)
      #expect(group.tabs.map(\.id) == [second, first])
      #expect(destination.selectedTabID == second)
      #expect(!destination.isGroupCollapsed(groupID, in: space.id))
      withExtendedLifetime([sourceWindow, destinationWindow]) {}
    }
  }

  @Test
  func splitTransferMovesTheSourceTabIntoTheExactDestinationTab() throws {
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
      host.applySelectedTab(sourceTabID, in: space.id)
      host.applySelectedTab(destinationTabID, in: space.id)
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
      let plan = try TerminalHostState.prepareLiveTabMerge(
        payload: payload,
        from: host,
        to: TerminalHostState.LiveTabSplitTarget(
          host: host,
          side: .left,
          spaceID: space.id,
          tabID: destinationTabID
        )
      )

      try TerminalHostState.commitLiveTabMerge(plan, from: host, to: host)

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
  func splitTargetAcceptsTheSelectedSourceTab() {
    let host = TerminalHostState(managesTerminalSurfaces: false)
    let sourceTabID = host.spaceManager.tabCollection.createTab(title: "Source")
    host.applySelectedTab(sourceTabID, in: host.displayedSpaceID)

    #expect(
      host.liveTabSplitTargetTabID(
        sourceTabID,
        in: host.displayedSpaceID
      ) == sourceTabID
    )
  }

  @Test
  func splitTargetUsesTheExactRequestedLiveTab() {
    let host = TerminalHostState(managesTerminalSurfaces: false)
    let destinationTabID = host.spaceManager.tabCollection.createTab(title: "Destination")

    #expect(
      host.liveTabSplitTargetTabID(
        destinationTabID,
        in: host.displayedSpaceID
      ) == destinationTabID
    )
  }

  @Test(arguments: SelfSplitCase.allCases)
  func selectedTabDropCreatesANewPaneOnTheOtherSide(
    testCase: SelfSplitCase
  ) throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Main")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let host = TerminalHostState(
        runtime: GhosttyRuntime(),
        spaceID: space.id,
        zmxClient: .noop,
        zmxSessionsEnabled: false
      )
      host.ensureInitialTab(focusing: false)
      let tabID = try #require(host.selectedTabID)
      let originalSurface = try #require(host.selectedSurfaceView)
      let groupID = try testCase.groupTitle.map {
        try #require(host.createGroup(title: $0, containing: [tabID])).groupID
      }
      let topologyRevision = host.spaceManager.tabCollection.topologyRevision
      #expect(
        !host.splitSelectedTabWithNewPane(
          tabID,
          expectedTopologyRevision: topologyRevision + 1,
          keepingExistingContentOn: testCase.side,
          in: space.id
        )
      )
      let unsplitLeaves = try #require(host.trees[tabID]?.leaves())
      #expect(unsplitLeaves.count == 1)
      #expect(unsplitLeaves.first === originalSurface)
      let registry = TerminalWindowRegistry(zmxClient: .noop)
      let windowControllerID = UUID()
      let window = register(host, id: windowControllerID, in: registry)
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: windowControllerID,
          sourceSpaceID: space.id,
          sourceTopologyRevision: topologyRevision,
          itemIDs: [.tab(tabID)]
        )
      )
      var completedOperationID: TerminalTabMoveOperationID?
      var sourceDisposition: TerminalTabDragRegistry.SourceDisposition?
      #expect(
        registry.tabDragRegistry.begin(
          payload,
          didTransfer: {
            completedOperationID = $0
            sourceDisposition = $1
          }
        )
      )

      let didSplit = registry.tabDragRegistry.performSplit(
        payload,
        to: TerminalTabDragRegistry.SplitDestination(
          windowControllerID: windowControllerID,
          spaceID: space.id,
          tabID: tabID,
          side: testCase.side
        )
      )

      let leaves = try #require(host.trees[tabID]?.leaves())
      #expect(didSplit)
      #expect(completedOperationID == payload.moveOperationID)
      #expect(sourceDisposition == .retained)
      #expect(host.spaceManager.tabCollection.topologyRevision == topologyRevision)
      #expect(host.spaceManager.tabCollection.tabs.map(\.id) == [tabID])
      #expect(host.spaceManager.tabCollection.groupID(containing: tabID) == groupID)
      #expect(leaves.count == 2)
      #expect(
        testCase.side == .left
          ? leaves.first === originalSurface
          : leaves.last === originalSurface
      )
      #expect(host.selectedSurfaceView !== originalSurface)
      withExtendedLifetime(window) {}
    }
  }

  @Test
  func registryUsesTheRequestedDestinationRevision() throws {
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
      let sourceWindow = register(source, id: sourceID, in: registry)
      let destinationWindow = register(destination, id: destinationID, in: registry)
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceID,
          sourceSpaceID: space.id,
          sourceTopologyRevision: source.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.tab(tabID)]
        )
      )
      let hoveredDestinationRevision = destination.spaceManager.tabCollection.topologyRevision
      var completedOperationID: TerminalTabMoveOperationID?
      var sourceDisposition: TerminalTabDragRegistry.SourceDisposition?
      #expect(
        registry.tabDragRegistry.begin(
          payload,
          didTransfer: {
            completedOperationID = $0
            sourceDisposition = $1
          }
        )
      )
      let concurrentTabID = destination.spaceManager.tabCollection.createTab(
        title: "Concurrent"
      )

      let staleResult = registry.tabDragRegistry.performTransfer(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: destinationID,
          spaceID: space.id,
          expectedTopologyRevision: hoveredDestinationRevision,
          placement: .root(TerminalRootPlacement(isPinned: false, index: 0))
        )
      )

      #expect(staleResult == nil)
      #expect(completedOperationID == nil)
      #expect(sourceDisposition == nil)
      #expect(source.spaceManager.tabCollection.tabs.map(\.id) == [tabID])
      #expect(destination.spaceManager.tabCollection.tabs.map(\.id) == [concurrentTabID])

      let result = registry.tabDragRegistry.performTransfer(
        payload,
        to: TerminalTabDragRegistry.Destination(
          windowControllerID: destinationID,
          spaceID: space.id,
          expectedTopologyRevision: destination.spaceManager.tabCollection.topologyRevision,
          placement: .root(TerminalRootPlacement(isPinned: false, index: 1))
        )
      )

      #expect(result?.tabIDs == [tabID])
      #expect(completedOperationID == payload.moveOperationID)
      #expect(sourceDisposition == .removed)
      #expect(source.spaceManager.tabCollection.tabs.isEmpty)
      #expect(source.surfaces[surface.id] == nil)
      #expect(
        destination.spaceManager.tabCollection.tabs.map(\.id) == [
          concurrentTabID,
          tabID,
        ])
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
