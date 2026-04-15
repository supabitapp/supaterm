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
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
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

    let snapshot = commandExecutor.debugSnapshot(.init())
    #expect(snapshot.update.canCheckForUpdates)
    #expect(snapshot.update.phase == "checking")
    #expect(snapshot.update.detail == "Please wait while Supaterm checks for available updates.")
  }

  @Test
  func closeTabClosesWindowWhenTargetIsTheLastTab() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
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

    _ = try commandExecutor.closeTab(.tab(windowIndex: 1, spaceIndex: 1, tabIndex: 1))
    #expect(closeWindowCount == 1)
  }

  @Test
  func closePaneClosesWindowWhenTargetIsTheLastPane() throws {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let commandExecutor = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
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

    _ = try commandExecutor.closePane(.pane(windowIndex: 1, spaceIndex: 1, tabIndex: 1, paneIndex: 1))
    #expect(closeWindowCount == 1)
  }
  @Test
  func createTabUsesSelectedTabAsInsertionAnchorForExplicitSpaceTarget() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.newTabPosition = .current
      }

      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
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
        .init(
          initialInput: nil,
          cwd: nil,
          focus: false,
          target: .space(windowIndex: 1, spaceIndex: 1)
        )
      )

      #expect(result.tabIndex == 2)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [firstTabID.rawValue, result.tabID, secondTabID.rawValue]
      )
      #expect(host.selectedTabID == firstTabID)
    }
  }
  @Test
  func createTabUsesContextPaneTabAsInsertionAnchor() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.newTabPosition = .current
      }

      let registry = TerminalWindowRegistry()
      let commandExecutor = makeCommandExecutor(registry: registry)
      let host = TerminalHostState()
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
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
        .init(
          initialInput: nil,
          cwd: nil,
          focus: false,
          target: .contextPane(firstPaneID)
        )
      )

      #expect(result.tabIndex == 2)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [firstTabID.rawValue, result.tabID, secondTabID.rawValue]
      )
      #expect(host.selectedTabID == secondTabID)
    }
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
        == .init(
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
        == .init(
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
        == .init(
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
      host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      let firstTabID = try #require(host.selectedTabID)
      host.handleCommand(.createTab(inheritingFromSurfaceID: nil))
      let secondTabID = try #require(host.selectedTabID)
      let secondPaneID = try #require(host.selectedSurfaceView?.id)

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

      let pinned = try commandExecutor.pinTab(.contextPane(secondPaneID))
      #expect(pinned.isPinned)
      #expect(pinned.target.tabID == secondTabID.rawValue)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [secondTabID.rawValue, firstTabID.rawValue]
      )

      let unpinned = try commandExecutor.unpinTab(.contextPane(secondPaneID))
      #expect(!unpinned.isPinned)
      #expect(unpinned.target.tabID == secondTabID.rawValue)
      #expect(
        host.spaceManager.tabs(in: host.spaces[0].id).map(\.id.rawValue)
          == [firstTabID.rawValue, secondTabID.rawValue]
      )
    }
  }
}
