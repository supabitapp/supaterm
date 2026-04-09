import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateSurfaceMoveTests {
  @Test
  func movingPaneFromSplitCreatesNewTabWithSameSurfaceAndMovesTabState() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

      let sourceTabID = try #require(host.selectedTabID)
      let sourceSurface = try #require(host.selectedSurfaceView)
      let secondPane = try host.createPane(
        .init(
          command: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .contextPane(sourceSurface.id)
        )
      )
      _ = try host.notify(
        .init(
          body: "Need approval",
          subtitle: "",
          target: .contextPane(sourceSurface.id),
          title: nil
        )
      )
      #expect(host.setAgentActivity(.codex(.running, detail: "Thinking"), for: sourceSurface.id))

      host.handleCommand(.moveSurfaceToNewTab(sourceSurface.id))

      let destinationTabID = try #require(host.selectedTabID)

      #expect(destinationTabID != sourceTabID)
      #expect(host.splitTree(for: sourceTabID).leaves().map(\.id) == [secondPane.paneID])
      #expect(host.splitTree(for: destinationTabID).leaves().map(\.id) == [sourceSurface.id])
      #expect(host.selectedSurfaceView === sourceSurface)
      #expect(host.unreadNotificationCount(for: sourceTabID) == 0)
      #expect(host.unreadNotificationCount(for: destinationTabID) == 1)
      #expect(host.unreadNotifiedSurfaceIDs(in: destinationTabID) == Set([sourceSurface.id]))
      #expect(host.agentActivity(for: sourceTabID) == nil)
      #expect(host.agentActivity(for: destinationTabID) == .codex(.running, detail: "Thinking"))

      sourceSurface.bridge.state.title = "tail -f"
      sourceSurface.bridge.onTitleChange?("tail -f")

      #expect(host.spaceManager.tab(for: destinationTabID)?.title == "tail -f")
      #expect(host.spaceManager.tab(for: sourceTabID)?.title != "tail -f")
    }
  }

  @Test
  func movingOnlyPaneRemovesSourceTabWithoutClosingSurface() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

      let sourceTabID = try #require(host.selectedTabID)
      let sourceSurface = try #require(host.selectedSurfaceView)
      let surfaceHandle = try #require(sourceSurface.surface)

      host.handleCommand(.moveSurfaceToNewTab(sourceSurface.id))

      let destinationTabID = try #require(host.selectedTabID)
      let focusResult = try host.focusPane(.contextPane(sourceSurface.id))

      #expect(destinationTabID != sourceTabID)
      #expect(host.tabs.count == 1)
      #expect(host.spaceManager.tab(for: sourceTabID) == nil)
      #expect(host.splitTree(for: destinationTabID).leaves().map(\.id) == [sourceSurface.id])
      #expect(host.selectedSurfaceView === sourceSurface)
      #expect(sourceSurface.surface == surfaceHandle)
      #expect(sourceSurface.surface != nil)
      #expect(focusResult.target.tabID == destinationTabID.rawValue)
      #expect(focusResult.target.paneID == sourceSurface.id)
    }
  }
}
