import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
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

      let spaceID = host.displayedSpaceID
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

      _ = try host.createTab(
        TerminalCreateTabRequest(
          startupCommand: nil,
          cwd: restoredPathString,
          focus: false,
          target: .space(spaceID.rawValue)
        )
      )

      let tabs = host.spaceManager.tabs(in: spaceID)
      let firstTabID = try #require(tabs.first?.id)
      let groupedTabID = try #require(tabs.last?.id)
      host.handleCommand(.selectTab(groupedTabID))
      host.spaceManager.tabManager(for: spaceID)?.setLockedTitle(
        groupedTabID, title: "Grouped Tab")
      host.selectedSurfaceView?.setTitleOverride("Pane Title")
      let groupID = try #require(
        host.createGroup(title: "Workspace", color: .purple, containing: [groupedTabID])
      ).groupID
      host.handleCommand(.selectTab(firstTabID))
      #expect(host.setGroupCollapsed(groupID, isCollapsed: true))

      let snapshot = host.restorationSnapshot()
      let snapshotSpace = try #require(snapshot.displayedSpace)
      #expect(snapshot.displayedSpaceID == spaceID)
      #expect(snapshotSpace.selectedTabID == firstTabID)
      #expect(snapshotSpace.groups.first?.lifetime == .automatic)
      #expect(snapshotSpace.collapsedGroupIDs == [groupID])

      let restored = TerminalHostState()
      #expect(restored.restore(from: snapshot))
      #expect(restored.displayedSpaceID == spaceID)
      #expect(restored.spaceManager.selectedTabID(in: spaceID) == firstTabID)
      #expect(restored.spaceManager.tabs(in: spaceID).map(\.id) == tabs.map(\.id))
      #expect(restored.collapsedTabGroupIDs == [groupID])
      #expect(
        restored.spaceManager.tabManager(for: spaceID)?.groupID(containing: groupedTabID) == groupID
      )
      #expect(
        restored.spaceManager.tabManager(for: spaceID)?.group(for: groupID)?.lifetime
          == .automatic
      )
      #expect(restored.spaceManager.tabs(in: spaceID).last?.title == "Grouped Tab")
      #expect(restored.spaceManager.tabs(in: spaceID).last?.isTitleLocked == true)
      restored.handleCommand(.selectTab(groupedTabID))
      #expect(restored.selectedSurfaceState?.pwd == restoredPathString)
      #expect(restored.selectedSurfaceState?.titleOverride == "Pane Title")

      let debug = restored.debugWindowSnapshot(index: 1)
      let debugSpace = try #require(debug.spaces.first)
      let debugTabs = debugTabs(in: debugSpace)
      #expect(debugTabs.first?.panes.count == 2)
      #expect(debugTabs.first?.panes.filter(\.isFocused).count == 1)
      #expect(
        debugTabs.last?.panes.first(where: \.isFocused)?.displayTitle == "Pane Title"
      )
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
      let session = TerminalSpaceSession(
        spaceID: spaceID,
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

      #expect(
        host.restore(
          from: TerminalWindowSession(displayedSpaceID: spaceID, spaces: [session])
        )
      )
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

  @Test
  func hiddenSpaceKeepsItsLayoutUntilItIsDisplayed() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let hiddenSurfaceID = UUID()
      let hiddenSpace = spaceSession(
        spaceID: spaces[1].id,
        title: "Hidden Tab",
        isPinned: true,
        surfaceID: hiddenSurfaceID
      )
      let session = TerminalWindowSession(
        displayedSpaceID: spaces[0].id,
        spaces: [
          spaceSession(spaceID: spaces[0].id, title: "Displayed Tab"),
          hiddenSpace,
        ]
      )
      let hiddenTabID = try #require(hiddenSpace.selectedTabID)

      let host = TerminalHostState(spaceID: spaces[0].id)
      #expect(host.restore(from: session))
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hiddenSpace)
      #expect(host.trees[hiddenTabID] == nil)
      #expect(host.surfaces[hiddenSurfaceID] == nil)
      #expect(host.sessionSurfaceIDs().contains(hiddenSurfaceID))

      let data = try TerminalSessionCatalog.fileStorageEncoder().encode(
        TerminalSessionCatalog(windows: [host.restorationSnapshot()])
      )
      let reloaded = try JSONDecoder().decode(TerminalSessionCatalog.self, from: data)
      #expect(reloaded.windows.first?.spaces.last == hiddenSpace)

      #expect(host.displaySpace(spaces[1].id))
      #expect(host.spaceManager.tabs(in: spaces[1].id).map(\.id) == [hiddenTabID])
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == nil)
      #expect(host.trees[hiddenTabID]?.leaves().map(\.id) == [hiddenSurfaceID])
      #expect(host.spaceManager.tabs(in: spaces[1].id).first?.title == "Hidden Tab")
      #expect(host.spaceManager.tabManager(for: spaces[1].id)?.isPinned(hiddenTabID) == true)
    }
  }

  @Test
  func focusingAHiddenPaneWarmsItsSpaceAndDisplaysIt() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let hiddenSurfaceID = UUID()
      let session = TerminalWindowSession(
        displayedSpaceID: spaces[0].id,
        spaces: [
          spaceSession(spaceID: spaces[0].id, title: "Displayed Tab"),
          spaceSession(spaceID: spaces[1].id, title: "Hidden Tab", surfaceID: hiddenSurfaceID),
        ]
      )

      let host = TerminalHostState(spaceID: spaces[0].id)
      #expect(host.restore(from: session))

      let result = try host.focusPane(TerminalPaneTarget(paneID: hiddenSurfaceID))

      #expect(result.target.paneID == hiddenSurfaceID)
      #expect(host.displayedSpaceID == spaces[1].id)
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == nil)
      #expect(host.focusHistoryByTab[try #require(host.selectedTabID)]?.current == hiddenSurfaceID)
    }
  }

  @Test
  func mutatingAColdGroupWarmsItsSpace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let groupID = TerminalTabGroupID()
      let tabID = TerminalTabID()
      let hiddenSpace = TerminalSpaceSession(
        spaceID: spaces[1].id,
        selectedTabID: tabID,
        nodes: [
          TerminalTabNodeSession(
            item: .group(groupID),
            parent: .root(isPinned: false),
            order: 0
          ),
          TerminalTabNodeSession(
            item: .tab(tabID),
            parent: .group(groupID),
            order: 0
          ),
        ],
        groups: [
          TerminalTabGroupSession(
            id: groupID,
            title: "Cold",
            color: .blue,
            lifetime: .durable
          )
        ],
        collapsedGroupIDs: [],
        tabs: [tabSession(id: tabID, title: "Hidden Tab")]
      )
      let host = TerminalHostState(spaceID: spaces[0].id)
      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [
              spaceSession(spaceID: spaces[0].id, title: "Displayed Tab"),
              hiddenSpace,
            ]
          )
        )
      )
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hiddenSpace)

      let result = try host.executeTabGroup(
        .rename(TerminalRenameTabGroupRequest(groupID: groupID.rawValue, title: "Warm"))
      )

      guard case .group(let mutation) = result else {
        Issue.record("Expected group mutation")
        return
      }
      #expect(mutation.group.title == "Warm")
      #expect(mutation.spaceID == spaces[1].id.rawValue)
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == nil)
    }
  }

  @Test
  func aPaneStaysReadyWhileItsSpaceIsOffScreen() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let hiddenSurfaceID = UUID()
      let session = TerminalWindowSession(
        displayedSpaceID: spaces[0].id,
        spaces: [
          spaceSession(spaceID: spaces[0].id, title: "Displayed Tab"),
          spaceSession(spaceID: spaces[1].id, title: "Hidden Tab", surfaceID: hiddenSurfaceID),
        ]
      )

      let host = TerminalHostState(spaceID: spaces[0].id)
      #expect(host.restore(from: session))
      #expect(host.displaySpace(spaces[1].id))
      #expect(host.displaySpace(spaces[0].id))

      let health = try host.paneHealth(
        TerminalPaneHealthRequest(target: TerminalPaneTarget(paneID: hiddenSurfaceID))
      )

      #expect(!health.isAttachedToWindow)
      #expect(health.isReady)
    }
  }

  @Test
  func emptyDisplayedSpaceKeepsTheHiddenSpacesItRestoredWith() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }

      let hiddenSpace = spaceSession(spaceID: spaces[1].id, title: "Hidden Tab")
      let session = TerminalWindowSession(
        displayedSpaceID: spaces[0].id,
        spaces: [
          TerminalSpaceSession(
            spaceID: spaces[0].id,
            selectedTabID: nil,
            nodes: [],
            groups: [],
            collapsedGroupIDs: [],
            tabs: []
          ),
          hiddenSpace,
        ]
      )

      let host = TerminalHostState(spaceID: spaces[0].id)
      #expect(host.restore(from: session))
      #expect(host.spaceManager.tabs(in: spaces[0].id).count == 1)
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hiddenSpace)
      #expect(host.restorationSnapshot().spaces.last == hiddenSpace)
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

  private func spaceSession(
    spaceID: TerminalSpaceID,
    title: String,
    isPinned: Bool = false,
    surfaceID: UUID = UUID()
  ) -> TerminalSpaceSession {
    let tabID = TerminalTabID()
    return TerminalSpaceSession(
      spaceID: spaceID,
      selectedTabID: tabID,
      nodes: [
        TerminalTabNodeSession(
          item: .tab(tabID),
          parent: .root(isPinned: isPinned),
          order: 0
        )
      ],
      groups: [],
      collapsedGroupIDs: [],
      tabs: [
        TerminalTabSession(
          id: tabID,
          lockedTitle: title,
          focusedPaneIndex: 0,
          root: .leaf(TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: nil))
        )
      ]
    )
  }
}
