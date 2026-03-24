import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateSessionRestoreTests {
  @Test
  func restorationSnapshotRoundTripsTabsSplitsAndSelections() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let restoredPath = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: restoredPath, withIntermediateDirectories: true)
      let restoredPathString = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        restoredPath.path(percentEncoded: false)
      )
      defer {
        try? FileManager.default.removeItem(at: restoredPath)
      }

      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false))

      let firstSpaceID = try #require(host.selectedSpaceID)
      let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString

      _ = try host.createPane(
        .init(
          command: nil,
          direction: .right,
          focus: true,
          target: .contextPane(firstSurfaceID)
        )
      )
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString
      let firstSpaceTabID = try #require(host.selectedTabID)

      host.handleCommand(.createSpace)
      let secondSpaceID = try #require(host.selectedSpaceID)
      let secondSpaceInitialTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(secondSpaceInitialTabID))

      _ = try host.createTab(
        .init(
          command: nil,
          cwd: restoredPathString,
          focus: false,
          target: .space(windowIndex: 1, spaceIndex: 2)
        )
      )

      let secondSpaceTabs = host.spaceManager.tabs(in: secondSpaceID)
      let secondSpaceSelectedTabID = try #require(secondSpaceTabs.last?.id)
      host.handleCommand(.selectTab(secondSpaceSelectedTabID))

      let snapshot = host.restorationSnapshot()

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.selectedSpaceID == secondSpaceID)
      #expect(restored.spaceManager.selectedTabID(in: firstSpaceID) == firstSpaceTabID)
      #expect(restored.spaceManager.selectedTabID(in: secondSpaceID) == secondSpaceSelectedTabID)
      #expect(restored.spaceManager.tabs(in: secondSpaceID).map(\.id) == secondSpaceTabs.map(\.id))
      #expect(restored.spaceManager.tabs(in: secondSpaceID).map(\.isPinned) == [true, false])
      #expect(restored.selectedSurfaceState?.pwd == restoredPathString)

      let debug = restored.debugWindowSnapshot(index: 1)
      let restoredFirstSpace = try #require(debug.spaces.first(where: { $0.id == firstSpaceID.rawValue }))
      let restoredFirstTab = try #require(
        restoredFirstSpace.tabs.first(where: { $0.id == firstSpaceTabID.rawValue })
      )

      #expect(restoredFirstTab.panes.count == 2)
      #expect(restoredFirstTab.panes.filter(\.isFocused).count == 1)
    }
  }
}
