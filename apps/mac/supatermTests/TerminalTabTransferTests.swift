import AppKit
import ComposableArchitecture
import GhosttyKit
import Sharing
import SupaTheme
import Testing

@testable import supaterm

@MainActor
struct TerminalTabTransferTests {
  private struct LiveHostFixture {
    let host: TerminalHostState
    let runtime: GhosttyRuntime
    let space: TerminalSpaceItem
  }

  enum OptionClickPlacementCase: CaseIterable, Sendable {
    case looseTabs
    case destinationGrouped
    case sourceGrouped
    case sameGroup
    case differentGroups
  }

  enum SelfSplitCase: CaseIterable, Sendable {
    case groupedTop
    case groupedBottom
    case groupedLeft
    case groupedRight
    case rootTop
    case rootBottom
    case rootLeft
    case rootRight

    var groupTitle: String? {
      switch self {
      case .groupedTop, .groupedBottom, .groupedLeft, .groupedRight: "Group"
      case .rootTop, .rootBottom, .rootLeft, .rootRight: nil
      }
    }

    var zone: TerminalSplitDropZone {
      switch self {
      case .groupedTop, .rootTop: .top
      case .groupedBottom, .rootBottom: .bottom
      case .groupedLeft, .rootLeft: .left
      case .groupedRight, .rootRight: .right
      }
    }
  }

  @Test(arguments: OptionClickPlacementCase.allCases)
  func optionClickMergeKeepsTheDestinationPlacement(
    testCase: OptionClickPlacementCase
  ) throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let collection = host.spaceManager.tabCollection
      let destination = liveTab(title: "Destination", runtime: runtime, host: host)
      let source = liveTab(title: "Source", runtime: runtime, host: host)
      var destinationGroupID: TerminalTabGroupID?
      var sourceGroupID: TerminalTabGroupID?
      var sourceSiblingID: TerminalTabID?

