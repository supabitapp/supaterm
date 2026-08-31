import AppKit
import ComposableArchitecture
import Foundation
import GhosttyKit
import Sharing
import SupatermTerminalCore
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateOcclusionTests {
  @Test
  func restoreOccludesHiddenSurfacesBeforeCreatingTheNextSurface() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Cold")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let displayedSurfaceID = UUID()
      let displayedHiddenSurfaceIDs = [UUID(), UUID()]
      let coldSurfaceIDs = [UUID(), UUID(), UUID()]
      let recorder = SurfaceActivityRecorder()
      let host = TerminalHostState.test(
        surfaceFactory: recorder.recordCreation,
        surfaceActivityApplier: recorder.record,
        spaceID: spaces[0].id
      )
      host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))

      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [
              spaceSession(
                spaceID: spaces[0].id,
                tabSurfaceIDs: [[displayedSurfaceID], displayedHiddenSurfaceIDs]
              ),
              spaceSession(spaceID: spaces[1].id, tabSurfaceIDs: [coldSurfaceIDs]),
            ]
          )
        )
      )
      #expect(
        Array(recorder.events.prefix(5)) == [
          .creation,
          .creation,
          .visibility(displayedHiddenSurfaceIDs[0], false),
          .creation,
          .visibility(displayedHiddenSurfaceIDs[1], false),
        ]
      )
      #expect(recorder.currentVisibility(for: displayedSurfaceID) == true)

      recorder.clearTransitions()
      host.warmInstance(for: spaces[1].id)

      #expect(
        Array(recorder.events.prefix(6)) == [
          .creation,
          .visibility(coldSurfaceIDs[0], false),
          .creation,
          .visibility(coldSurfaceIDs[1], false),
          .creation,
          .visibility(coldSurfaceIDs[2], false),
        ]
      )
    }
  }

  @Test
  func warmingHiddenSpacesOccludesRestoredAndNewPanesImmediately() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [
        TerminalSpaceItem(name: "Displayed"),
        TerminalSpaceItem(name: "Restored"),
        TerminalSpaceItem(name: "Empty Restore"),
        TerminalSpaceItem(name: "New"),
      ]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let displayedSurfaceID = UUID()
      let hiddenSurfaceID = UUID()
      let recorder = SurfaceActivityRecorder()
      let host = TerminalHostState.test(
        surfaceActivityApplier: recorder.record,
        spaceID: spaces[0].id
      )
      host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))

      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [
              spaceSession(spaceID: spaces[0].id, surfaceID: displayedSurfaceID),
              spaceSession(spaceID: spaces[1].id, surfaceID: hiddenSurfaceID),
              TerminalSpaceSession(
                spaceID: spaces[2].id,
                selectedTabID: nil,
                nodes: [],
                groups: [],
                collapsedGroupIDs: [],
                tabs: []
              ),
            ]
          )
        )
      )
      #expect(recorder.currentVisibility(for: displayedSurfaceID) == true)

      recorder.clearTransitions()
      host.warmInstance(for: spaces[1].id)
      #expect(recorder.transitions(for: hiddenSurfaceID) == [false])

      host.warmInstance(for: spaces[2].id)
      let emptyRestoredTabID = try #require(host.spaceManager.selectedTabID(in: spaces[2].id))
      let emptyRestoredSurfaceID = try #require(
        host.trees[emptyRestoredTabID]?.root?.leftmostLeaf().id
      )
      #expect(recorder.transitions(for: emptyRestoredSurfaceID) == [false])

      host.warmSpace(spaces[3].id)
      let newTabID = try #require(host.spaceManager.selectedTabID(in: spaces[3].id))
      let newSurfaceID = try #require(host.trees[newTabID]?.root?.leftmostLeaf().id)
      #expect(recorder.transitions(for: newSurfaceID) == [false])
    }
  }

  @Test
  func zoomedSubtreeKeepsOnlyItsLeavesVisible() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let setup = try makePaneSetup(runtime: GhosttyRuntime())
      let tree = try #require(setup.host.trees[setup.tabID])
      guard case .split(let rootSplit) = tree.root else {
        Issue.record("Expected split root")
        return
      }

      setup.host.trees[setup.tabID] = tree.settingZoomed(rootSplit.right)
      setup.host.syncFocus(setup.host.windowActivity)

      #expect(setup.host.visiblePaneIDs == Set([setup.middleSurfaceID, setup.lastSurfaceID]))
      #expect(setup.recorder.transitions(for: setup.firstSurfaceID) == [false])
      #expect(setup.recorder.transitions(for: setup.middleSurfaceID).isEmpty)
      #expect(setup.recorder.transitions(for: setup.lastSurfaceID).isEmpty)
    }
  }

  @Test
  func togglingZoomOccludesAndRevealsOtherPanes() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let setup = try makePaneSetup(runtime: GhosttyRuntime())

      #expect(
        setup.host.performSplitAction(.toggleSplitZoom, for: setup.middleSurfaceID)
      )
      #expect(setup.host.visiblePaneIDs == [setup.middleSurfaceID])
      #expect(setup.recorder.transitions(for: setup.firstSurfaceID) == [false])
      #expect(setup.recorder.transitions(for: setup.middleSurfaceID).isEmpty)
      #expect(setup.recorder.transitions(for: setup.lastSurfaceID) == [false])

      setup.recorder.clearTransitions()
      #expect(
        setup.host.performSplitAction(.toggleSplitZoom, for: setup.middleSurfaceID)
      )
      #expect(
        setup.host.visiblePaneIDs
          == Set([setup.firstSurfaceID, setup.middleSurfaceID, setup.lastSurfaceID])
      )
      #expect(setup.recorder.transitions(for: setup.firstSurfaceID) == [true])
      #expect(setup.recorder.transitions(for: setup.middleSurfaceID).isEmpty)
      #expect(setup.recorder.transitions(for: setup.lastSurfaceID) == [true])
    }
  }

  @Test
  func zoomNavigationMovesVisibilityWhenZoomIsPreserved() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let runtime = try makeGhosttyRuntime(
        """
        split-preserve-zoom = navigation
        """
      )
      let setup = try makePaneSetup(runtime: runtime)

      #expect(
        setup.host.performSplitAction(.toggleSplitZoom, for: setup.middleSurfaceID)
      )
      setup.recorder.clearTransitions()

      #expect(
        setup.host.performSplitAction(
          .gotoSplit(direction: .next),
          for: setup.middleSurfaceID
        )
      )
      #expect(setup.host.visiblePaneIDs == [setup.lastSurfaceID])
      #expect(setup.recorder.transitions(for: setup.firstSurfaceID).isEmpty)
      #expect(setup.recorder.transitions(for: setup.middleSurfaceID) == [false])
      #expect(setup.recorder.transitions(for: setup.lastSurfaceID) == [true])
    }
  }

  @Test
  func zoomNavigationRevealsAllPanesWhenZoomIsCleared() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let setup = try makePaneSetup(runtime: GhosttyRuntime())

      #expect(
        setup.host.performSplitAction(.toggleSplitZoom, for: setup.middleSurfaceID)
      )
      setup.recorder.clearTransitions()

      #expect(
        setup.host.performSplitAction(
          .gotoSplit(direction: .next),
          for: setup.middleSurfaceID
        )
      )
      #expect(
        setup.host.visiblePaneIDs
          == Set([setup.firstSurfaceID, setup.middleSurfaceID, setup.lastSurfaceID])
      )
      #expect(setup.recorder.transitions(for: setup.firstSurfaceID) == [true])
      #expect(setup.recorder.transitions(for: setup.middleSurfaceID).isEmpty)
      #expect(setup.recorder.transitions(for: setup.lastSurfaceID) == [true])
    }
  }

  @Test
  func splitAndRearrangeResyncAfterClearingZoom() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let splitSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        splitSetup.host.performSplitAction(
          .toggleSplitZoom,
          for: splitSetup.middleSurfaceID
        )
      )
      splitSetup.recorder.clearTransitions()

      #expect(
        splitSetup.host.performSplitAction(
          .newSplit(direction: .right),
          for: splitSetup.middleSurfaceID
        )
      )
      #expect(splitSetup.recorder.transitions(for: splitSetup.firstSurfaceID) == [true])
      #expect(splitSetup.recorder.transitions(for: splitSetup.lastSurfaceID) == [true])

      let rearrangeSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        rearrangeSetup.host.performSplitAction(
          .toggleSplitZoom,
          for: rearrangeSetup.middleSurfaceID
        )
      )
      rearrangeSetup.recorder.clearTransitions()

      #expect(
        rearrangeSetup.host.rearrangePane(
          rearrangeSetup.firstSurfaceID,
          relativeTo: rearrangeSetup.lastSurfaceID,
          zone: .right,
          in: rearrangeSetup.tabID
        )
      )
      #expect(
        rearrangeSetup.recorder.transitions(for: rearrangeSetup.firstSurfaceID) == [true]
      )
      #expect(
        rearrangeSetup.recorder.transitions(for: rearrangeSetup.lastSurfaceID) == [true]
      )
    }
  }

  @Test
  func closeAndLayoutResetsRevealAllPanes() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let closeSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        closeSetup.host.performSplitAction(.toggleSplitZoom, for: closeSetup.middleSurfaceID)
      )
      closeSetup.recorder.clearTransitions()

      closeSetup.host.requestCloseTab(closeSetup.tabID)
      #expect(closeSetup.recorder.transitions(for: closeSetup.firstSurfaceID) == [true])
      #expect(closeSetup.recorder.transitions(for: closeSetup.lastSurfaceID) == [true])

      let layoutSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        layoutSetup.host.performSplitAction(.toggleSplitZoom, for: layoutSetup.middleSurfaceID)
      )
      layoutSetup.recorder.clearTransitions()

      _ = try layoutSetup.host.tilePanes(
        TerminalTilePanesRequest(target: TerminalTabTarget(tabID: layoutSetup.tabID.rawValue))
      )
      #expect(layoutSetup.recorder.transitions(for: layoutSetup.firstSurfaceID) == [true])
      #expect(layoutSetup.recorder.transitions(for: layoutSetup.lastSurfaceID) == [true])

      #expect(
        layoutSetup.host.performSplitAction(.toggleSplitZoom, for: layoutSetup.middleSurfaceID)
      )
      layoutSetup.recorder.clearTransitions()

      _ = try layoutSetup.host.mainVerticalPanes(
        TerminalMainVerticalPanesRequest(
          target: TerminalTabTarget(tabID: layoutSetup.tabID.rawValue)
        )
      )
      #expect(layoutSetup.recorder.transitions(for: layoutSetup.firstSurfaceID) == [true])
      #expect(layoutSetup.recorder.transitions(for: layoutSetup.lastSurfaceID) == [true])
    }
  }

  @Test
  func directFocusRevealsPanesOutsideZoom() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let focusSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        focusSetup.host.performSplitAction(.toggleSplitZoom, for: focusSetup.middleSurfaceID)
      )
      focusSetup.recorder.clearTransitions()

      let focusResult = try focusSetup.host.focusPane(
        TerminalPaneTarget(paneID: focusSetup.firstSurfaceID)
      )

      #expect(focusResult.target.paneID == focusSetup.firstSurfaceID)
      #expect(focusSetup.host.trees[focusSetup.tabID]?.zoomed == nil)
      #expect(focusSetup.recorder.transitions(for: focusSetup.firstSurfaceID) == [true])
      #expect(focusSetup.recorder.transitions(for: focusSetup.lastSurfaceID) == [true])

      let lastSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        lastSetup.host.performSplitAction(.toggleSplitZoom, for: lastSetup.middleSurfaceID)
      )
      lastSetup.recorder.clearTransitions()

      let lastResult = try lastSetup.host.lastPane(
        TerminalPaneTarget(paneID: lastSetup.middleSurfaceID)
      )

      #expect(lastResult.target.paneID == lastSetup.lastSurfaceID)
      #expect(lastSetup.host.trees[lastSetup.tabID]?.zoomed == nil)
      #expect(lastSetup.recorder.transitions(for: lastSetup.firstSurfaceID) == [true])
      #expect(lastSetup.recorder.transitions(for: lastSetup.lastSurfaceID) == [true])
    }
  }

  @Test
  func resizeOperationsRevealAllPanes() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let bindingSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        bindingSetup.host.performSplitAction(
          .toggleSplitZoom,
          for: bindingSetup.middleSurfaceID
        )
      )
      bindingSetup.recorder.clearTransitions()

      #expect(
        bindingSetup.host.performSplitAction(
          .resizeSplit(direction: .right, amount: 10),
          for: bindingSetup.middleSurfaceID
        )
      )
      #expect(bindingSetup.host.trees[bindingSetup.tabID]?.zoomed == nil)
      #expect(bindingSetup.recorder.transitions(for: bindingSetup.firstSurfaceID) == [true])
      #expect(bindingSetup.recorder.transitions(for: bindingSetup.lastSurfaceID) == [true])

      let resizeSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        resizeSetup.host.performSplitAction(.toggleSplitZoom, for: resizeSetup.middleSurfaceID)
      )
      resizeSetup.recorder.clearTransitions()

      _ = try resizeSetup.host.resizePane(
        TerminalResizePaneRequest(
          amount: 10,
          direction: .right,
          target: TerminalPaneTarget(paneID: resizeSetup.middleSurfaceID)
        )
      )
      #expect(resizeSetup.host.trees[resizeSetup.tabID]?.zoomed == nil)
      #expect(resizeSetup.recorder.transitions(for: resizeSetup.firstSurfaceID) == [true])
      #expect(resizeSetup.recorder.transitions(for: resizeSetup.lastSurfaceID) == [true])

      let sizeSetup = try makePaneSetup(runtime: GhosttyRuntime())
      #expect(
        sizeSetup.host.performSplitAction(.toggleSplitZoom, for: sizeSetup.middleSurfaceID)
      )
      sizeSetup.recorder.clearTransitions()

      _ = try sizeSetup.host.setPaneSize(
        TerminalSetPaneSizeRequest(
          amount: 40,
          axis: .horizontal,
          target: TerminalPaneTarget(paneID: sizeSetup.middleSurfaceID),
          unit: .percent
        )
      )
      #expect(sizeSetup.host.trees[sizeSetup.tabID]?.zoomed == nil)
      #expect(sizeSetup.recorder.transitions(for: sizeSetup.firstSurfaceID) == [true])
      #expect(sizeSetup.recorder.transitions(for: sizeSetup.lastSurfaceID) == [true])
    }
  }

  private func makePaneSetup(runtime: GhosttyRuntime) throws -> PaneSetup {
    let recorder = SurfaceActivityRecorder()
    let host = TerminalHostState.test(
      runtime: runtime,
      surfaceActivityApplier: recorder.record
    )
    host.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
    host.ensureInitialTab(focusing: false, startupCommand: nil)

    let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .pane(firstSurfaceID)
      )
    )
    let thirdPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .pane(secondPane.paneID)
      )
    )
    let tabID = try #require(host.selectedTabID)
    recorder.clearTransitions()

    return PaneSetup(
      firstSurfaceID: firstSurfaceID,
      host: host,
      lastSurfaceID: thirdPane.paneID,
      middleSurfaceID: secondPane.paneID,
      recorder: recorder,
      tabID: tabID
    )
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    surfaceID: UUID
  ) -> TerminalSpaceSession {
    spaceSession(spaceID: spaceID, tabSurfaceIDs: [[surfaceID]])
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    tabSurfaceIDs: [[UUID]]
  ) -> TerminalSpaceSession {
    let tabs = tabSurfaceIDs.map { surfaceIDs in
      (id: TerminalTabID(), root: paneNode(surfaceIDs: surfaceIDs))
    }
    return TerminalSpaceSession(
      spaceID: spaceID,
      selectedTabID: tabs.first?.id,
      nodes: tabs.enumerated().map { order, tab in
        TerminalTabNodeSession(
          item: .tab(tab.id),
          parent: .root(isPinned: false),
          order: order
        )
      },
      groups: [],
      collapsedGroupIDs: [],
      tabs: tabs.map { tab in
        TerminalTabSession(
          id: tab.id,
          lockedTitle: nil,
          focusedPaneIndex: 0,
          root: tab.root
        )
      }
    )
  }

  private func paneNode(surfaceIDs: [UUID]) -> TerminalPaneNodeSession {
    surfaceIDs.dropFirst().reduce(
      .leaf(
        TerminalPaneLeafSession(
          id: surfaceIDs[0],
          workingDirectoryPath: nil
        )
      )
    ) { left, surfaceID in
      .split(
        TerminalPaneSplitSession(
          direction: .horizontal,
          ratio: 0.5,
          left: left,
          right: .leaf(
            TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: nil)
          )
        )
      )
    }
  }
}

