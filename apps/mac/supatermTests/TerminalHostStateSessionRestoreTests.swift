import ComposableArchitecture
import Foundation
import SupatermSupport
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateSessionRestoreTests {
  @Test
  func disabledZmxSessionsLeaveStartupCommandUnwrapped() {
    let host = TerminalHostState(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient(),
      zmxSessionsEnabled: false
    )

    let command = host.resolvedSurfaceCommand(
      startupCommand: "echo hello",
      surfaceID: UUID()
    )

    #expect(command.command == SupatermShellCommand.ghosttyStartupCommand(for: "echo hello"))
    #expect(command.commandWrapper.isEmpty)
    #expect(!command.usesZmx)
  }

  @Test
  func enabledZmxSessionsWrapInteractiveShellWithoutCommand() {
    let surfaceID = UUID()
    let host = TerminalHostState(
      managesTerminalSurfaces: false,
      zmxClient: ZmxClient(
        executableURL: { URL(fileURLWithPath: "/tmp/zmx") },
        isBundled: { true },
        killSession: { _ in },
        listSessions: { [] }
      )
    )

    let command = host.resolvedSurfaceCommand(
      startupCommand: nil,
      surfaceID: surfaceID
    )

    #expect(command.command == nil)
    #expect(command.commandWrapper == ["/tmp/zmx", "attach", ZmxSessionID.make(surfaceID: surfaceID)])
    #expect(command.usesZmx)
  }

  @Test
  func enabledZmxSessionsWrapStartupCommandThroughLoginShell() {
    let surfaceID = UUID()
    let host = TerminalHostState(
      managesTerminalSurfaces: false,
      zmxClient: ZmxClient(
        executableURL: { URL(fileURLWithPath: "/tmp/zmx") },
        isBundled: { true },
        killSession: { _ in },
        listSessions: { [] }
      )
    )

    let command = host.resolvedSurfaceCommand(
      startupCommand: #"sp onboard; exec "${SHELL:-/bin/zsh}" -l"#,
      surfaceID: surfaceID
    )

    #expect(
      command.command
        == SupatermShellCommand.ghosttyStartupCommand(
          for: #"sp onboard; exec "${SHELL:-/bin/zsh}" -l"#
        )
    )
    #expect(command.commandWrapper == ["/tmp/zmx", "attach", ZmxSessionID.make(surfaceID: surfaceID)])
    #expect(command.usesZmx)
  }

  @Test
  func unavailableZmxFallsBackToRawStartupCommand() {
    let host = TerminalHostState(
      managesTerminalSurfaces: false,
      zmxClient: ZmxClient(
        executableURL: { nil },
        isBundled: { true },
        killSession: { _ in },
        listSessions: { [] }
      )
    )

    let command = host.resolvedSurfaceCommand(
      startupCommand: "echo hello",
      surfaceID: UUID()
    )

    #expect(command.command == SupatermShellCommand.ghosttyStartupCommand(for: "echo hello"))
    #expect(command.commandWrapper.isEmpty)
    #expect(!command.usesZmx)
  }

  @Test
  func disabledZmxSessionsSkipSessionCleanup() async {
    let killedSurfaceIDs = LockIsolated<[UUID]>([])
    let host = TerminalHostState(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient(killSession: { surfaceID in
        killedSurfaceIDs.withValue { $0.append(surfaceID) }
      }),
      zmxSessionsEnabled: false
    )
    let surfaceID = UUID()

    await host.killZmxSessionsAndWait(for: [surfaceID])

    #expect(killedSurfaceIDs.value.isEmpty)
  }

  @Test
  func ensureInitialTabUsesRequestedWorkingDirectoryPath() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer {
        try? FileManager.default.removeItem(at: directory)
      }
      let path = GhosttySurfaceView.normalizedWorkingDirectoryPath(
        directory.path(percentEncoded: false)
      )
      let host = TerminalHostState()

      host.handleCommand(
        .ensureInitialTab(
          focusing: false,
          startupCommand: nil,
          workingDirectoryPath: path
        )
      )

      #expect(host.selectedSurfaceState?.pwd == path)
    }
  }

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
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

      let firstSpaceID = try #require(host.selectedSpaceID)
      let firstSurfaceID = try #require(host.selectedSurfaceView?.id)
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: true,
          equalize: true,
          target: .contextPane(firstSurfaceID)
        )
      )
      host.selectedSurfaceView?.bridge.state.pwd = restoredPathString

      host.handleCommand(.createSpace(name: "Workspace"))
      let secondSpaceID = try #require(host.selectedSpaceID)
      let secondSpaceInitialTabID = try #require(host.selectedTabID)
      host.handleCommand(.togglePinned(secondSpaceInitialTabID))

      _ = try host.createTab(
        TerminalCreateTabRequest(
          startupCommand: nil,
          cwd: restoredPathString,
          focus: false,
          target: .space(windowIndex: 1, spaceIndex: 2)
        )
      )

      let secondSpaceTabs = host.spaceManager.tabs(in: secondSpaceID)
      let secondSpaceSelectedTabID = try #require(secondSpaceTabs.last?.id)
      host.handleCommand(.selectTab(secondSpaceSelectedTabID))
      host.spaceManager.tabManager(for: secondSpaceID)?.setLockedTitle(
        secondSpaceSelectedTabID, title: "Pinned Tab")
      host.selectedSurfaceView?.setTitleOverride("Pane Title")
      let groupID = try #require(
        host.createGroup(title: "Workspace", color: .purple, containing: [secondSpaceSelectedTabID])
      )
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      let snapshot = host.restorationSnapshot()

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.selectedSpaceID == secondSpaceID)
      #expect(
        restored.spaceManager.selectedTabID(in: firstSpaceID)
          == restored.spaceManager.tabs(in: firstSpaceID).first?.id)
      #expect(
        restored.spaceManager.selectedTabID(in: secondSpaceID)
          == restored.spaceManager.tabs(in: secondSpaceID).last?.id
      )
      #expect(restored.spaceManager.tabs(in: secondSpaceID).count == secondSpaceTabs.count)
      #expect(restored.spaceManager.rootItems(in: secondSpaceID).map(\.isPinned) == [true, true])
      #expect(restored.collapsedTabGroupIDs == [groupID])
      let restoredGroupedTabID = try #require(
        restored.spaceManager.tabs(in: secondSpaceID).last?.id
      )
      #expect(
        restored.spaceManager.tabManager(for: secondSpaceID)?.groupID(
          containing: restoredGroupedTabID
        ) == groupID
      )
      #expect(restored.spaceManager.tabs(in: secondSpaceID).last?.title == "Pinned Tab")
      #expect(restored.spaceManager.tabs(in: secondSpaceID).last?.isTitleLocked == true)
      #expect(restored.selectedSurfaceState?.pwd == restoredPathString)
      #expect(restored.selectedSurfaceState?.titleOverride == "Pane Title")

      let debug = restored.debugWindowSnapshot(index: 1)
      let restoredFirstSpace = try #require(
        debug.spaces.first(where: { $0.id == firstSpaceID.rawValue }))
      let restoredFirstTab = try #require(debugTabs(in: restoredFirstSpace).first)
      let restoredLastSpace = try #require(debug.spaces.last)

      #expect(restoredFirstTab.panes.count == 2)
      #expect(restoredFirstTab.panes.filter(\.isFocused).count == 1)
      #expect(
        debugTabs(in: restoredLastSpace).last?.panes.first(where: \.isFocused)?.displayTitle
          == "Pane Title")
    }
  }

  private func wrappingZmxClient(killSession: @escaping @Sendable (UUID) async -> Void = { _ in }) -> ZmxClient {
    ZmxClient(
      executableURL: { URL(fileURLWithPath: "/tmp/zmx") },
      isBundled: { true },
      killSession: killSession,
      listSessions: { [] }
    )
  }

  private func debugTabs(
    in space: SupatermAppDebugSnapshot.Space
  ) -> [SupatermAppDebugSnapshot.Tab] {
    space.rootItems.flatMap { item in
      switch item {
      case .group(let group):
        group.tabs
      case .tab(let rootTab):
        [rootTab.tab]
      }
    }
  }
}
