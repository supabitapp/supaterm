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
          target: .pane(firstSurfaceID)
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
          target: .space(secondSpaceID.rawValue)
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
      ).groupID
      host.handleCommand(.selectTab(secondSpaceInitialTabID))
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      let snapshot = host.restorationSnapshot()
      let secondSpaceSnapshot = try #require(
        snapshot.spaces.first(where: { $0.id == secondSpaceID })
      )
      #expect(secondSpaceSnapshot.selectedTabID == secondSpaceInitialTabID)
      #expect(secondSpaceSnapshot.groups.first?.lifetime == .automatic)
      #expect(secondSpaceSnapshot.collapsedGroupIDs == [groupID])

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.selectedSpaceID == secondSpaceID)
      #expect(
        restored.spaceManager.selectedTabID(in: firstSpaceID)
          == restored.spaceManager.tabs(in: firstSpaceID).first?.id)
      #expect(
        restored.spaceManager.selectedTabID(in: secondSpaceID)
          == secondSpaceInitialTabID
      )
      #expect(restored.spaceManager.tabs(in: secondSpaceID).count == secondSpaceTabs.count)
      #expect(
        restored.spaceManager.tabs(in: secondSpaceID).map(\.id)
          == secondSpaceTabs.map(\.id)
      )
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
      #expect(
        restored.spaceManager.tabManager(for: secondSpaceID)?.group(for: groupID)?.lifetime
          == .automatic
      )
      #expect(restored.spaceManager.tabs(in: secondSpaceID).last?.title == "Pinned Tab")
      #expect(restored.spaceManager.tabs(in: secondSpaceID).last?.isTitleLocked == true)
      restored.handleCommand(.selectTab(restoredGroupedTabID))
      #expect(restored.selectedSurfaceState?.pwd == restoredPathString)
      #expect(restored.selectedSurfaceState?.titleOverride == "Pane Title")

      try expectDebugSnapshot(restored, firstSpaceID: firstSpaceID)
    }
  }

  @Test
  func restorePreservesGroupLifetimesAndSelectedGroupCollapse() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let host = TerminalHostState()
      let spaceID = try #require(host.spaces.first?.id)
      let automaticGroupID = TerminalTabGroupID()
      let durableGroupID = TerminalTabGroupID()
      let automaticTabID = TerminalTabID()
      let durableTabID = TerminalTabID()
      let session = TerminalWindowSession(
        selectedSpaceID: spaceID,
        spaces: [
          TerminalWindowSpaceSession(
            id: spaceID,
            selectedTabID: automaticTabID,
            nodes: [
              TerminalTabNodeSession(
                item: .group(automaticGroupID),
                parent: .root(isPinned: false),
                order: 0
              ),
              TerminalTabNodeSession(
                item: .tab(automaticTabID),
                parent: .group(automaticGroupID),
                order: 0
              ),
              TerminalTabNodeSession(
                item: .group(durableGroupID),
                parent: .root(isPinned: false),
                order: 1
              ),
              TerminalTabNodeSession(
                item: .tab(durableTabID),
                parent: .group(durableGroupID),
                order: 0
              ),
            ],
            groups: [
              TerminalTabGroupSession(
                id: automaticGroupID,
                title: "Automatic",
                color: .blue,
                lifetime: .automatic
              ),
              TerminalTabGroupSession(
                id: durableGroupID,
                title: "Durable",
                color: .purple,
                lifetime: .durable
              ),
            ],
            collapsedGroupIDs: [automaticGroupID, durableGroupID],
            tabs: [
              tabSession(id: automaticTabID, title: "Automatic"),
              tabSession(id: durableTabID, title: "Durable"),
            ]
          )
        ]
      )

      #expect(host.restore(from: session))
      let manager = try #require(host.spaceManager.tabManager(for: spaceID))
      #expect(manager.tabs.map(\.id) == [automaticTabID, durableTabID])
      #expect(manager.selectedTabId == automaticTabID)
      #expect(host.collapsedTabGroupIDs == [automaticGroupID, durableGroupID])
      #expect(manager.group(for: automaticGroupID)?.lifetime == .automatic)
      #expect(manager.group(for: durableGroupID)?.lifetime == .durable)

      _ = try host.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: manager.topologyRevision,
          itemIDs: [.tab(automaticTabID)],
          destination: .root(
            TerminalRootPlacement(
              isPinned: false,
              index: try #require(
                manager.rootCount(isPinned: false, afterRemoving: [.tab(automaticTabID)])
              )
            )
          )
        )
      )

      #expect(manager.group(for: automaticGroupID) == nil)

      _ = try host.move(
        TerminalTabMoveRequest(
          expectedTopologyRevision: manager.topologyRevision,
          itemIDs: [.tab(durableTabID)],
          destination: .root(
            TerminalRootPlacement(
              isPinned: false,
              index: try #require(
                manager.rootCount(isPinned: false, afterRemoving: [.tab(durableTabID)])
              )
            )
          )
        )
      )

      #expect(manager.group(for: durableGroupID)?.lifetime == .durable)
      #expect(manager.tabIDs(in: durableGroupID).isEmpty)
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

  private func expectDebugSnapshot(
    _ host: TerminalHostState,
    firstSpaceID: TerminalSpaceID
  ) throws {
    let debug = host.debugWindowSnapshot(index: 1)
    let firstSpace = try #require(
      debug.spaces.first(where: { $0.id == firstSpaceID.rawValue }))
    let firstTab = try #require(debugTabs(in: firstSpace).first)
    let lastSpace = try #require(debug.spaces.last)

    #expect(firstTab.panes.count == 2)
    #expect(firstTab.panes.filter(\.isFocused).count == 1)
    #expect(
      debugTabs(in: lastSpace).last?.panes.first(where: \.isFocused)?.displayTitle
        == "Pane Title")
  }

  private func tabSession(
    id: TerminalTabID,
    title: String
  ) -> TerminalTabSession {
    TerminalTabSession(
      id: id,
      lockedTitle: title,
      focusedPaneIndex: 0,
      root: .leaf(TerminalPaneLeafSession(workingDirectoryPath: nil))
    )
  }
}
