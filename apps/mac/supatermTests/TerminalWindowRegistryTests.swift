import AppKit
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
      tabIndex: 2,
      paneIndex: 1
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == .init(
          isFocused: false,
          isSelectedSpace: false,
          isSelectedTab: false,
          windowIndex: 2,
          spaceIndex: 3,
          tabIndex: 2,
          paneIndex: 1
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
      tabIndex: 2,
      paneIndex: 4
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == .init(
          direction: .right,
          isFocused: true,
          isSelectedTab: true,
          windowIndex: 2,
          spaceIndex: 3,
          tabIndex: 2,
          paneIndex: 4
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
      isUnread: true,
      shouldDeliverDesktopNotification: true,
      paneIndex: 4,
      spaceIndex: 3,
      tabIndex: 2,
      windowIndex: 1
    )

    #expect(
      TerminalWindowRegistry.rewrite(result, windowIndex: 2)
        == .init(
          isUnread: true,
          shouldDeliverDesktopNotification: true,
          paneIndex: 4,
          spaceIndex: 3,
          tabIndex: 2,
          windowIndex: 2
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

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.claudeActivity(for: harness.tabID) == .needsInput)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudePreToolUseMarksTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.claudeActivity(for: harness.tabID) == .running)
  }

  @Test
  func claudeNotificationUsesStoredPendingQuestionForGenericMessage() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(
      harness.host.latestNotificationText(for: harness.tabID)
        == "Which storage strategy should the plan lock in for sp claude-hook?\n[File-backed] [App memory]"
    )
  }

  @Test
  func claudeUserPromptSubmitClearsPendingQuestion() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit)
    )
    #expect(harness.host.claudeActivity(for: harness.tabID) == .running)
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeStopClearsPendingQuestion() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )
    #expect(harness.host.claudeActivity(for: harness.tabID) == nil)
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }

  @Test
  func claudeSessionEndRemovesStoredSessionRouting() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionEnd)
    )
    #expect(harness.host.claudeActivity(for: harness.tabID) == nil)
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func staleStoredClaudeSessionIsClearedAfterContextPaneDisappears() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    harness.registry.unregister(windowControllerID: harness.windowControllerID)
    _ = try harness.registry.handleClaudeHook(
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
    _ = try harness.registry.handleClaudeHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
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

  private func makeClaudeHookHarness() throws -> ClaudeHookHarness {
    initializeGhosttyForTests()

    let registry = TerminalWindowRegistry()
    let host = TerminalHostState()
    host.windowActivity = .init(isKeyWindow: true, isVisible: true)
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
    host.handleCommand(.ensureInitialTab(focusing: false))

    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let tabID = try #require(host.selectedTabID)
    return .init(
      context: .init(surfaceID: surfaceID, tabID: tabID.rawValue),
      host: host,
      registry: registry,
      store: store,
      tabID: tabID,
      windowControllerID: windowControllerID
    )
  }

  private struct ClaudeHookHarness {
    let context: SupatermCLIContext
    let host: TerminalHostState
    let registry: TerminalWindowRegistry
    let store: StoreOf<AppFeature>
    let tabID: TerminalTabID
    let windowControllerID: UUID
  }
}
