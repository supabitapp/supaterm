import AppKit
import Clocks
import ComposableArchitecture
import Sharing
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCommandExecutorTests {
  @Test
  func createSpaceAppendsToTheCatalogAndDisplaysItInTheAmbientWindow() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let initialSpace = TerminalSpaceItem(name: "Initial")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: initialSpace.id,
          spaces: [initialSpace]
        )
      }
      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let keyWindow = registerSpaceCommandWindow(
        in: registry,
        spaceID: initialSpace.id,
        isKey: true
      )
      let otherWindow = registerSpaceCommandWindow(in: registry, spaceID: initialSpace.id)

      let created = try commandExecutor.createSpace(
        TerminalCreateSpaceRequest(
          color: nil,
          name: "Build",
          context: otherWindow.context
        )
      )

      #expect(catalog.spaces.map(\.name) == ["Initial", "Build"])
      #expect(registry.activeEntries().count == 2)
      #expect(created.target.spaceIndex == 2)
      #expect(created.target.name == "Build")
      #expect(created.isSelectedSpace)
      #expect(otherWindow.terminal.displayedSpaceID.rawValue == created.target.spaceID)
      #expect(keyWindow.terminal.displayedSpaceID == initialSpace.id)
      withExtendedLifetime([keyWindow.window, otherWindow.window]) {}
    }
  }

  @Test
  func spaceCommandsSwitchTheAmbientWindowInPlace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let first = registerSpaceCommandWindow(in: registry, spaceID: spaces[0].id)
      var closedSecondWindow = false
      let second = registerSpaceCommandWindow(
        in: registry,
        spaceID: spaces[0].id,
        onClose: { closedSecondWindow = true }
      )

      let renamed = try commandExecutor.renameSpace(
        TerminalRenameSpaceRequest(
          name: "Build",
          target: TerminalSpaceTarget(
            spaceID: spaces[1].id.rawValue,
            context: second.context
          )
        )
      )
      #expect(renamed.name == "Build")
      #expect(renamed.spaceIndex == 2)
      #expect(renamed.windowIndex == 2)
      #expect(catalog.spaces.map(\.name) == ["First", "Build"])

      let selected = try commandExecutor.selectSpace(
        TerminalSpaceTarget(spaceID: spaces[1].id.rawValue, context: second.context)
      )
      #expect(selected.target.spaceID == spaces[1].id.rawValue)
      #expect(second.terminal.displayedSpaceID == spaces[1].id)
      #expect(first.terminal.displayedSpaceID == spaces[0].id)

      let previous = try commandExecutor.previousSpace(
        TerminalSpaceNavigationRequest(context: second.context)
      )
      #expect(previous.target.spaceID == spaces[0].id.rawValue)
      #expect(second.terminal.displayedSpaceID == spaces[0].id)

      let last = try commandExecutor.lastSpace(
        TerminalSpaceNavigationRequest(context: second.context)
      )
      #expect(last.target.spaceID == spaces[1].id.rawValue)

      let next = try commandExecutor.nextSpace(
        TerminalSpaceNavigationRequest(context: second.context)
      )
      #expect(next.target.spaceID == spaces[0].id.rawValue)
      #expect(first.terminal.displayedSpaceID == spaces[0].id)

      let closed = try commandExecutor.closeSpace(
        TerminalSpaceTarget(spaceID: spaces[1].id.rawValue, context: second.context)
      )
      #expect(closed.spaceID == spaces[1].id.rawValue)
      #expect(!closedSecondWindow)
      #expect(registry.activeEntries().count == 2)
      #expect(catalog.spaces.map(\.id) == [spaces[0].id])
      #expect(first.terminal.displayedSpaceID == spaces[0].id)
      #expect(second.terminal.displayedSpaceID == spaces[0].id)
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func treeSnapshotReportsEveryWindowDisplayedSpace() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "First"), TerminalSpaceItem(name: "Second")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let first = registerSpaceCommandWindow(in: registry, spaceID: spaces[0].id)
      let second = registerSpaceCommandWindow(in: registry, spaceID: spaces[1].id)

      let snapshot = commandExecutor.treeSnapshot()

      #expect(snapshot.windows.map(\.displayedSpaceID) == [spaces[0].id.rawValue, spaces[1].id.rawValue])
      for window in snapshot.windows {
        #expect(window.spaces.map(\.index) == [1, 2])
        #expect(window.spaces.map(\.id) == spaces.map(\.id.rawValue))
      }
      #expect(snapshot.windows[0].spaces[0].isWarm)
      #expect(!snapshot.windows[0].spaces[1].isWarm)
      #expect(snapshot.windows[0].spaces[1].tabs.isEmpty)
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func debugSnapshotUsesUpdatePhaseIdentifierAndDetail() {
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    let state = AppFeature.State()
    state.$update.withLock {
      $0.canCheckForUpdates = true
      $0.phase = .checking
    }
    let store = Store(initialState: state) {
      AppFeature()
    }
    let windowControllerID = UUID()

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    let snapshot = commandExecutor.debugSnapshot(SupatermDebugRequest())
    #expect(snapshot.update.canCheckForUpdates)
    #expect(snapshot.update.phase == "checking")
    #expect(snapshot.update.detail == "Please wait while Supaterm checks for available updates.")
  }

  @Test
  func paneHealthContextTargetSkipsMissingWindowsAndRewritesWindowIndex() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let firstHost = TerminalHostState()
    let secondHost = TerminalHostState()
    let firstStore = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let secondStore = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let firstWindowControllerID = UUID()
    let secondWindowControllerID = UUID()

    firstHost.ensureInitialTab(focusing: false, startupCommand: nil)
    secondHost.ensureInitialTab(focusing: false, startupCommand: nil)
    let secondSurfaceID = try #require(secondHost.selectedSurfaceView?.id)

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: firstWindowControllerID,
      store: firstStore,
      terminal: firstHost,
      requestConfirmedWindowClose: {}
    )
    registry.updateWindow(makeWindow(), for: firstWindowControllerID)
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: secondWindowControllerID,
      store: secondStore,
      terminal: secondHost,
      requestConfirmedWindowClose: {}
    )
    registry.updateWindow(makeWindow(), for: secondWindowControllerID)

    let result = try commandExecutor.paneHealth(
      TerminalPaneHealthRequest(target: TerminalPaneTarget(paneID: secondSurfaceID))
    )

    #expect(result.target.windowIndex == 2)
    #expect(result.target.paneID == secondSurfaceID)
  }

  @Test
  func closeTabClosesWindowWhenTargetIsTheLastTab() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let tabID = try #require(host.selectedTabID)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()
    var closeWindowCount = 0

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: { closeWindowCount += 1 }
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    _ = try commandExecutor.closeTab(TerminalTabTarget(tabID: tabID.rawValue))
    #expect(closeWindowCount == 1)
  }

  @Test
  func closeTabClosesWindowWhenPinnedTargetIsTheLastTab() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let tabID = try #require(host.selectedTabID)
    host.togglePinned(tabID)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()
    var closeWindowCount = 0

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: { closeWindowCount += 1 }
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    _ = try commandExecutor.closeTab(TerminalTabTarget(tabID: tabID.rawValue))

    #expect(closeWindowCount == 1)
  }

  @Test
  func closePaneClosesWindowWhenTargetIsTheLastPane() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let paneID = try #require(host.selectedSurfaceView?.id)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()
    var closeWindowCount = 0

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: { closeWindowCount += 1 }
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    _ = try commandExecutor.closePane(TerminalPaneTarget(paneID: paneID))
    #expect(closeWindowCount == 1)
  }

  @Test
  func lastPaneRefocusesPreviouslyFocusedPane() throws {
    initializeGhosttyForTests()

    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let tabID = try #require(host.selectedTabID)
    let firstSurface = try #require(host.selectedSurfaceView)
    host.focusSurface(firstSurface, in: tabID)

    _ = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: true,
        equalize: false,
        target: .pane(firstSurface.id)
      )
    )
    #expect(host.focusHistoryByTab[tabID]?.current != firstSurface.id)
    #expect(host.focusHistoryByTab[tabID]?.previous == firstSurface.id)

    _ = try host.lastPane(TerminalPaneTarget(paneID: firstSurface.id))

    #expect(host.focusHistoryByTab[tabID]?.current == firstSurface.id)
  }
  @Test
  func createTabAppendsAtEndForExplicitSpaceTarget() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let firstTabID = try #require(host.selectedTabID)
    _ = host.createTab(inheritingFromSurfaceID: nil)
    let secondTabID = try #require(host.selectedTabID)
    host.selectTab(firstTabID)

    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    let result = try commandExecutor.createTab(
      TerminalCreateTabRequest(
        startupCommand: nil,
        cwd: nil,
        focus: false,
        projectID: nil,
        target: .space(host.spaces[0].id.rawValue)
      )
    )

    #expect(result.tabIndex == 3)
    #expect(
      host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
        == [firstTabID.rawValue, secondTabID.rawValue, result.tabID]
    )
    #expect(host.selectedTabID == firstTabID)
  }
  @Test
  func createTabAppendsAtEndForContextPaneTarget() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let firstTabID = try #require(host.selectedTabID)
    let firstPaneID = try #require(host.selectedSurfaceView?.id)
    _ = host.createTab(inheritingFromSurfaceID: nil)
    let secondTabID = try #require(host.selectedTabID)

    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()

    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    let result = try commandExecutor.createTab(
      TerminalCreateTabRequest(
        startupCommand: nil,
        cwd: nil,
        focus: false,
        projectID: nil,
        target: .pane(firstPaneID)
      )
    )

    #expect(result.tabIndex == 3)
    #expect(
      host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
        == [firstTabID.rawValue, secondTabID.rawValue, result.tabID]
    )
    #expect(host.selectedTabID == secondTabID)
  }

  @Test
  func staleContextCannotRetargetTabCreation() throws {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let space = TerminalSpaceItem(name: "Initial")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: space.id, spaces: [space])
      }
      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let first = registerSpaceCommandWindow(in: registry, spaceID: space.id)
      let second = registerSpaceCommandWindow(in: registry, spaceID: space.id, isKey: true)
      let initialCounts = [
        first.terminal.spaceManager.allTabs.count,
        second.terminal.spaceManager.allTabs.count,
      ]

      #expect(throws: (any Error).self) {
        _ = try commandExecutor.createTab(
          TerminalCreateTabRequest(
            startupCommand: nil,
            cwd: nil,
            focus: false,
            projectID: nil,
            target: .space(space.id.rawValue),
            context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
          )
        )
      }

      #expect(
        [
          first.terminal.spaceManager.allTabs.count,
          second.terminal.spaceManager.allTabs.count,
        ] == initialCounts
      )
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func tabTargetSurvivesTopologyReordering() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    _ = host.createTab(inheritingFromSurfaceID: nil)
    let targetTabID = try #require(host.selectedTabID)
    let request = TerminalRenameTabRequest(
      target: TerminalTabTarget(tabID: targetTabID.rawValue),
      title: "Stable target"
    )
    _ = host.createTab(inheritingFromSurfaceID: nil)
    let movedTabID = try #require(host.selectedTabID)
    host.togglePinned(movedTabID)

    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
    }
    let windowControllerID = UUID()
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    registry.updateWindow(makeWindow(), for: windowControllerID)

    let renamed = try commandExecutor.renameTab(request)

    #expect(renamed.target.tabID == targetTabID.rawValue)
    #expect(
      host.spaceManager.tabs(in: host.spaces[0].id)
        .first { $0.id == targetTabID }?.title == "Stable target"
    )
  }
  @Test
  func rewriteNewTabResultPreservesSpaceIndexAndUpdatesWindowIndex() {
    let result = SupatermNewTabResult(
      isFocused: false,
      isSelectedSpace: false,
      isSelectedTab: false,
      windowIndex: 1,
      spaceIndex: 3,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 2,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 1,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == SupatermNewTabResult(
          isFocused: false,
          isSelectedSpace: false,
          isSelectedTab: false,
          windowIndex: 2,
          spaceIndex: 3,
          spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
          tabIndex: 2,
          tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
          paneIndex: 1,
          paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
        )
    )
  }
  @Test
  func rewriteNewPaneResultPreservesSpaceIndexAndUpdatesWindowIndex() {
    let result = SupatermNewPaneResult(
      direction: .right,
      isFocused: true,
      isSelectedTab: true,
      windowIndex: 1,
      spaceIndex: 3,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 2,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == SupatermNewPaneResult(
          direction: .right,
          isFocused: true,
          isSelectedTab: true,
          windowIndex: 2,
          spaceIndex: 3,
          spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
          tabIndex: 2,
          tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
          paneIndex: 4,
          paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
        )
    )
  }
  @Test
  func rewriteCreateTabErrorPreservesSpaceIndexAndUpdatesWindowIndex() {
    let error = TerminalCreateTabError.spaceNotFound(
      windowIndex: 1,
      spaceIndex: 3
    )

    #expect(
      TerminalWindowRegistry.rewrite(error, windowIndex: 2)
        == .spaceNotFound(windowIndex: 2, spaceIndex: 3)
    )
  }
  @Test
  func rewriteNotifyResultPreservesSpaceIndexAndUpdatesWindowIndex() {
    let result = SupatermNotifyResult(
      attentionState: .unread,
      desktopNotificationDisposition: .deliver,
      resolvedTitle: "Deploy complete",
      windowIndex: 1,
      spaceIndex: 3,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 2,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == SupatermNotifyResult(
          attentionState: .unread,
          desktopNotificationDisposition: .deliver,
          resolvedTitle: "Deploy complete",
          windowIndex: 2,
          spaceIndex: 3,
          spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
          tabIndex: 2,
          tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
          paneIndex: 4,
          paneID: UUID(uuidString: "8CF762C9-61EB-4E8E-B2B2-A87D0C3FF5B9")!
        )
    )
  }
  @Test
  func rewriteCreatePaneErrorPreservesSpaceIndexAndUpdatesWindowIndex() {
    let error = TerminalCreatePaneError.paneNotFound(
      windowIndex: 1,
      spaceIndex: 3,
      tabIndex: 2,
      paneIndex: 4
    )

    #expect(
      TerminalWindowRegistry.rewrite(error, windowIndex: 2)
        == .paneNotFound(windowIndex: 2, spaceIndex: 3, tabIndex: 2, paneIndex: 4)
    )
  }

  @Test
  func pinAndUnpinTabUpdatePinnedStateAndTabOrder() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let host = TerminalHostState()
      host.ensureInitialTab(focusing: false, startupCommand: nil)
      let firstTabID = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let secondTabID = try #require(host.selectedTabID)

      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      registry.updateWindow(makeWindow(), for: windowControllerID)

      let pinned = try commandExecutor.pinTab(TerminalTabTarget(tabID: secondTabID.rawValue))
      #expect(pinned.isPinned)
      #expect(pinned.target.tabID == secondTabID.rawValue)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [secondTabID.rawValue, firstTabID.rawValue]
      )

      let unpinned = try commandExecutor.unpinTab(TerminalTabTarget(tabID: secondTabID.rawValue))
      #expect(!unpinned.isPinned)
      #expect(unpinned.target.tabID == secondTabID.rawValue)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [firstTabID.rawValue, secondTabID.rawValue]
      )
    }
  }

  @Test
  func projectMembershipSurvivesTabPinAndUnpin() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let host = TerminalHostState()
      host.ensureInitialTab(focusing: false, startupCommand: nil)
      let firstTabID = try #require(host.selectedTabID)
      _ = host.createTab(inheritingFromSurfaceID: nil)
      let projectTabID = try #require(host.selectedTabID)
      let projectID = try #require(
        host.createProject(name: "Project", containing: [firstTabID, projectTabID])
      ).projectID

      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      registry.updateWindow(makeWindow(), for: windowControllerID)

      let unpinned = try commandExecutor.unpinTab(TerminalTabTarget(tabID: projectTabID.rawValue))

      #expect(!unpinned.isPinned)
      #expect(host.spaceManager.tabCollection.tab(for: projectTabID)?.projectID == projectID)

      let pinned = try commandExecutor.pinTab(TerminalTabTarget(tabID: projectTabID.rawValue))

      #expect(pinned.isPinned)
      #expect(host.spaceManager.tabCollection.tab(for: projectTabID)?.projectID == projectID)
      #expect(host.spaceManager.tabCollection.tab(for: projectTabID)?.isPinned == true)
    }
  }
}

@MainActor
private func registerSpaceCommandWindow(
  in registry: TerminalWindowRegistry,
  spaceID: TerminalSpaceID,
  isKey: Bool = false,
  onClose: @escaping @MainActor @Sendable () -> Void = {}
) -> SpaceCommandWindow {
  let host = TerminalHostState(spaceID: spaceID)
  host.ensureInitialTab(focusing: false, startupCommand: nil)
  host.windowActivity = WindowActivityState(isKeyWindow: isKey, isVisible: true)
  let store = Store(initialState: AppFeature.State()) {
    AppFeature()
  }
  let windowControllerID = UUID()
  registry.register(
    keyboardShortcutForAction: { _ in nil },
    windowControllerID: windowControllerID,
    store: store,
    terminal: host,
    requestConfirmedWindowClose: onClose
  )
  let window = makeWindow()
  registry.updateWindow(window, for: windowControllerID)
  return SpaceCommandWindow(
    context: SupatermCLIContext(
      surfaceID: host.selectedSurfaceView!.id,
      tabID: host.selectedTabID!.rawValue
    ),
    terminal: host,
    window: window
  )
}

private struct SpaceCommandWindow {
  let context: SupatermCLIContext
  let terminal: TerminalHostState
  let window: NSWindow
}
