import Dependencies
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
