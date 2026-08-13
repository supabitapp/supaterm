import AppKit
import Clocks
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalWindowRegistryTests {
  @Test
  func selectingSpaceWithoutWindowDoesNothing() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()

      #expect(!registry.selectSpace(spaces[1].id))
      #expect(catalog.defaultSelectedSpaceID == spaces[0].id)
    }
  }

  @Test
  func preferredTerminalWindowExcludesUnregisteredWindows() {
    let registry = TerminalWindowRegistry()
    let unrelatedWindow = makeWindow()

    #expect(registry.preferredTerminalWindow == nil)

    let terminalWindow = registerWindow(in: registry, spaceID: TerminalSpaceID())

    #expect(registry.preferredTerminalWindow === terminalWindow.window)
    withExtendedLifetime(unrelatedWindow) {}
  }

  @Test
  func selectingSpaceSwitchesThePreferredWindowInPlace() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let first = registerWindow(in: registry, spaceID: spaces[0].id)
      let second = registerWindow(in: registry, spaceID: spaces[0].id)

      #expect(registry.selectSpace(spaces[1].id))

      #expect(registry.activeEntries().count == 2)
      #expect(second.terminal.displayedSpaceID == spaces[1].id)
      #expect(first.terminal.displayedSpaceID == spaces[0].id)
      #expect(catalog.defaultSelectedSpaceID == spaces[1].id)
      withExtendedLifetime([first.window, second.window]) {}
    }
  }

  @Test
  func coldContextPrefersItsOwningWindowBySurfaceOrTab() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let owner = registerWindow(in: registry, spaceID: spaces[0].id)
      let preferred = registerWindow(in: registry, spaceID: spaces[0].id)
      let tabID = TerminalTabID()
      let surfaceID = UUID()
      owner.terminal.spaceManager.registerColdInstance(
        TerminalSpaceSession(
          spaceID: spaces[1].id,
          selectedTabID: tabID,
          nodes: [
            TerminalTabNodeSession(
              item: .tab(tabID),
              parent: .root(isPinned: false),
              order: 0
            )
          ],
          groups: [],
          collapsedGroupIDs: [],
          tabs: [
            TerminalTabSession(
              id: tabID,
              lockedTitle: nil,
              focusedPaneIndex: 0,
              root: .leaf(
                TerminalPaneLeafSession(id: surfaceID, workingDirectoryPath: nil)
              )
            )
          ]
        )
      )

      let surfaceEntry = try #require(
        registry.ambientEntries(
          for: SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
        ).first
      )
      let tabEntry = try #require(
        registry.ambientEntries(
          for: SupatermCLIContext(surfaceID: UUID(), tabID: tabID.rawValue)
        ).first
      )

      #expect(surfaceEntry.terminal === owner.terminal)
      #expect(tabEntry.terminal === owner.terminal)
      #expect(surfaceEntry.terminal !== preferred.terminal)
      withExtendedLifetime([owner.window, preferred.window]) {}
    }
  }

  @Test
  func focusingWindowPersistsItsSpaceAndTracksLastSpace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: spaces[0].id, createsInitialTab: true)

      #expect(registry.selectSpace(spaces[1].id))
      #expect(catalog.defaultSelectedSpaceID == spaces[1].id)

      let lastSpace = try registry.lastSpaceResult(context: nil)

      #expect(lastSpace.target.spaceID == spaces[0].id.rawValue)
      #expect(window.terminal.displayedSpaceID == spaces[0].id)
      #expect(catalog.defaultSelectedSpaceID == spaces[0].id)
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func socketSpaceSwitchReportsTheNewSpaceWhileTheSlideStillRuns() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: spaces[0].id, createsInitialTab: true)
      let pager = SpaceSwipeController()
      var slides: [[Int]] = []
      pager.slide = { slides.append([$0, $1]) }
      window.terminal.spacePager = pager

      let result = try registry.selectSpaceResult(spaces[1].id, context: nil)

      #expect(result.isSelectedSpace)
      #expect(result.target.spaceID == spaces[1].id.rawValue)
      #expect(window.terminal.displayedSpaceID == spaces[1].id)
      #expect(slides == [[0, 1]])
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func deferredSwipeSelectionCommitsWithoutStartingAnotherSlide() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: spaces[0].id, createsInitialTab: true)
      let pager = SpaceSwipeController()
      var slides: [[Int]] = []
      pager.slide = { slides.append([$0, $1]) }
      window.terminal.spacePager = pager

      window.terminal.selectSpaceAfterAnimation(spaces[1].id)

      #expect(window.terminal.displayedSpaceID == spaces[1].id)
      #expect(catalog.defaultSelectedSpaceID == spaces[1].id)
      #expect(slides.isEmpty)
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func creatingSpaceTrimsNameAndSwitchesTheWindowInPlace() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let initialSpace = TerminalSpaceItem(name: "A")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: initialSpace.id,
          spaces: [initialSpace]
        )
      }
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: initialSpace.id)

      let spaceID = try registry.createSpace(named: "  Build  ")

      #expect(catalog.spaces.map(\.name) == ["A", "Build"])
      #expect(catalog.defaultSelectedSpaceID == spaceID)
      #expect(registry.activeEntries().count == 1)
      #expect(window.terminal.displayedSpaceID == spaceID)
      #expect(throws: TerminalControlError.self) {
        try registry.createSpace(named: "build")
      }
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func createSpacePersistsColorAndSetSpaceColorUpdatesIt() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let initialSpace = TerminalSpaceItem(name: "A")
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(
          defaultSelectedSpaceID: initialSpace.id,
          spaces: [initialSpace]
        )
      }
      let registry = TerminalWindowRegistry()

      let spaceID = try registry.createSpace(named: "Build", color: .green)
      #expect(catalog.spaces.map(\.color) == [.neutral, .green])

      try registry.setSpaceColor(spaceID, to: .purple)
      #expect(catalog.spaces.map(\.color) == [.neutral, .purple])

      #expect(throws: TerminalControlError.self) {
        try registry.setSpaceColor(TerminalSpaceID(), to: .blue)
      }
    }
  }

  @Test
  func deletingSpaceSwitchesItsWindowsToTheNeighborWithoutClosingThem() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      var closedWindowIDs: [UUID] = []
      let first = registerWindow(
        in: registry,
        spaceID: spaces[0].id,
        onClose: { closedWindowIDs.append($0) }
      )
      let second = registerWindow(
        in: registry,
        spaceID: spaces[0].id,
        onClose: { closedWindowIDs.append($0) }
      )
      let third = registerWindow(in: registry, spaceID: spaces[1].id)

      try registry.deleteSpace(spaces[0].id)

      #expect(closedWindowIDs.isEmpty)
      #expect(catalog.spaces.map(\.id) == [spaces[1].id])
      #expect(catalog.defaultSelectedSpaceID == spaces[1].id)
      #expect(first.terminal.displayedSpaceID == spaces[1].id)
      #expect(second.terminal.displayedSpaceID == spaces[1].id)
      #expect(third.terminal.displayedSpaceID == spaces[1].id)
      #expect(throws: TerminalControlError.self) {
        try registry.deleteSpace(spaces[1].id)
      }
      withExtendedLifetime([first.window, second.window, third.window]) {}
    }
  }

  @Test
  func menuContextUsesGlobalSpaceCount() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let spaces = [TerminalSpaceItem(name: "A"), TerminalSpaceItem(name: "B")]
      @Shared(.terminalSpaceCatalog) var catalog = TerminalSpaceCatalog.default
      $catalog.withLock {
        $0 = TerminalSpaceCatalog(defaultSelectedSpaceID: spaces[0].id, spaces: spaces)
      }
      let registry = TerminalWindowRegistry()
      let window = registerWindow(in: registry, spaceID: spaces[0].id)

      #expect(registry.menuContext().spaceCount == 2)
      withExtendedLifetime(window.window) {}
    }
  }

  @Test
  func commandAvailabilityReflectsSelectedTabInActiveWindow() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()

      let tabCollection = host.spaceManager.tabCollection
      let tabID = tabCollection.createTab(title: "Terminal 1")
      tabCollection.selectTab(tabID)

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
  func commandPaletteSnapshotUsesRequestedWindowID() throws {
    try withDependencies {
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
  func commandPaletteSnapshotAggregatesFocusTargetsAcrossWindows() throws {
    try withDependencies {
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
  func commandPaletteSnapshotBuildsCheckForUpdatesEntryWhenIdle() throws {
    try withDependencies {
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
  func commandPaletteSnapshotBuildsRestartActionsWhenAutoInstallIsPending() throws {
    try withDependencies {
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
  func commandPaletteSnapshotBuildsRestartActionsWhenPromptIsShown() throws {
    try withDependencies {
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
  func commandPaletteSnapshotBuildsRestartToUpdateEntryWhenRestartIsDeferred() throws {
    try withDependencies {
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
  func focusCommandPalettePaneFocusesTheRequestedPane() throws {
    try withDependencies {
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

      registry.focusCommandPalettePane(target)

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
      host.ensureInitialTab(focusing: false, startupCommand: nil)
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
  func jumpToLatestUnreadMovesNewestFirstAcrossWindows() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let registry = TerminalWindowRegistry()
      let olderHost = try makeCommandPaletteHost(title: "older", workingDirectory: nil)
      let newerHost = try makeCommandPaletteHost(title: "newer", workingDirectory: nil)
      olderHost.windowActivity = .inactive
      newerHost.windowActivity = .inactive
      let olderTabID = try #require(olderHost.selectedTabID)
      let newerTabID = try #require(newerHost.selectedTabID)
      let olderSurface = try #require(olderHost.selectedSurfaceView)
      let newerSurface = try #require(newerHost.selectedSurfaceView)
      let olderSurfaceID = olderSurface.id
      let newerSurfaceID = newerSurface.id

      olderHost.notificationStore.append(
        TerminalHostState.PaneNotification(
          attentionState: .unread,
          body: "older",
          createdAt: Date(timeIntervalSince1970: 1),
          title: "Older"
        ),
        for: olderSurfaceID
      )
      newerHost.notificationStore.append(
        TerminalHostState.PaneNotification(
          attentionState: .unread,
          body: "newer",
          createdAt: Date(timeIntervalSince1970: 2),
          title: "Newer"
        ),
        for: newerSurfaceID
      )

      let olderWindowControllerID = UUID()
      let newerWindowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: olderWindowControllerID,
        store: Store(initialState: AppFeature.State()) { AppFeature() },
        terminal: olderHost,
        requestConfirmedWindowClose: {}
      )
      registry.register(
        keyboardShortcutForAction: { _ in nil },
        windowControllerID: newerWindowControllerID,
        store: Store(initialState: AppFeature.State()) { AppFeature() },
        terminal: newerHost,
        requestConfirmedWindowClose: {}
      )
      let olderWindow = makeWindow(focusing: olderSurface)
      let newerWindow = makeWindow(focusing: newerSurface)
      defer {
        olderWindow.contentView = nil
        newerWindow.contentView = nil
      }
      registry.updateWindow(olderWindow, for: olderWindowControllerID)
      registry.updateWindow(newerWindow, for: newerWindowControllerID)

      #expect(registry.hasUnreadNotifications)
      #expect(registry.jumpToLatestUnread())
      let focusedNewerSurface = await waitUntil {
        newerWindow.firstResponder === newerSurface
          && newerHost.unreadNotificationCount(for: newerTabID) == 0
      }
      #expect(focusedNewerSurface)
      #expect(olderHost.unreadNotificationCount(for: olderTabID) == 1)

      #expect(registry.jumpToLatestUnread())
      let focusedOlderSurface = await waitUntil {
        olderWindow.firstResponder === olderSurface
          && olderHost.unreadNotificationCount(for: olderTabID) == 0
      }
      #expect(focusedOlderSurface)
      #expect(!registry.hasUnreadNotifications)
      #expect(!registry.jumpToLatestUnread())
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

    registry.performCommandPaletteUpdateAction(
      .allowAutomaticChecks,
      windowID: ObjectIdentifier(window)
    )

    #expect(await waitForUpdateMenuActions(recorder, count: 1) == [.allowAutomaticChecks])
  }

  @Test
  func restorationSnapshotPreservesActiveWindowOrder() {
    withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let firstFrame = NSRect(x: 40, y: 80, width: 1_100, height: 740)
      let secondFrame = NSRect(x: 160, y: 220, width: 1_180, height: 760)
      let registry = TerminalWindowRegistry()
      let firstHost = TerminalHostState()
      firstHost.ensureInitialTab(focusing: false, startupCommand: nil)

      let secondHost = TerminalHostState()
      secondHost.ensureInitialTab(focusing: false, startupCommand: nil)
      secondHost.handleCommand(.createTab(inheritingFromSurfaceID: nil))

      var firstState = AppFeature.State()
      firstState.terminal.sidebarWidth = 348
      let firstStore = Store(initialState: firstState) {
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
      #expect(
        snapshot.windows.map(\.displayedSpaceID)
          == [firstHost.displayedSpaceID, secondHost.displayedSpaceID]
      )
      #expect(snapshot.windows[0].frame == TerminalWindowFrame(firstFrame))
      #expect(snapshot.windows[0].sidebarWidth == 348)
      #expect(snapshot.windows[0].displayedSpace?.tabs.count == 1)
      #expect(snapshot.windows[1].frame == TerminalWindowFrame(secondFrame))
      #expect(snapshot.windows[1].displayedSpace?.tabs.count == 2)
    }
  }
  @Test
  func requestCloseTabInKeyWindowDispatchesReducerCommand() async {
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

      let tabCollection = host.spaceManager.tabCollection
      let tabID = tabCollection.createTab(title: "Terminal 1")
      tabCollection.selectTab(tabID)

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
      let receivedCommand = await waitUntil {
        recorder.commands == [.requestCloseTab(tabID)]
      }
      #expect(receivedCommand)
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
      let receivedCommand = await waitUntil {
        recorder.commands == [.createTab(inheritingFromSurfaceID: nil)]
      }
      #expect(receivedCommand)
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
      let tabCollection = host.spaceManager.tabCollection
      let tabID = tabCollection.createTab(title: "Terminal 1")
      let groupID = try #require(
        tabCollection.createGroup(title: "Group", containing: [tabID])
      ).groupID
      tabCollection.selectTab(tabID)

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
      let receivedCommand = await waitUntil {
        recorder.commands == [.createTabInGroup(groupID, inheritingFromSurfaceID: nil)]
      }
      #expect(receivedCommand)
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
      let receivedCommand = await waitUntil {
        recorder.commands == [.performBindingActionOnFocusedSurface(.newSplit(.left))]
      }
      #expect(receivedCommand)
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
      let openedPalette = await waitUntil { store.terminal.commandPalette != nil }
      #expect(openedPalette)
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
  func requestOpenAgentPanelPullRequestInKeyWindowOpensSelectedPullRequest() async throws {
    try await withDependencies {
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
      let pullRequestURL = try #require(
        URL(string: "https://github.com/supabitapp/supaterm/pull/170")
      )
      #expect(
        host.storeAgentPanelBranchDetails(
          PaneAgentBranchDetails(
            branchName: "feat/open-pr-hotkey",
            addedLineCount: 9,
            removedLineCount: 0,
            pullRequestStatus: PaneAgentPullRequestStatus(
              kind: .open,
              title: "#170",
              url: pullRequestURL,
              addedLineCount: 9,
              removedLineCount: 0,
              checks: nil
            )
          ),
          for: surfaceID
        )
      )
      var openedURLs: [URL] = []
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      } withDependencies: {
        $0.externalNavigationClient.open = { url in
          openedURLs.append(url)
          return true
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

      registry.requestOpenAgentPanelPullRequestInKeyWindow()
      let openedPullRequest = await waitUntil { openedURLs == [pullRequestURL] }
      #expect(openedPullRequest)
      #expect(registry.commandAvailability().hasAgentPanelPullRequest)
      withExtendedLifetime(window) {}
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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      registry.requestCopyAgentPanelSessionIDInKeyWindow()
      let copiedSession = await waitUntil { copiedSessionIDs == ["session-1"] }
      #expect(copiedSession)
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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      registry.requestForkAgentPanelSessionInKeyWindow(direction: .right)
      let clock = ContinuousClock()
      let deadline = clock.now.advanced(by: .seconds(1))
      while requests.isEmpty && clock.now < deadline {
        await Task.yield()
      }

      #expect(
        requests == [
          TerminalCreatePaneRequest(
            startupCommand: .shell("codex fork session-1"),
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
          TerminalHostState.AgentActivity(agent: .pi, phase: .running, detail: nil),
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
      let window = makeWindow()
      registry.updateWindow(window, for: windowControllerID)

      let availability = registry.commandAvailability()
      #expect(availability.hasAgentPanel)
      #expect(!availability.hasAgentPanelPullRequest)
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
      let receivedCommand = await waitUntil {
        recorder.commands == [.navigateSearch(.previous)]
      }
      #expect(receivedCommand)
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
private func registerWindow(
  in registry: TerminalWindowRegistry,
  spaceID: TerminalSpaceID,
  createsInitialTab: Bool = false,
  onClose: @escaping (UUID) -> Void = { _ in }
) -> RegisteredWindow {
  let id = UUID()
  let host = TerminalHostState(managesTerminalSurfaces: createsInitialTab, spaceID: spaceID)
  if createsInitialTab {
    host.ensureInitialTab(focusing: false, startupCommand: nil)
  }
  let store = Store(initialState: AppFeature.State()) {
    AppFeature()
  }
  registry.register(
    keyboardShortcutForAction: { _ in nil },
    windowControllerID: id,
    store: store,
    terminal: host,
    requestConfirmedWindowClose: { onClose(id) }
  )
  let window = makeWindow()
  registry.updateWindow(window, for: id)
  return RegisteredWindow(terminal: host, window: window)
}

private struct RegisteredWindow {
  let terminal: TerminalHostState
  let window: NSWindow
}

@MainActor
private func makeCommandPaletteHost(
  title: String,
  workingDirectory: String?
) throws -> TerminalHostState {
  let host = TerminalHostState()
  host.ensureInitialTab(focusing: false, startupCommand: nil)
  host.selectedSurfaceView?.bridge.state.title = title
  host.selectedSurfaceView?.bridge.state.titleOverride = nil
  host.selectedSurfaceView?.bridge.state.pwd = workingDirectory
  return host
}
