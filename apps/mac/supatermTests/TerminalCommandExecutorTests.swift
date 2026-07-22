import AppKit
import Clocks
import ComposableArchitecture
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCommandExecutorTests {
  @Test
  func debugSnapshotUsesUpdatePhaseIdentifierAndDetail() {
    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.canCheckForUpdates = true
    state.update.phase = .checking
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

    firstHost.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    secondHost.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let tabID = try #require(host.selectedTabID)
    host.handleCommand(.togglePinned(tabID))
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let firstTabID = try #require(host.selectedTabID)
    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
    let secondTabID = try #require(host.selectedTabID)
    host.handleCommand(.selectTab(firstTabID))

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
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let firstTabID = try #require(host.selectedTabID)
    let firstPaneID = try #require(host.selectedSurfaceView?.id)
    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
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
  func tabTargetSurvivesTopologyReordering() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
    let targetTabID = try #require(host.selectedTabID)
    let request = TerminalRenameTabRequest(
      target: TerminalTabTarget(tabID: targetTabID.rawValue),
      title: "Stable target"
    )
    host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
    let movedTabID = try #require(host.selectedTabID)
    host.handleCommand(.togglePinned(movedTabID))

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
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let firstTabID = try #require(host.selectedTabID)
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
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
  func groupedChildUnpinIsNoOpAndPinExtractsToPinnedRoot() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let firstTabID = try #require(host.selectedTabID)
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let groupedTabID = try #require(host.selectedTabID)
      let groupID = try #require(
        host.createGroup(title: "Group", containing: [firstTabID, groupedTabID])
      ).groupID

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

      let unpinned = try commandExecutor.unpinTab(TerminalTabTarget(tabID: groupedTabID.rawValue))

      #expect(!unpinned.isPinned)
      #expect(host.spaceManager.activeTabManager?.rootItemID(containing: groupedTabID) == .group(groupID))
      #expect(host.spaceManager.activeTabManager?.tabIDs(in: groupID) == [firstTabID, groupedTabID])

      let pinned = try commandExecutor.pinTab(TerminalTabTarget(tabID: groupedTabID.rawValue))

      #expect(pinned.isPinned)
      #expect(host.spaceManager.activeTabManager?.rootItemID(containing: groupedTabID) == .tab(groupedTabID))
      #expect(host.spaceManager.activeTabManager?.pinnedRootItems.map(\.id) == [.tab(groupedTabID)])
      #expect(host.spaceManager.activeTabManager?.tabIDs(in: groupID) == [firstTabID])
    }
  }
}
