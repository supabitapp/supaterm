import AppKit
import Dependencies
import Foundation
import GhosttyKit
import Sharing
import SupatermLicenseFeature
import Testing

@testable import SupatermTerminalCore
@testable import supaterm

@MainActor
struct TerminalPaneTabMoveTests {
  private struct Fixture {
    let host: TerminalHostState
    let tabID: TerminalTabID
    let surfaces: [GhosttySurfaceView]
  }

  @Test
  func movingPaneCreatesAdjacentTabAndFocusesMovedSurface() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let groupID = try #require(
        fixture.host.createGroup(
          title: "Work",
          containing: [fixture.tabID]
        )
      ).groupID

      let result = try fixture.host.movePaneToNewTab(
        TerminalPaneTarget(paneID: fixture.surfaces[1].id)
      )
      let newTabID = TerminalTabID(rawValue: result.tabID)

      #expect(
        fixture.host.trees[fixture.tabID]?.leaves().map(\.id) == [
          fixture.surfaces[0].id,
          fixture.surfaces[2].id,
        ])
      #expect(fixture.host.trees[newTabID]?.leaves().map(\.id) == [fixture.surfaces[1].id])
      #expect(
        fixture.host.spaceManager.tabCollection.tabIDs(in: groupID) == [
          fixture.tabID,
          newTabID,
        ])
      #expect(fixture.host.selectedTabID == newTabID)
      #expect(fixture.host.selectedSurfaceView === fixture.surfaces[1])
      #expect(result.isSelectedTab)
      #expect(!fixture.host.canMovePaneToNewTab(fixture.surfaces[1].id))
    }
  }

  @Test
  func movingPaneToAnExactTabPlacementUsesTheReservedIdentity() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let collection = fixture.host.spaceManager.tabCollection
      let tailID = collection.createTab(title: "Tail")
      let destinationTabID = TerminalTabID()

      let movedTabID = try fixture.host.movePaneToNewTab(
        fixture.surfaces[2].id,
        destinationTabID: destinationTabID,
        at: .root(TerminalRootPlacement(isPinned: false, index: 0)),
        expectedTopologyRevision: collection.topologyRevision
      )

      #expect(movedTabID == destinationTabID)
      #expect(collection.tabs.map(\.id) == [destinationTabID, fixture.tabID, tailID])
      #expect(fixture.host.trees[destinationTabID]?.leaves().map(\.id) == [fixture.surfaces[2].id])
      #expect(
        fixture.host.trees[fixture.tabID]?.leaves().map(\.id) == [
          fixture.surfaces[0].id,
          fixture.surfaces[1].id,
        ])
      #expect(fixture.host.selectedTabID == destinationTabID)
    }
  }

  @Test
  func stalePanePlacementDoesNotChangeTheSplit() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let collection = fixture.host.spaceManager.tabCollection
      let hoveredRevision = collection.topologyRevision
      let concurrentTabID = collection.createTab(title: "Concurrent")

      #expect(throws: TerminalTabTransferError.self) {
        _ = try fixture.host.movePaneToNewTab(
          fixture.surfaces[2].id,
          destinationTabID: TerminalTabID(),
          at: .root(TerminalRootPlacement(isPinned: false, index: 0)),
          expectedTopologyRevision: hoveredRevision
        )
      }
      #expect(collection.tabs.map(\.id) == [fixture.tabID, concurrentTabID])
      #expect(fixture.host.trees[fixture.tabID]?.leaves().map(\.id) == fixture.surfaces.map(\.id))
    }
  }

  @Test
  func paneDragStartsOnlyWhileThePaneBelongsToASplit() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let registry = TerminalTabDragRegistry()
      let client = TerminalPaneDragClient(
        terminal: fixture.host,
        windowControllerID: UUID(),
        registry: registry
      )

      let payload = try #require(client.begin(surfaceView: fixture.surfaces[1]))

      #expect(payload.pane?.surfaceID == fixture.surfaces[1].id)
      #expect(registry.activePayload == payload)
      client.end(payload)
      #expect(registry.lastOutcome == .cancelled)

      #expect(fixture.host.moveAllPanesToNewTabs(fixture.tabID))
      #expect(client.begin(surfaceView: fixture.surfaces[1]) == nil)
    }
  }

  @Test
  func paneDragUsesTabWindowPreviewGeometry() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let previewPresenter = TerminalTabDragPreviewRecorder()
      let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
      let window = NSWindow(
        contentRect: CGRect(x: 100, y: 100, width: 1_000, height: 700),
        styleMask: .borderless,
        backing: .buffered,
        defer: false
      )
      let surface = fixture.surfaces[1]
      surface.frame = CGRect(x: 600, y: 0, width: 300, height: 620)
      try #require(window.contentView).addSubview(surface)
      let client = TerminalPaneDragClient(
        terminal: fixture.host,
        windowControllerID: UUID(),
        registry: registry,
        captureClient: TerminalWindowCaptureClient { _ in nil }
      )
      let payload = try #require(client.begin(surfaceView: surface))
      let screenPoint = CGPoint(x: 800, y: 500)

      client.move(payload, to: screenPoint)

      #expect(previewPresenter.typesDuringShows == [.window])
      #expect(
        previewPresenter.requestedFrames == [
          TerminalTabDragPreviewLayout.frame(
            for: TerminalTabDragPreviewLayout.sourceContentSize(for: window.frame),
            at: screenPoint
          )
        ]
      )
      client.end(payload)
    }
  }

  @Test
  func paneDragUsesContentPreviewOverAnotherPane() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      let previewPresenter = TerminalTabDragPreviewRecorder()
      let registry = TerminalTabDragRegistry(previewPresenter: previewPresenter)
      let client = TerminalPaneDragClient(
        terminal: fixture.host,
        windowControllerID: UUID(),
        registry: registry,
        captureClient: TerminalWindowCaptureClient { _ in nil }
      )
      let source = fixture.surfaces[1]
      let destination = fixture.surfaces[2]
      let nextDestination = fixture.surfaces[0]
      let payload = try #require(client.begin(surfaceView: source))
      client.move(payload, to: CGPoint(x: 800, y: 500))

      client.enteredSplitDestination(destination.id)

      #expect(previewPresenter.currentType == .contentPane)
      #expect(previewPresenter.transitions == [.contentPane])

      client.enteredSplitDestination(nextDestination.id)
      client.exitedSplitDestination(destination.id)

      #expect(previewPresenter.currentType == .contentPane)
      #expect(previewPresenter.transitions == [.contentPane])

      client.exitedSplitDestination(nextDestination.id)

      #expect(previewPresenter.currentType == .window)
      #expect(previewPresenter.transitions == [.contentPane, .window])

      client.enteredSplitDestination(source.id)

      #expect(previewPresenter.currentType == .window)
      #expect(previewPresenter.transitions == [.contentPane, .window])
      client.end(payload)
    }
  }

  @Test
  func movingAllPanesKeepsFocusedPaneAndPreservesSelection() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()

      #expect(fixture.host.moveAllPanesToNewTabs(fixture.tabID))

      let tabs = fixture.host.spaceManager.tabCollection.tabs.map(\.id)
      #expect(tabs.count == 3)
      #expect(fixture.host.trees[tabs[0]]?.leaves().map(\.id) == [fixture.surfaces[1].id])
      #expect(fixture.host.trees[tabs[1]]?.leaves().map(\.id) == [fixture.surfaces[0].id])
      #expect(fixture.host.trees[tabs[2]]?.leaves().map(\.id) == [fixture.surfaces[2].id])
      #expect(fixture.host.selectedTabID == fixture.tabID)
      #expect(fixture.host.selectedSurfaceView === fixture.surfaces[1])
    }
  }

  @Test
  func singlePaneCannotMoveToNewTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let fixture = makeFixture()
      #expect(fixture.host.moveAllPanesToNewTabs(fixture.tabID))
      let paneID = try #require(fixture.host.trees[fixture.tabID]?.leaves().first?.id)

      #expect(throws: TerminalControlError.paneRequiresSplit) {
        _ = try fixture.host.movePaneToNewTab(TerminalPaneTarget(paneID: paneID))
      }
    }
  }

  @Test
  func tabLimitRejectsBatchWithoutMovingAnyPane() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let gate = LicenseTabGate(
        licenseAccess: { .free },
        enforcementEnabled: true
      )
      let fixture = makeFixture(
        licenseTabGate: gate,
        licenseOpenTabCount: { LicenseTabGate.tabLimit - 1 }
      )

      #expect(!fixture.host.moveAllPanesToNewTabs(fixture.tabID))
      #expect(fixture.host.spaceManager.tabCollection.tabs.map(\.id) == [fixture.tabID])
      #expect(fixture.host.trees[fixture.tabID]?.leaves().map(\.id) == fixture.surfaces.map(\.id))
      #expect(fixture.host.showsLicenseTabLimitRefusal)
    }
  }

  private func makeFixture(
    licenseTabGate: LicenseTabGate = .unrestricted,
    licenseOpenTabCount: @escaping @MainActor () -> Int = { 0 }
  ) -> Fixture {
    initializeGhosttyForTests()
    let space = TerminalSpaceItem(name: "Main")
    @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
    $catalog.withLock {
      $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
    }
    let runtime = GhosttyRuntime()
    let host = TerminalHostState.test(
      runtime: runtime,
      spaceID: space.id,
      zmxClient: .noop,
      zmxSessionsEnabled: false,
      licenseTabGate: licenseTabGate,
      licenseOpenTabCount: licenseOpenTabCount
    )
    let tabID = host.spaceManager.tabCollection.createTab(title: "Source")
    let surfaces = (0..<3).map { _ in
      GhosttySurfaceView(
        runtime: runtime,
        tabID: tabID.rawValue,
        workingDirectory: nil,
        context: GHOSTTY_SURFACE_CONTEXT_SPLIT,
        surfaceFactory: { _, _ in nil }
      )
    }
    guard
      let firstTree = SplitTree(view: surfaces[0]).joining(
        SplitTree(view: surfaces[1]),
        direction: .horizontal,
        placingOtherAfter: true
      ),
      let tree = firstTree.joining(
        SplitTree(view: surfaces[2]),
        direction: .horizontal,
        placingOtherAfter: true
      )
    else {
      preconditionFailure()
    }
    host.trees[tabID] = tree
    for surface in surfaces {
      host.surfaces[surface.id] = surface
    }
    host.focusHistoryByTab[tabID] = TerminalHostState.FocusHistory(current: surfaces[1].id)
    return Fixture(host: host, tabID: tabID, surfaces: surfaces)
  }
}
