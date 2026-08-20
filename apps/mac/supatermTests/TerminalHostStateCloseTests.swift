import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateCloseTests {
  @Test
  func closeRequestForZoomedTabUnzoomsAndRequiresConfirmation() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let setup = try makeSplitTabSetup(hasSurvivingTab: true)
      let stream = setup.host.eventStream()
      var iterator = stream.makeAsyncIterator()

      #expect(setup.host.performSplitAction(.toggleSplitZoom, for: setup.secondSurfaceID))

      setup.host.requestCloseTab(setup.tabID)

      #expect(setup.host.trees[setup.tabID]?.zoomed == nil)
      let event = try #require(await iterator.next())
      #expect(
        event
          == .closeRequested(
            TerminalCloseRequest(target: .tab(setup.tabID), needsConfirmation: true)))
    }
  }

  @Test
  func closeRequestForUnzoomedTabDoesNotForceConfirmation() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let setup = try makeSplitTabSetup(hasSurvivingTab: true)
      let stream = setup.host.eventStream()
      var iterator = stream.makeAsyncIterator()

      setup.host.requestCloseTab(setup.tabID)

      let event = try #require(await iterator.next())
      #expect(
        event
          == .closeRequested(
            TerminalCloseRequest(target: .tab(setup.tabID), needsConfirmation: false)))
    }
  }

  @Test
  func closeRequestForZoomedLastTabUnzoomsBeforeRequestingWindowClose() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let setup = try makeSplitTabSetup(hasSurvivingTab: false)
      let stream = setup.host.eventStream()
      var iterator = stream.makeAsyncIterator()

      #expect(setup.host.performSplitAction(.toggleSplitZoom, for: setup.secondSurfaceID))

      setup.host.requestCloseTab(setup.tabID)

      #expect(setup.host.trees[setup.tabID]?.zoomed == nil)
      let event = try #require(await iterator.next())
      #expect(event == .windowCloseRequested(needsConfirmation: true))
    }
  }

  @Test
  func closeConfirmationAggregationScopesTabIDs() {
    let confirmingTabID = TerminalTabID()
    let otherTabID = TerminalTabID()
    let confirmingTabIDs = Set([confirmingTabID])

    #expect(
      TerminalHostState.anyTabNeedsCloseConfirmation(
        [confirmingTabID],
        tabNeedsCloseConfirmation: confirmingTabIDs.contains
      )
    )
    #expect(
      !TerminalHostState.anyTabNeedsCloseConfirmation(
        [otherTabID],
        tabNeedsCloseConfirmation: confirmingTabIDs.contains
      )
    )
  }

  @Test
  func coldSpaceKeepsTheWindowOpenAndCountsTowardsItsSessions() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let host = TerminalHostState(spaceID: spaces[0].id, zmxSessionsEnabled: false)
      host.ensureInitialTab(focusing: false, startupCommand: nil)
      let tabID = try #require(host.selectedTabID)
      let coldTabID = TerminalTabID()
      let coldSurfaceID = UUID()
      host.spaceManager.registerColdInstance(
        TerminalSpaceSession(
          spaceID: spaces[1].id,
          selectedTabID: coldTabID,
          nodes: [
            TerminalTabNodeSession(
              item: .tab(coldTabID),
              parent: .root(isPinned: false),
              order: 0
            )
          ],
          groups: [],
          collapsedGroupIDs: [],
          tabs: [
            TerminalTabSession(
              id: coldTabID,
              lockedTitle: nil,
              focusedPaneIndex: 0,
              root: .leaf(
                TerminalPaneLeafSession(id: coldSurfaceID, workingDirectoryPath: nil)
              )
            )
          ]
        )
      )

      #expect(!host.shouldCloseWindow(afterClosing: [tabID]))
      #expect(host.sessionSurfaceIDs().contains(coldSurfaceID))
      #expect(host.paneCount(inSpace: spaces[1].id) == 1)
    }
  }

  private func makeSplitTabSetup(hasSurvivingTab: Bool) throws -> CloseTabTestSetup {
    initializeGhosttyForTests()
    let runtime = try makeGhosttyRuntime("confirm-close-surface = false")
    let host = TerminalHostState(
      runtime: runtime,
      zmxSessionsEnabled: false
    )
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let tabID = try #require(host.selectedTabID)
    let firstSurfaceID = try #require(host.currentFocusedSurfaceID())
    let secondPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .pane(firstSurfaceID)
      )
    )
    if hasSurvivingTab {
      _ = host.createTab(inheritingFromSurfaceID: nil)
      host.selectTab(tabID)
    }
    return CloseTabTestSetup(
      host: host,
      secondSurfaceID: secondPane.paneID,
      tabID: tabID
    )
  }
}

private struct CloseTabTestSetup {
  let host: TerminalHostState
  let secondSurfaceID: UUID
  let tabID: TerminalTabID
}