      switch testCase {
      case .looseTabs:
        break
      case .destinationGrouped:
        destinationGroupID = try #require(
          host.createGroup(title: "Destination Group", containing: [destination.id])
        ).groupID
      case .sourceGrouped:
        let siblingID = collection.createTab(title: "Source Sibling")
        sourceSiblingID = siblingID
        sourceGroupID = try #require(
          host.createGroup(title: "Source Group", containing: [source.id, siblingID])
        ).groupID
      case .sameGroup:
        let groupID = try #require(
          host.createGroup(title: "Shared Group", containing: [destination.id, source.id])
        ).groupID
        destinationGroupID = groupID
        sourceGroupID = groupID
      case .differentGroups:
        destinationGroupID = try #require(
          host.createGroup(title: "Destination Group", containing: [destination.id])
        ).groupID
        let siblingID = collection.createTab(title: "Source Sibling")
        sourceSiblingID = siblingID
        sourceGroupID = try #require(
          host.createGroup(title: "Source Group", containing: [source.id, siblingID])
        ).groupID
      }
      host.applySelectedTab(destination.id, in: space.id)

      #expect(host.mergeTabIntoSelectedTab(source.id))

      #expect(collection.selectedTabID == destination.id)
      #expect(!collection.tabs.contains(where: { $0.id == source.id }))
      #expect(collection.groupID(containing: destination.id) == destinationGroupID)
      #expect(host.trees[source.id] == nil)
      #expect(
        host.trees[destination.id]?.leaves().map(\.id) == [
          destination.surface.id,
          source.surface.id,
        ])
      #expect(host.focusHistoryByTab[destination.id]?.current == source.surface.id)
      if testCase == .sameGroup {
        #expect(collection.tabIDs(in: try #require(destinationGroupID)) == [destination.id])
      } else if let sourceGroupID, let sourceSiblingID {
        #expect(collection.tabIDs(in: sourceGroupID) == [sourceSiblingID])
      }
    }
  }

  @Test
  func optionClickMergeDeletesAnEmptiedAutomaticGroup() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let destination = liveTab(title: "Destination", runtime: runtime, host: host)
      let source = liveTab(title: "Source", runtime: runtime, host: host)
      let groupID = try #require(
        host.createGroup(title: "Source Group", containing: [source.id])
      ).groupID
      host.applySelectedTab(destination.id, in: space.id)
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      #expect(host.mergeTabIntoSelectedTab(source.id))

      #expect(host.spaceManager.tabCollection.group(for: groupID) == nil)
      #expect(!host.isGroupCollapsed(groupID, in: space.id))
      #expect(host.spaceManager.tabCollection.rootItems.map(\.id) == [.tab(destination.id)])
    }
  }

  @Test
  func optionClickMergeKeepsAnEmptiedDurableGroup() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let collection = host.spaceManager.tabCollection
      let destination = liveTab(title: "Destination", runtime: runtime, host: host)
      let source = liveTab(title: "Source", runtime: runtime, host: host)
      let groupID = try #require(
        host.createGroup(title: "Source Group", containing: [])
      ).groupID
      _ = try collection.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: collection.topologyRevision,
          itemIDs: [.tab(source.id)],
          destination: .group(groupID, index: 0)
        )
      )
      host.applySelectedTab(destination.id, in: space.id)
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      #expect(host.mergeTabIntoSelectedTab(source.id))

      #expect(collection.group(for: groupID)?.lifetime == .durable)
      #expect(collection.tabIDs(in: groupID).isEmpty)
      #expect(host.isGroupCollapsed(groupID, in: space.id))
    }
  }

  @Test(arguments: [true, false])
  func optionClickMergeKeepsTheDestinationPinLane(destinationIsPinned: Bool) {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let collection = host.spaceManager.tabCollection
      let destination = liveTab(title: "Destination", runtime: runtime, host: host)
      let source = liveTab(title: "Source", runtime: runtime, host: host)
      #expect(collection.setPinned(.tab(destinationIsPinned ? destination.id : source.id), isPinned: true) != nil)
      host.applySelectedTab(destination.id, in: space.id)

      #expect(host.mergeTabIntoSelectedTab(source.id))

      #expect(
        collection.pinnedRootItems.map(\.id)
          == (destinationIsPinned ? [.tab(destination.id)] : [])
      )
      #expect(
        collection.regularRootItems.map(\.id)
          == (destinationIsPinned ? [] : [.tab(destination.id)])
      )
    }
  }

  @Test
  func optionClickMergeKeepsBothSplitTreesAndFocusesTheSource() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let destinationTabID = host.spaceManager.tabCollection.createTab(title: "Destination")
      let sourceTabID = host.spaceManager.tabCollection.createTab(title: "Source")
      let destinationSurfaces = [
        unbackedSurface(runtime: runtime, tabID: destinationTabID),
        unbackedSurface(runtime: runtime, tabID: destinationTabID),
      ]
      let sourceSurfaces = [
        unbackedSurface(runtime: runtime, tabID: sourceTabID),
        unbackedSurface(runtime: runtime, tabID: sourceTabID),
      ]
      let destinationTree = try #require(
        SplitTree(view: destinationSurfaces[0]).joining(
          SplitTree(view: destinationSurfaces[1]),
          direction: .vertical,
          placingOtherAfter: true
        )
      )
      let sourceTree = try #require(
        SplitTree(view: sourceSurfaces[0]).joining(
          SplitTree(view: sourceSurfaces[1]),
          direction: .vertical,
          placingOtherAfter: true
        )
      )
      host.trees[destinationTabID] = destinationTree
      host.trees[sourceTabID] = sourceTree
      for surface in destinationSurfaces + sourceSurfaces {
        host.surfaces[surface.id] = surface
      }
      host.focusHistoryByTab[destinationTabID] = TerminalHostState.FocusHistory(
        current: destinationSurfaces[0].id
      )
      host.focusHistoryByTab[sourceTabID] = TerminalHostState.FocusHistory(
        current: sourceSurfaces[1].id
      )
      host.applySelectedTab(destinationTabID, in: space.id)

      #expect(host.mergeTabIntoSelectedTab(sourceTabID))

      let joined = try #require(host.trees[destinationTabID]?.root)
      guard case .split(let split) = joined else {
        Issue.record("Expected a split root")
        return
      }
      #expect(split.direction == .horizontal)
      #expect(split.left == destinationTree.root)
      #expect(split.right == sourceTree.root)
      #expect(host.selectedSurfaceView === sourceSurfaces[1])
    }
  }

  @Test
  func optionClickMergeFailureDoesNotChangeTabsOrSelection() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let live = liveHost()
      let host = live.host
      let runtime = live.runtime
      let space = live.space
      let collection = host.spaceManager.tabCollection
      let destination = liveTab(title: "Destination", runtime: runtime, host: host)
      let sourceTabID = collection.createTab(title: "Source Without Tree")
      host.applySelectedTab(destination.id, in: space.id)
      let snapshot = collection.snapshot

      #expect(!host.mergeTabIntoSelectedTab(destination.id))
      #expect(!host.mergeTabIntoSelectedTab(sourceTabID))

      #expect(collection.snapshot == snapshot)
      #expect(host.trees[destination.id]?.root == SplitTree(view: destination.surface).root)
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
  func crossWindowTransferKeepsTerminalCompletionAttention() throws {
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
      let source = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      )
      let destination = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      )
      let tabID = source.spaceManager.tabCollection.createTab(title: "Source")
      let surface = unbackedSurface(runtime: runtime, tabID: tabID)
      let processIdentity = TerminalAgentProcessIdentity(
        processID: 42,
        startTimeMicroseconds: 1
      )
      source.trees[tabID] = SplitTree(view: surface)
      source.surfaces[surface.id] = surface
      source.focusHistoryByTab[tabID] = TerminalHostState.FocusHistory(current: surface.id)
      source.applySelectedTab(tabID, in: space.id)

      #expect(
        source.applyAgentDetection(
          agentDetectionObservation(
            phase: .running,
            processIdentity: processIdentity,
            ruleID: "screen_working",
            sequence: 1
          ),
          for: surface.id
        )
      )
      #expect(
        source.applyAgentDetection(
          agentDetectionObservation(
            phase: .idle,
            processIdentity: processIdentity,
            ruleID: "osc_title_idle",
            sequence: 2
          ),
          for: surface.id
        )
      )
      #expect(source.tabAgentPresentation(for: tabID).status == .done)

      let plan = try TerminalHostState.prepareLiveTabTransfer(
        TerminalTabTransferRequest(
          expectedSourceRevision: source.spaceManager.tabCollection.topologyRevision,
          expectedDestinationRevision: destination.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.tab(tabID)],
          destination: .root(TerminalRootPlacement(isPinned: false, index: 0))
        ),
        from: source,
        sourceSpaceID: space.id,
        to: destination,
        destinationSpaceID: space.id
      )

      _ = try TerminalHostState.commitLiveTabTransfer(plan, from: source, to: destination)

      #expect(destination.tabAgentPresentation(for: tabID).status == .done)
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
      let registry = TerminalWindowRegistry(sessionHostClient: .noop)
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
      var didCloseSourceWindow = false
      let sourceWindow = register(
        source,
        id: sourceWindowID,
        in: registry,
        onClose: { didCloseSourceWindow = true }
      )
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
      #expect(didCloseSourceWindow)
      withExtendedLifetime([sourceWindow, destinationWindow]) {}
    }
  }

  @Test(arguments: TerminalSplitDropZone.allCases)
  func splitTransferMovesTheSourceTabIntoTheExactDestinationZone(
    zone: TerminalSplitDropZone
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
      let runtime = GhosttyRuntime()
      let host = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
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
        TerminalHostState.LiveTabMergeRequest(
          expectedSourceRevision: payload.sourceTopologyRevision,
          sourceSpaceID: payload.sourceSpaceID,
          sourceTabID: sourceTabID
        ),
        from: host,
        to: TerminalHostState.LiveTabSplitTarget(
          host: host,
          zone: zone,
          spaceID: space.id,
          tabID: destinationTabID
        )
      )

      try TerminalHostState.commitLiveTabMerge(plan, from: host, to: host)

      #expect(host.spaceManager.tabCollection.tabs.map(\.id) == [destinationTabID])
      #expect(host.trees[sourceTabID] == nil)
      let destinationTree = try #require(host.trees[destinationTabID])
      let expectedLeaves =
        zone.isAfter
        ? [destinationSurface.id, sourceSurface.id]
        : [sourceSurface.id, destinationSurface.id]
      #expect(
        destinationTree.leaves().map(\.id) == expectedLeaves
      )
      guard case .split(let split) = destinationTree.root else {
        Issue.record("Expected split tree")
        return
      }
      #expect(split.direction == (zone.isHorizontal ? .horizontal : .vertical))
      #expect(host.surfaces[sourceSurface.id] === sourceSurface)
      #expect(host.focusHistoryByTab[destinationTabID]?.current == sourceSurface.id)
    }
  }

  @Test
  func crossWindowSplitClosesEmptiedSourceWindow() throws {
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
      let registry = TerminalWindowRegistry(sessionHostClient: .noop)
      let sourceWindowID = UUID()
      let destinationWindowID = UUID()
      let source = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      )
      let destination = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      )
      let sourceTabID = source.spaceManager.tabCollection.createTab(title: "Source")
      let destinationTabID = destination.spaceManager.tabCollection.createTab(
        title: "Destination"
      )
      let sourceSurface = unbackedSurface(runtime: runtime, tabID: sourceTabID)
      let destinationSurface = unbackedSurface(runtime: runtime, tabID: destinationTabID)
      source.trees[sourceTabID] = SplitTree(view: sourceSurface)
      source.surfaces[sourceSurface.id] = sourceSurface
      source.focusHistoryByTab[sourceTabID] = TerminalHostState.FocusHistory(
        current: sourceSurface.id
      )
      destination.trees[destinationTabID] = SplitTree(view: destinationSurface)
      destination.surfaces[destinationSurface.id] = destinationSurface
      destination.focusHistoryByTab[destinationTabID] = TerminalHostState.FocusHistory(
        current: destinationSurface.id
      )
      var didCloseSourceWindow = false
      let sourceWindow = register(
        source,
        id: sourceWindowID,
        in: registry,
        onClose: { didCloseSourceWindow = true }
      )
      let destinationWindow = register(destination, id: destinationWindowID, in: registry)
      let payload = try #require(
        TerminalTabDragPayload(
          operationID: TerminalTabMoveOperationID(),
          sourceWindowID: sourceWindowID,
          sourceSpaceID: space.id,
          sourceTopologyRevision: source.spaceManager.tabCollection.topologyRevision,
          itemIDs: [.tab(sourceTabID)]
        )
      )

      let didSplit = registry.splitTab(
        payload,
        to: TerminalTabDragRegistry.SplitDestination(
          windowControllerID: destinationWindowID,
          spaceID: space.id,
          tabID: destinationTabID,
          zone: .right
        )
      )

      #expect(didSplit)
      #expect(didCloseSourceWindow)
      #expect(source.spaceManager.tabCollection.tabs.isEmpty)
      #expect(destination.spaceManager.tabCollection.tabs.map(\.id) == [destinationTabID])
      #expect(
        destination.trees[destinationTabID]?.leaves().map(\.id) == [
          destinationSurface.id,
          sourceSurface.id,
        ])
      withExtendedLifetime([sourceWindow, destinationWindow]) {}
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
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
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
          keepingExistingContentIn: testCase.zone,
          in: space.id
        )
      )
      let unsplitLeaves = try #require(host.trees[tabID]?.leaves())
      #expect(unsplitLeaves.count == 1)
      #expect(unsplitLeaves.first === originalSurface)
      let registry = TerminalWindowRegistry(sessionHostClient: .noop)
      let windowControllerID = UUID()
      var didCloseWindow = false
      let window = register(
        host,
        id: windowControllerID,
        in: registry,
        onClose: { didCloseWindow = true }
      )
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
          zone: testCase.zone
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
        testCase.zone.isAfter
          ? leaves.last === originalSurface
          : leaves.first === originalSurface
      )
      guard case .split(let split) = host.trees[tabID]?.root else {
        Issue.record("Expected split tree")
        return
      }
      #expect(split.direction == (testCase.zone.isHorizontal ? .horizontal : .vertical))
      #expect(host.selectedSurfaceView !== originalSurface)
      #expect(!didCloseWindow)
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
      let registry = TerminalWindowRegistry(sessionHostClient: .noop)
      let sourceID = UUID()
      let destinationID = UUID()
      let source = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      )
      let destination = TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
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
    in registry: TerminalWindowRegistry,
    onClose: @escaping @MainActor () -> Void = {}
  ) -> NSWindow {
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: id,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: onClose
    )
    let window = NSWindow()
    registry.updateWindow(window, for: id)
    return window
  }

  private func liveHost() -> LiveHostFixture {
    initializeGhosttyForTests()
    let space = TerminalSpaceItem(name: "Main")
    @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
    $catalog.withLock {
      $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    }
    let runtime = GhosttyRuntime()
    return LiveHostFixture(
      host: TerminalHostState(
        runtime: runtime,
        spaceID: space.id,
        sessionHostClient: .noop,
        sessionPersistenceEnabled: false
      ),
      runtime: runtime,
      space: space
    )
  }

  private func liveTab(
    title: String,
    runtime: GhosttyRuntime,
    host: TerminalHostState
  ) -> (id: TerminalTabID, surface: GhosttySurfaceView) {
    let tabID = host.spaceManager.tabCollection.createTab(title: title)
    let surface = unbackedSurface(runtime: runtime, tabID: tabID)
    host.trees[tabID] = SplitTree(view: surface)
    host.surfaces[surface.id] = surface
    host.focusHistoryByTab[tabID] = TerminalHostState.FocusHistory(current: surface.id)
    return (tabID, surface)
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