@MainActor
private final class SurfaceActivityRecorder {
  enum Event: Equatable {
    case creation
    case visibility(UUID, Bool)
  }

  private var currentVisibilityBySurfaceID: [UUID: Bool] = [:]
  private var transitionsBySurfaceID: [UUID: [Bool]] = [:]
  private(set) var events: [Event] = []

  func recordCreation(
    _: ghostty_app_t,
    _: UnsafePointer<ghostty_surface_config_s>
  ) -> ghostty_surface_t? {
    events.append(.creation)
    return nil
  }

  func record(
    _ surface: GhosttySurfaceView,
    _ activity: TerminalHostState.SurfaceActivity
  ) {
    guard currentVisibilityBySurfaceID[surface.id] != activity.isVisible else { return }
    currentVisibilityBySurfaceID[surface.id] = activity.isVisible
    transitionsBySurfaceID[surface.id, default: []].append(activity.isVisible)
    events.append(.visibility(surface.id, activity.isVisible))
  }

  func clearTransitions() {
    transitionsBySurfaceID.removeAll()
    events.removeAll()
  }

  func currentVisibility(for surfaceID: UUID) -> Bool? {
    currentVisibilityBySurfaceID[surfaceID]
  }

  func transitions(for surfaceID: UUID) -> [Bool] {
    transitionsBySurfaceID[surfaceID] ?? []
  }
}

private struct PaneSetup {
  let firstSurfaceID: UUID
  let host: TerminalHostState
  let lastSurfaceID: UUID
  let middleSurfaceID: UUID
  let recorder: SurfaceActivityRecorder
  let tabID: TerminalTabID
}
