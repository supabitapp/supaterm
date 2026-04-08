import AppKit
import Clocks
import ComposableArchitecture
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalWindowRegistryTests {
  @Test
  func commandAvailabilityReflectsSelectedTabInActiveWindow() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()

      let tabManager = try #require(host.spaceManager.activeTabManager)
      let tabID = tabManager.createTab(title: "Terminal 1", icon: "terminal")
      tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      registry.updateWindow(makeWindow(), for: windowControllerID)

      #expect(
        registry.commandAvailability()
          == .init(
            hasWindow: true,
            hasTab: true,
            hasSurface: false
          )
      )
    }
  }

  @Test
  func bypassesQuitConfirmationReflectsInstallingUpdatePhase() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(.init(isAutoUpdate: true))
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
    registry.updateWindow(makeWindow(), for: windowControllerID)

    #expect(registry.bypassesQuitConfirmation)
  }

  @Test
  func debugSnapshotUsesUpdatePhaseIdentifierAndDetail() {
    let registry = TerminalWindowRegistry()
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
    registry.updateWindow(makeWindow(), for: windowControllerID)

    let snapshot = registry.debugSnapshot(.init())
    #expect(snapshot.update.canCheckForUpdates)
    #expect(snapshot.update.phase == "checking")
    #expect(snapshot.update.detail == "Please wait while Supaterm checks for available updates.")
  }

  @Test
  func menuContextShowsRestartToUpdateWhenInstallIsPending() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(.init(isAutoUpdate: true))
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
    registry.updateWindow(makeWindow(), for: windowControllerID)

    let context = registry.menuContext()
    #expect(context.updateMenuItemText == "Restart to Update...")
    #expect(context.isUpdateMenuItemEnabled)
  }

  @Test
  func menuContextShowsRestartToUpdateWhenRestartIsDeferred() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(.init(isAutoUpdate: true, showsPrompt: false))
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
    registry.updateWindow(makeWindow(), for: windowControllerID)

    let context = registry.menuContext()
    #expect(context.updateMenuItemText == "Restart to Update...")
    #expect(context.isUpdateMenuItemEnabled)
  }

  @Test
  func requestUpdateMenuActionInKeyWindowDispatchesCheckForUpdatesWhenEnabled() async {
    let registry = TerminalWindowRegistry()
    let recorder = UpdateMenuActionRecorder()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    var state = AppFeature.State()
    state.update.canCheckForUpdates = true
    let store = Store(initialState: state) {
      AppFeature()
    } withDependencies: {
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
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

    #expect(registry.requestUpdateMenuActionInKeyWindow())
    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.checkForUpdates])
  }

  @Test
  func requestUpdateMenuActionInKeyWindowDispatchesRestartNowWhenInstallIsPending() async {
    let registry = TerminalWindowRegistry()
    let recorder = UpdateMenuActionRecorder()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    var state = AppFeature.State()
    state.update.phase = .installing(.init(isAutoUpdate: true))
    let store = Store(initialState: state) {
      AppFeature()
    } withDependencies: {
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
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

    #expect(registry.requestUpdateMenuActionInKeyWindow())
    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.restartNow])
  }

  @Test
  func restorationSnapshotPreservesActiveWindowOrder() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let firstHost = TerminalHostState()
      firstHost.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

      let secondHost = TerminalHostState()
      secondHost.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))
      secondHost.handleCommand(.createTab(inheritingFromSurfaceID: nil))

      let firstStore = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let secondStore = Store(initialState: AppFeature.State()) {
        AppFeature()
      }

      let firstWindowControllerID = UUID()
      let secondWindowControllerID = UUID()

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

      let snapshot = registry.restorationSnapshot()

      #expect(snapshot.windows.count == 2)
      #expect(snapshot.windows[0].spaces.first?.tabs.count == 1)
      #expect(snapshot.windows[1].spaces.first?.tabs.count == 2)
    }
  }

  @Test
  func requestCloseTabInKeyWindowDispatchesReducerCommand() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
      }
      let windowControllerID = UUID()

      let tabManager = try #require(host.spaceManager.activeTabManager)
      let tabID = tabManager.createTab(title: "Terminal 1", icon: "terminal")
      tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      registry.updateWindow(makeWindow(), for: windowControllerID)

      registry.requestCloseTabInKeyWindow()
      await flushEffects()

      #expect(recorder.commands == [.requestCloseTab(tabID)])
    }
  }

  @Test
  func requestNewTabInKeyWindowDispatchesReducerCommand() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
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

      registry.requestNewTabInKeyWindow()
      await flushEffects()

      #expect(recorder.commands == [.createTab(inheritingFromSurfaceID: nil)])
    }
  }

  @Test
  func requestBindingActionInKeyWindowDispatchesReducerCommand() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
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

      registry.requestBindingActionInKeyWindow(.newSplit(.left))
      await flushEffects()

      #expect(recorder.commands == [.performBindingActionOnFocusedSurface(.newSplit(.left))])
    }
  }

  @Test
  func requestToggleCommandPaletteInKeyWindowDispatchesReducerCommand() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
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

      registry.requestToggleCommandPaletteInKeyWindow()
      await flushEffects()

      #expect(store.withState(\.terminal.commandPalette) != nil)
    }
  }

  @Test
  func requestNavigateSearchInKeyWindowDispatchesReducerCommand() async {
    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let recorder = TerminalCommandRecorder()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.send = { recorder.record($0) }
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

      registry.requestNavigateSearchInKeyWindow(.previous)
      await flushEffects()

      #expect(recorder.commands == [.navigateSearch(.previous)])
    }
  }

  @Test
  func closeAllWindowsPlanRequestsConfirmationOnce() {
    let confirmWindow = makeWindow()
    let secondWindow = makeWindow()

    let plan = TerminalWindowRegistry.closeAllWindowsPlan(
      for: [
        .init(windowID: ObjectIdentifier(confirmWindow), needsConfirmation: true),
        .init(windowID: ObjectIdentifier(secondWindow), needsConfirmation: false),
      ]
    )

    switch plan {
    case .confirm(let windowIDs):
      #expect(windowIDs.count == 2)
      #expect(windowIDs[0] == ObjectIdentifier(confirmWindow))
      #expect(windowIDs[1] == ObjectIdentifier(secondWindow))
    default:
      Issue.record("Expected confirm plan")
    }
  }

  @Test
  func closeAllWindowsPlanClosesImmediatelyWhenNoWindowNeedsConfirmation() {
    let firstWindow = makeWindow()
    let secondWindow = makeWindow()

    let plan = TerminalWindowRegistry.closeAllWindowsPlan(
      for: [
        .init(windowID: ObjectIdentifier(firstWindow), needsConfirmation: false),
        .init(windowID: ObjectIdentifier(secondWindow), needsConfirmation: false),
      ]
    )

    switch plan {
    case .closeImmediately(let windowIDs):
      #expect(windowIDs.count == 2)
      #expect(windowIDs[0] == ObjectIdentifier(firstWindow))
      #expect(windowIDs[1] == ObjectIdentifier(secondWindow))
    default:
      Issue.record("Expected immediate close plan")
    }
  }

  @Test
  func closeAllWindowsPlanReturnsNoWindowsWhenEmpty() {
    let plan = TerminalWindowRegistry.closeAllWindowsPlan(for: [])

    switch plan {
    case .noWindows:
      break
    default:
      Issue.record("Expected no windows plan")
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
  func claudeNotificationUsesStoredSessionSurfaceWhenAmbientContextIsMissing() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.needsInput))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeSessionStartDoesNotMarkTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
  }

  @Test
  func claudePreToolUseMarksTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))
  }

  @Test
  func commandFinishedClearsAgentActivityAndStoredSessionRouting() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func claudeNotificationUsesGenericMessage() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeNotificationDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(
      result.desktopNotification
        == .init(
          body: "Claude needs your attention",
          subtitle: "Needs input",
          title: "Claude Code"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.needsInput))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func terminalDesktopNotificationIsSuppressedAfterMatchingClaudeHookNotification() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Needs input", "Claude needs your attention")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeUserPromptSubmitReturnsTabToRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeStopMarksTabIdle() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func claudeStopDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(
      result.desktopNotification
        == .init(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Claude Code"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func claudeSessionEndRemovesStoredSessionRouting() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionEnd)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func staleStoredClaudeSessionIsClearedAfterContextPaneDisappears() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    harness.registry.unregister(windowControllerID: harness.windowControllerID)
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )
    harness.registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: harness.windowControllerID,
      store: harness.store,
      terminal: harness.host,
      requestConfirmedWindowClose: {}
    )
    harness.registry.updateWindow(makeWindow(), for: harness.windowControllerID)
    _ = try harness.registry.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func codexPreToolUseAndStopUpdateCodexActivity() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))

    let result = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func codexPostToolUseMarksTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.postToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))
  }

  @Test
  func codexTranscriptResponseItemsReplaceHookFallbackDetail() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.preToolUse,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))

    try CodexTranscriptFixtures.append(
      .localShellCall(command: ["git", "status", "--short"]),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Bash · git status --short")
    )

    try CodexTranscriptFixtures.append(
      .assistantMessage("Updating the registry and sidebar"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Updating the registry and sidebar")
    )

    try CodexTranscriptFixtures.append(
      .assistantMessage(
        "Final answer should stay out of the running subtitle",
        phase: "final_answer"
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Updating the registry and sidebar")
    )

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1", lastAgentMessage: "Done."),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
  }

  @Test
  func codexTranscriptBatchPrefersAssistantMessageOverExecCommand() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.preToolUse,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "sed -n '1,40p' docs/coding-agents-integration.md"
        ]
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )
  }

  @Test
  func codexTranscriptDoesNotDemoteAssistantMessageToThinkingAcrossPolls() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.userPromptSubmit,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Thinking"))

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )

    try CodexTranscriptFixtures.append(
      .reasoning("Planning the next step"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )
  }

  @Test
  func codexTranscriptUsesExecCommandCmdForRunningDetail() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.preToolUse,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "git status --short"
        ]
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "git status --short")
    )
  }

  @Test
  func codexTranscriptEventFallbackUpdatesDetailAndAbortedTurnClearsRunning() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.userPromptSubmit,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Thinking"))

    try CodexTranscriptFixtures.append(
      .agentReasoning("Inspecting transcript activity"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Thinking...")
    )

    try CodexTranscriptFixtures.append(
      .agentMessage("Need approval?", phase: "commentary"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Need approval?")
    )

    try CodexTranscriptFixtures.append(
      .turnAborted(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
  }

  @Test
  func codexStopDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(
      result.desktopNotification
        == .init(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Codex"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func codexStopKeepsStructuredCompletionWhenTerminalFallbackArrives() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Codex", "Agent turn complete")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }

  @Test
  func codexUserPromptSubmitClearsStructuredCompletionSuppression() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.userPromptSubmit)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Codex", "Agent turn complete")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Agent turn complete")
  }

  @Test
  func codexTranscriptKeepsRunningUntilTranscriptCompletes() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-0"),
      to: transcriptPath
    )

    _ = try harness.registry.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.registry.handleAgentHook(
      codexHook(CodexHookFixtures.userPromptSubmit, transcriptPath: transcriptPath)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Thinking"))

    await flushEffects()

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Thinking"))

    try CodexTranscriptFixtures.append(
      .taskStarted(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Thinking"))

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
  }

  @Test
  func stopWithoutAssistantMessageOnlyMarksTabIdle() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.registry.handleAgentHook(
      .init(
        agent: .codex,
        event: .init(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .stop,
          lastAssistantMessage: "   ",
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID).isEmpty)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  private func makeWindow() -> NSWindow {
    NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
  }

  private func flushEffects() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }

  private func waitForUpdateMenuActions(
    _ recorder: UpdateMenuActionRecorder,
    count: Int,
    timeout: Duration = .seconds(1)
  ) async -> [UpdateUserAction] {
    let clock = ContinuousClock()
    let deadline = clock.now.advanced(by: timeout)
    while clock.now < deadline {
      let actions = await recorder.actions()
      if actions.count >= count {
        return actions
      }
      await Task.yield()
    }
    return await recorder.actions()
  }

  private func advanceClock(
    _ clock: TestClock<Duration>,
    by duration: Duration = .seconds(1)
  ) async {
    await flushEffects()
    await clock.advance(by: duration)
    await flushEffects()
  }

  private func codexHook(
    _ json: String,
    transcriptPath: URL,
    context: SupatermCLIContext? = nil
  ) throws -> SupatermAgentHookRequest {
    try CodexHookFixtures.request(
      CodexHookFixtures.replacingTranscriptPath(in: json, with: transcriptPath.path),
      context: context
    )
  }

  private func makeClaudeHookHarness<C: Clock<Duration>>(
    agentRunningTimeout: Duration = .seconds(15),
    transcriptPollInterval: Duration = .seconds(1),
    clock: C = ContinuousClock(),
    windowActivity: WindowActivityState = .init(isKeyWindow: true, isVisible: true)
  ) throws -> ClaudeHookHarness {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry(
      agentRunningTimeout: agentRunningTimeout,
      transcriptPollInterval: transcriptPollInterval,
      clock: clock
    )
    let host = TerminalHostState()
    host.windowActivity = windowActivity
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
    host.handleCommand(.ensureInitialTab(focusing: false, startupInput: nil))

    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let tabID = try #require(host.selectedTabID)
    return .init(
      context: .init(surfaceID: surfaceID, tabID: tabID.rawValue),
      host: host,
      registry: registry,
      store: store,
      tabID: tabID,
      window: window,
      windowControllerID: windowControllerID
    )
  }

  private struct ClaudeHookHarness {
    let context: SupatermCLIContext
    let host: TerminalHostState
    let registry: TerminalWindowRegistry
    let store: StoreOf<AppFeature>
    let tabID: TerminalTabID
    let window: NSWindow
    let windowControllerID: UUID
  }
}

private actor UpdateMenuActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}
