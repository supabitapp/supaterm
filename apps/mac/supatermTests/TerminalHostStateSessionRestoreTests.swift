import ComposableArchitecture
import Dependencies
import Foundation
import Sharing
import SupaTheme
import SupatermSupport
import Testing

@testable import supaterm

@MainActor
struct TerminalHostStateSessionRestoreTests {
  @Test
  func disabledZmxSessionsDoNotWrapTheShell() {
    let host = TerminalHostState.test(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient(),
      zmxSessionsEnabled: false
    )

    #expect(host.resolvedCommandWrapper(surfaceID: UUID(), mode: .createIfNeeded).isEmpty)
  }

  @Test
  func enabledZmxSessionsWrapTheShell() {
    let surfaceID = UUID()
    let host = TerminalHostState.test(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient()
    )

    #expect(
      host.resolvedCommandWrapper(surfaceID: surfaceID, mode: .createIfNeeded)
        == ["/tmp/zmx", "attach", ZmxSessionID.make(surfaceID: surfaceID)]
    )
  }

  @Test
  func zmxReattachOnlyTargetsExistingSessions() {
    let surfaceID = UUID()
    let host = TerminalHostState.test(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient()
    )

    #expect(
      host.resolvedCommandWrapper(surfaceID: surfaceID, mode: .existing)
        == ["/tmp/zmx", "attach", "--existing", ZmxSessionID.make(surfaceID: surfaceID)]
    )
  }

  @Test
  func unavailableZmxDoesNotWrapTheShell() {
    let host = TerminalHostState.test(
      managesTerminalSurfaces: false,
      zmxClient: ZmxClient(
        executableURL: { nil },
        isBundled: { true },
        killSession: { _ in },
        listSessions: { [] }
      )
    )

    #expect(host.resolvedCommandWrapper(surfaceID: UUID(), mode: .createIfNeeded).isEmpty)
  }

  @Test
  func disabledZmxSessionsSkipSessionCleanup() async {
    let killedSurfaceIDs = LockIsolated<[UUID]>([])
    let host = TerminalHostState.test(
      managesTerminalSurfaces: false,
      zmxClient: wrappingZmxClient { surfaceID in
        killedSurfaceIDs.withValue { $0.append(surfaceID) }
      },
      zmxSessionsEnabled: false
    )

    await host.killZmxSessionsAndWait(for: [UUID()])

    #expect(killedSurfaceIDs.value.isEmpty)
  }

  @Test
  func ensureInitialTabUsesRequestedWorkingDirectoryPath() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      let path = GhosttySurfaceView.normalizedWorkingDirectoryPath(directory.path)
      let host = TerminalHostState.test()

      host.ensureInitialTab(
        focusing: false,
        startupCommand: nil,
        workingDirectoryPath: path
      )

      #expect(host.selectedSurfaceState?.pwd == path)
    }
  }

  @Test
  func restorationRoundTripsProjectMembershipPinningCollapseAndSplits() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let directory = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: directory) }
      let path = GhosttySurfaceView.normalizedWorkingDirectoryPath(directory.path)
      let host = TerminalHostState.test()
      host.ensureInitialTab(focusing: false, startupCommand: nil, workingDirectoryPath: path)
      let spaceID = host.displayedSpaceID
      let firstTabID = try #require(host.selectedTabID)
      let firstSurfaceID = try #require(host.selectedSurfaceView?.id)

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: true,
          equalize: true,
          target: .pane(firstSurfaceID)
        )
      )
      _ = try host.createTab(
        TerminalCreateTabRequest(
          startupCommand: nil,
          cwd: path,
          focus: false,
          projectID: nil,
          target: .space(spaceID.rawValue)
        )
      )
      let projectTabID = try #require(host.spaceManager.tabs(in: spaceID).last?.id)
      host.selectTab(projectTabID)
      host.spaceManager.tabCollection(for: spaceID)?.setLockedTitle(projectTabID, title: "Project Tab")
      host.selectedSurfaceView?.setTitleOverride("Pane Title")
      let project = TerminalProject(name: "Workspace", color: .purple)
      host.$projectCatalog.withLock { $0 = TerminalProjectCatalog(projects: [project]) }
      #expect(
        host.spaceManager.tabCollection.assign(
          [projectTabID],
          to: project.id,
          orderedProjectIDs: [project.id]
        )
      )
      let projectID = project.id
      #expect(host.setTabPinned(projectTabID, isPinned: true) != nil)
      host.selectTab(firstTabID)
      #expect(host.setProjectCollapsed(projectID, isCollapsed: true))

      let snapshot = host.restorationSnapshot()
      let snapshotSpace = try #require(snapshot.displayedSpace)
      let persistedProjectTab = try #require(snapshotSpace.tabs.first { $0.id == projectTabID })
      #expect(persistedProjectTab.projectID == projectID)
      #expect(persistedProjectTab.isPinned)
      #expect(snapshotSpace.collapsedProjectIDs == [projectID])

      let restored = TerminalHostState.test()
      #expect(restored.restore(from: snapshot))
      #expect(restored.displayedSpaceID == spaceID)
      #expect(restored.spaceManager.selectedTabID(in: spaceID) == firstTabID)
      #expect(restored.spaceManager.tabs(in: spaceID).map(\.id) == snapshotSpace.tabs.map(\.id))
      #expect(restored.isProjectCollapsed(projectID, in: spaceID))
      #expect(restored.spaceManager.tabCollection(for: spaceID)?.tab(for: projectTabID)?.projectID == projectID)
      #expect(restored.spaceManager.tabCollection(for: spaceID)?.tab(for: projectTabID)?.isPinned == true)
      restored.selectTab(projectTabID)
      #expect(restored.selectedSurfaceState?.pwd == path)
      #expect(restored.selectedSurfaceState?.titleOverride == "Pane Title")

      let debug = restored.debugWindowSnapshot(index: 1)
      let debugTabs = try #require(debug.spaces.first).flattenedTabs
      #expect(debugTabs.first { $0.id == firstTabID.rawValue }?.panes.count == 2)
      #expect(debugTabs.first { $0.id == projectTabID.rawValue }?.projectID == projectID.rawValue)
    }
  }

  @Test
  func hiddenSpaceKeepsFlatProjectLayoutUntilDisplayed() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let projectID = TerminalProjectID()
      let hiddenSurfaceID = UUID()
      let hiddenSpace = spaceSession(
        spaceID: spaces[1].id,
        title: "Hidden Tab",
        projectID: projectID,
        isPinned: true,
        surfaceID: hiddenSurfaceID,
        workingDirectoryPath: "/tmp/hidden",
        collapsedProjectIDs: [projectID]
      )
      let hiddenTabID = try #require(hiddenSpace.selectedTabID)
      let host = TerminalHostState.test(spaceID: spaces[0].id)

      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [spaceSession(spaceID: spaces[0].id, title: "Displayed"), hiddenSpace]
          )
        )
      )
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hiddenSpace)
      #expect(host.sessionSurfaceIDs().contains(hiddenSurfaceID))
      #expect(host.restorationSnapshot().spaces.last == hiddenSpace)

      #expect(host.displaySpace(spaces[1].id))
      #expect(host.spaceManager.tabs(in: spaces[1].id).map(\.id) == [hiddenTabID])
      #expect(host.spaceManager.tabCollection(for: spaces[1].id)?.tab(for: hiddenTabID)?.projectID == projectID)
      #expect(host.spaceManager.tabCollection(for: spaces[1].id)?.tab(for: hiddenTabID)?.isPinned == true)
      #expect(host.isProjectCollapsed(projectID, in: spaces[1].id))
    }
  }

  @Test
  func hiddenSpaceSnapshotUsesSemanticProjectOrder() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let project = TerminalProject(name: "Work")
      @Shared(.terminalProjectCatalog) var projectCatalog = TerminalProjectCatalog.default
      $projectCatalog.withLock { $0 = TerminalProjectCatalog(projects: [project]) }
      let first = spaceSession(spaceID: spaces[1].id, title: "First")
      let projectTab = spaceSession(
        spaceID: spaces[1].id,
        title: "Project",
        projectID: project.id
      )
      let last = spaceSession(spaceID: spaces[1].id, title: "Last")
      let hidden = TerminalSpaceSession(
        spaceID: spaces[1].id,
        selectedTabID: first.selectedTabID,
        tabs: first.tabs + projectTab.tabs + last.tabs
      )
      let host = TerminalHostState.test(spaceID: spaces[0].id)

      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [spaceSession(spaceID: spaces[0].id, title: "Displayed"), hidden]
          )
        )
      )

      let snapshot = host.debugWindowSnapshot(index: 1)
      #expect(snapshot.spaces[1].flattenedTabs.map(\.title) == ["Project", "First", "Last"])
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hidden)
    }
  }

  @Test
  func moveProjectTabUpdatesAColdSpaceWithoutWarmingIt() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var spaceCatalog = TerminalSpaceCatalog.default
      $spaceCatalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let project = TerminalProject(name: "Work")
      @Shared(.terminalProjectCatalog) var projectCatalog = TerminalProjectCatalog.default
      $projectCatalog.withLock { $0 = TerminalProjectCatalog(projects: [project]) }
      let existing = spaceSession(
        spaceID: spaces[1].id,
        title: "Existing",
        projectID: project.id,
        isPinned: true
      )
      let moved = spaceSession(spaceID: spaces[1].id, title: "Moved")
      let tail = spaceSession(spaceID: spaces[1].id, title: "Tail")
      let movedTabID = moved.tabs[0].id
      let hidden = TerminalSpaceSession(
        spaceID: spaces[1].id,
        selectedTabID: movedTabID,
        collapsedProjectIDs: [project.id],
        tabs: existing.tabs + moved.tabs + tail.tabs
      )
      let host = TerminalHostState.test(spaceID: spaces[0].id)
      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [spaceSession(spaceID: spaces[0].id, title: "Displayed"), hidden]
          )
        )
      )

      let result = try host.moveProjectTab(
        SupatermMoveTabRequest(
          index: 2,
          isPinned: true,
          projectID: project.id.rawValue,
          target: SupatermTabTargetRequest(tabID: movedTabID.rawValue)
        )
      )

      let session = try #require(host.spaceManager.instance(for: spaces[1].id)?.pendingSession)
      #expect(session.tabs.map(\.lockedTitle) == ["Existing", "Moved", "Tail"])
      #expect(session.tabs[1].projectID == project.id)
      #expect(session.tabs[1].isPinned)
      #expect(!session.collapsedProjectIDs.contains(project.id))
      #expect(result.target.spaceIndex == 2)
      #expect(result.target.tabIndex == 2)
      #expect(result.target.title == "Moved")
    }
  }

  @Test
  func focusingHiddenPaneWarmsAndDisplaysItsSpace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let hiddenSurfaceID = UUID()
      let host = TerminalHostState.test(spaceID: spaces[0].id)
      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [
              spaceSession(spaceID: spaces[0].id, title: "Displayed"),
              spaceSession(spaceID: spaces[1].id, title: "Hidden", surfaceID: hiddenSurfaceID),
            ]
          )
        )
      )

      let result = try host.focusPane(TerminalPaneTarget(paneID: hiddenSurfaceID))

      #expect(result.target.paneID == hiddenSurfaceID)
      #expect(host.displayedSpaceID == spaces[1].id)
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == nil)
    }
  }

  @Test
  func emptyDisplayedSpaceKeepsHiddenSessions() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "Displayed"), TerminalSpaceItem(name: "Hidden")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let hiddenSpace = spaceSession(spaceID: spaces[1].id, title: "Hidden")
      let host = TerminalHostState.test(spaceID: spaces[0].id)

      #expect(
        host.restore(
          from: TerminalWindowSession(
            displayedSpaceID: spaces[0].id,
            spaces: [
              TerminalSpaceSession(spaceID: spaces[0].id, selectedTabID: nil, tabs: []),
              hiddenSpace,
            ]
          )
        )
      )
      #expect(host.spaceManager.tabs(in: spaces[0].id).count == 1)
      #expect(host.spaceManager.instance(for: spaces[1].id)?.pendingSession == hiddenSpace)
      #expect(host.restorationSnapshot().spaces.last == hiddenSpace)
    }
  }

  private func wrappingZmxClient(
    killSession: @escaping @Sendable (UUID) async -> Void = { _ in }
  ) -> ZmxClient {
    ZmxClient(
      executableURL: { URL(fileURLWithPath: "/tmp/zmx") },
      isBundled: { true },
      killSession: killSession,
      listSessions: { [] }
    )
  }

  private func spaceSession(
    spaceID: TerminalSpaceID,
    title: String,
    projectID: TerminalProjectID? = nil,
    isPinned: Bool = false,
    surfaceID: UUID = UUID(),
    workingDirectoryPath: String? = nil,
    restoreMode: TerminalPaneRestoreMode = .shell,
    collapsedProjectIDs: [TerminalProjectID] = []
  ) -> TerminalSpaceSession {
    let tabID = TerminalTabID()
    return TerminalSpaceSession(
      spaceID: spaceID,
      selectedTabID: tabID,
      collapsedProjectIDs: collapsedProjectIDs,
      tabs: [
        TerminalTabSession(
          id: tabID,
          projectID: projectID,
          isPinned: isPinned,
          lockedTitle: title,
          focusedPaneIndex: 0,
          root: .leaf(
            TerminalPaneLeafSession(
              id: surfaceID,
              workingDirectoryPath: workingDirectoryPath,
              restoreMode: restoreMode
            )
          )
        )
      ]
    )
  }
}
