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
      let tabID = tabManager.createTab(title: "Terminal 1")
      tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      #expect(
        registry.commandAvailability()
          == TerminalWindowRegistry.CommandAvailability(
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
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true))
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

    #expect(registry.bypassesQuitConfirmation)
  }

  @Test
  func menuContextShowsRestartToUpdateWhenInstallIsPending() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true))
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

    let context = registry.menuContext()
    #expect(context.updateMenuItemText == "Restart to Update...")
    #expect(context.isUpdateMenuItemEnabled)
  }
  @Test
  func menuContextShowsRestartToUpdateWhenRestartIsDeferred() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    var state = AppFeature.State()
    state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true, showsPrompt: false))
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
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    #expect(registry.requestUpdateMenuActionInKeyWindow())
    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.checkForUpdates])
  }
  @Test
  func requestUpdateMenuActionInKeyWindowDispatchesRestartNowWhenInstallIsPending() async {
    let registry = TerminalWindowRegistry()
    let recorder = UpdateMenuActionRecorder()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    var state = AppFeature.State()
    state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true))
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
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    #expect(registry.requestUpdateMenuActionInKeyWindow())
    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.restartNow])
  }

  @Test
  func commandPaletteSnapshotUsesRequestedWindowID() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let firstHost = try makeCommandPaletteHost(title: "alpha", workingDirectory: nil)
      var secondState = AppFeature.State()
      secondState.update.phase = .permissionRequest
      let secondHost = try makeCommandPaletteHost(title: "beta", workingDirectory: nil)
      let firstStore = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let secondStore = Store(initialState: secondState) {
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
      let firstWindow = makeWindow()
      registry.updateWindow(firstWindow, for: firstWindowControllerID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: secondWindowControllerID,
        store: secondStore,
        terminal: secondHost,
        requestConfirmedWindowClose: {}
      )
      let secondWindow = makeWindow()
      registry.updateWindow(secondWindow, for: secondWindowControllerID)

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(secondWindow))

      #expect(snapshot.selectedTabID == secondHost.selectedTabID)
      #expect(snapshot.updateEntries.map(\.title) == ["Not Now", "Allow"])
    }
  }

  @Test
  func commandPaletteSnapshotAggregatesFocusTargetsAcrossWindows() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let firstHost = try makeCommandPaletteHost(title: "ping 1.1.1.1", workingDirectory: "/tmp/one")
      let secondHost = try makeCommandPaletteHost(title: "tail -f app.log", workingDirectory: "/tmp/two")
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
      let firstWindow = makeWindow()
      registry.updateWindow(firstWindow, for: firstWindowControllerID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: secondWindowControllerID,
        store: secondStore,
        terminal: secondHost,
        requestConfirmedWindowClose: {}
      )
      let secondWindow = makeWindow()
      registry.updateWindow(secondWindow, for: secondWindowControllerID)

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(firstWindow))

      #expect(snapshot.focusTargets.map(\.title).contains("ping 1.1.1.1"))
      #expect(snapshot.focusTargets.map(\.title).contains("tail -f app.log"))
    }
  }

  @Test
  func commandPaletteSnapshotBuildsUpdateEntriesFromPhaseActions() {
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    var state = AppFeature.State()
    state.update.phase = .updateAvailable(UpdatePhase.Available(contentLength: 42, releaseDate: nil, version: "1.2.3"))
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

    let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(window))

    #expect(snapshot.updateEntries.map(\.title) == ["Skip", "Install after next restart", "Install and Relaunch"])
    #expect(snapshot.updateEntries.map(\.action) == [.skipVersion, .installAfterNextRestart, .install])
    #expect(snapshot.updateEntries.last?.badge == "1.2.3")
  }

  @Test
  func commandPaletteSnapshotBuildsCheckForUpdatesEntryWhenIdle() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "alpha", workingDirectory: nil)
      var state = AppFeature.State()
      state.update.canCheckForUpdates = true
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

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(window))

      #expect(snapshot.updateEntries.map(\.title) == ["Check for Updates..."])
      #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "check_for_updates" }))
    }
  }

  @Test
  func commandPaletteSnapshotBuildsRestartActionsWhenAutoInstallIsPending() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "alpha", workingDirectory: nil)
      var state = AppFeature.State()
      state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true))
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

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(window))

      #expect(snapshot.updateEntries.map(\.title) == ["Restart Later", "Restart Now"])
      #expect(snapshot.updateEntries.map(\.action) == [.restartLater, .restartNow])
      #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "check_for_updates" }))
    }
  }

  @Test
  func commandPaletteSnapshotBuildsRestartActionsWhenPromptIsShown() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "alpha", workingDirectory: nil)
      var state = AppFeature.State()
      state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: false))
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

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(window))

      #expect(snapshot.updateEntries.map(\.title) == ["Restart Later", "Restart Now"])
      #expect(snapshot.updateEntries.map(\.action) == [.restartLater, .restartNow])
      #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "check_for_updates" }))
    }
  }

  @Test
  func commandPaletteSnapshotBuildsRestartToUpdateEntryWhenRestartIsDeferred() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "alpha", workingDirectory: nil)
      var state = AppFeature.State()
      state.update.phase = .installing(UpdatePhase.Installing(isAutoUpdate: true, showsPrompt: false))
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

      let snapshot = registry.commandPaletteSnapshot(windowID: ObjectIdentifier(window))

      #expect(snapshot.updateEntries.map(\.title) == ["Restart to Update..."])
      #expect(snapshot.updateEntries.first?.action == .restartNow)
      #expect(!snapshot.ghosttyCommands.contains(where: { $0.actionKey == "check_for_updates" }))
    }
  }

  @Test
  func focusCommandPalettePaneFocusesTheRequestedPane() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "ping 1.1.1.1", workingDirectory: "/tmp/network")
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      let selectedSurfaceID = try #require(host.selectedSurfaceView?.id)

      _ = try host.createPane(
        TerminalCreatePaneRequest(
          startupCommand: nil,
          direction: .right,
          focus: false,
          equalize: false,
          target: .pane(selectedSurfaceID)
        )
      )

      let tabID = try #require(host.selectedTabID)
      let targetSurface = try #require(host.trees[tabID]?.leaves().last)
      targetSurface.bridge.state.title = "tail -f app.log"
      targetSurface.bridge.state.pwd = "/tmp/logs"

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      let target = try #require(host.commandPaletteFocusTargets(windowControllerID: windowControllerID).last)
      #expect(host.selectedSurfaceView?.id != target.surfaceID)

      await registry.focusCommandPalettePane(target)

      #expect(host.selectedSurfaceView?.id == target.surfaceID)
    }
  }

  @Test
  func focusNotificationSurfaceSelectsOwningTabAndPane() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = TerminalHostState()
      host.windowActivity = .inactive
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let firstTabID = try #require(host.selectedTabID)
      let secondTabID = try #require(host.createTab(focusing: false))
      let targetSurfaceID = try #require(host.trees[secondTabID]?.root?.leftmostLeaf().id)
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

      #expect(host.selectedTabID == firstTabID)

      #expect(registry.focusNotificationSurface(targetSurfaceID))

      #expect(host.selectedTabID == secondTabID)
      #expect(host.selectedSurfaceView?.id == targetSurfaceID)
      #expect(host.windowActivity == WindowActivityState(isKeyWindow: true, isVisible: true))
    }
  }

  @Test
  func performCommandPaletteUpdateActionDispatchesToRequestedStore() async {
    let registry = TerminalWindowRegistry()
    let recorder = UpdateMenuActionRecorder()
    let host = TerminalHostState(managesTerminalSurfaces: false)
    var state = AppFeature.State()
    state.update.phase = .permissionRequest
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
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    await registry.performCommandPaletteUpdateAction(
      .allowAutomaticChecks,
      windowID: ObjectIdentifier(window)
    )

    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.allowAutomaticChecks])
  }

  @Test
  func restorationSnapshotPreservesActiveWindowOrder() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let firstFrame = NSRect(x: 40, y: 80, width: 1_100, height: 740)
      let secondFrame = NSRect(x: 160, y: 220, width: 1_180, height: 760)
      let registry = TerminalWindowRegistry()
      let firstHost = TerminalHostState()
      firstHost.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))

      let secondHost = TerminalHostState()
      secondHost.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
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
      let firstWindow = makeWindow()
      firstWindow.setFrame(firstFrame, display: false)
      registry.updateWindow(firstWindow, for: firstWindowControllerID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: secondWindowControllerID,
        store: secondStore,
        terminal: secondHost,
        requestConfirmedWindowClose: {}
      )
      let secondWindow = makeWindow()
      secondWindow.setFrame(secondFrame, display: false)
      registry.updateWindow(secondWindow, for: secondWindowControllerID)

      let snapshot = registry.restorationSnapshot()

      #expect(snapshot.windows.count == 2)
      #expect(snapshot.windows[0].frame == TerminalWindowFrame(firstFrame))
      #expect(snapshot.windows[0].spaces.first?.tabs.count == 1)
      #expect(snapshot.windows[1].frame == TerminalWindowFrame(secondFrame))
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
      let tabID = tabManager.createTab(title: "Terminal 1")
      tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      registry.requestNewTabInKeyWindow()
      await flushEffects()

      #expect(recorder.commands == [.createTab(inheritingFromSurfaceID: nil)])
    }
  }
  @Test
  func requestNewTabInSelectedGroupDispatchesReducerCommand() async throws {
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
      let tabID = tabManager.createTab(title: "Terminal 1")
      let groupID = try #require(
        tabManager.createGroup(title: "Group", containing: [tabID])
      ).groupID
      tabManager.selectTab(tabID)

      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      #expect(registry.menuContext().hasSelectedGroup)
      registry.requestNewTabInSelectedGroupInKeyWindow()
      await flushEffects()

      #expect(
        recorder.commands
          == [.createTabInGroup(groupID, inheritingFromSurfaceID: nil)]
      )
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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      registry.requestToggleCommandPaletteInKeyWindow()
      await flushEffects()

      #expect(store.terminal.commandPalette != nil)
    }
  }

  @Test
  func requestToggleAgentPanelInKeyWindowTogglesSelectedPanel() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "codex", workingDirectory: nil)
      let surfaceID = try #require(host.selectedSurfaceView?.id)
      #expect(
        host.applyTestAgentActivity(
          .codex(.running),
          for: surfaceID,
          sessionID: "session-1",
          processID: nil
        )
      )
      host.setTestAgentProgressRows(
        progressRows: [
          PaneAgentProgressRow(id: "run-tests", title: "Run tests", status: .running)
        ],
        for: surfaceID
      )
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

      registry.requestToggleAgentPanelInKeyWindow()

      #expect(store.terminal.hiddenAgentPanelSurfaceIDs == [surfaceID])

      registry.requestToggleAgentPanelInKeyWindow()

      #expect(store.terminal.hiddenAgentPanelSurfaceIDs.isEmpty)
    }
  }

  @Test
  func requestToggleAgentPanelInKeyWindowIgnoresPanesWithoutPanel() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "codex", workingDirectory: nil)
      let surfaceID = try #require(host.selectedSurfaceView?.id)
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

      registry.requestToggleAgentPanelInKeyWindow()

      #expect(!store.terminal.hiddenAgentPanelSurfaceIDs.contains(surfaceID))
    }
  }

  @Test
  func requestCopyAgentPanelSessionIDInKeyWindowCopiesSelectedSession() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "codex", workingDirectory: nil)
      let surfaceID = try #require(host.selectedSurfaceView?.id)
      #expect(
        host.makeTestAgentSessionActionable(
          agent: .codex,
          for: surfaceID,
          sessionID: "session-1",
          processID: nil
        )
      )
      var copiedSessionIDs: [String] = []
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.clipboardClient.copyString = { sessionID in
          copiedSessionIDs.append(sessionID)
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

      registry.requestCopyAgentPanelSessionIDInKeyWindow()
      await flushEffects()

      #expect(copiedSessionIDs == ["session-1"])
    }
  }

  @Test
  func requestForkAgentPanelSessionInKeyWindowForksSelectedSession() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "codex", workingDirectory: nil)
      let surfaceID = try #require(host.selectedSurfaceView?.id)
      #expect(
        host.makeTestAgentSessionActionable(
          agent: .codex,
          for: surfaceID,
          sessionID: "session-1",
          processID: nil,
          workingDirectoryPath: "/tmp/agent-workspace"
        )
      )
      var requests: [TerminalCreatePaneRequest] = []
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.terminalClient.createPane = { request in
          requests.append(request)
          return SupatermNewPaneResult(
            direction: request.direction,
            isFocused: true,
            isSelectedTab: true,
            windowIndex: 1,
            spaceIndex: 1,
            spaceID: UUID(),
            tabIndex: 1,
            tabID: UUID(),
            paneIndex: 2,
            paneID: UUID()
          )
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

      registry.requestForkAgentPanelSessionInKeyWindow(direction: .right)
      let clock = ContinuousClock()
      let deadline = clock.now.advanced(by: .seconds(1))
      while requests.isEmpty && clock.now < deadline {
        await Task.yield()
      }

      #expect(
        requests == [
          TerminalCreatePaneRequest(
            startupCommand: SupatermShellCommand.interactiveStartupCommand(
              for: "codex fork session-1"
            ),
            cwd: "/tmp/agent-workspace/",
            direction: .right,
            focus: true,
            equalize: false,
            target: .pane(surfaceID)
          )
        ])
    }
  }

  @Test
  func commandAvailabilityDisablesUnsupportedAgentSessionActions() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let host = try makeCommandPaletteHost(title: "pi", workingDirectory: nil)
      let surfaceID = try #require(host.selectedSurfaceView?.id)
      #expect(
        host.applyTestAgentActivity(
          TerminalHostState.AgentActivity(kind: .pi, phase: .running, detail: nil),
          for: surfaceID,
          sessionID: "session-1",
          processID: nil
        )
      )
      #expect(
        host.setTestAgentProgressRows(
          progressRows: [
            PaneAgentProgressRow(id: "run-tests", title: "Run tests", status: .running)
          ],
          for: surfaceID
        )
      )
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

      let availability = registry.commandAvailability()
      #expect(availability.hasAgentPanel)
      #expect(!availability.hasAgentPanelSession)
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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

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
        TerminalWindowRegistry.CloseAllWindowsCandidate(
          windowID: ObjectIdentifier(confirmWindow),
          needsConfirmation: true),
        TerminalWindowRegistry.CloseAllWindowsCandidate(
          windowID: ObjectIdentifier(secondWindow),
          needsConfirmation: false),
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
        TerminalWindowRegistry.CloseAllWindowsCandidate(
          windowID: ObjectIdentifier(firstWindow),
          needsConfirmation: false),
        TerminalWindowRegistry.CloseAllWindowsCandidate(
          windowID: ObjectIdentifier(secondWindow),
          needsConfirmation: false),
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
}

@MainActor
private func makeCommandPaletteHost(
  title: String,
  workingDirectory: String?
) throws -> TerminalHostState {
  let host = TerminalHostState()
  host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
  host.selectedSurfaceView?.bridge.state.title = title
  host.selectedSurfaceView?.bridge.state.titleOverride = nil
  host.selectedSurfaceView?.bridge.state.pwd = workingDirectory
  return host
}
