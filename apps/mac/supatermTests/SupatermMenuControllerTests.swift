import AppKit
import Carbon.HIToolbox
import ComposableArchitecture
import GhosttyKit
import Sharing
import SupatermCLIShared
import SupatermSettingsFeature
import SupatermSupport
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct SupatermMenuControllerTests {
  @Test
  func refreshUsesAppShortcutOverrides() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var settings = .default
      $settings.withLock {
        $0.shortcutOverrides[.toggleSidebar] = SupatermShortcutOverride(
          keyCode: UInt16(kVK_ANSI_B),
          modifiers: [.command, .option]
        )
        $0.shortcutOverrides[.toggleAgentPanel] = .disabled
      }

      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let controller = SupatermMenuController(registry: TerminalWindowRegistry())
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let viewMenu = try #require(
        app.mainMenu?.items.first(where: { $0.title == "View" })?.submenu
      )
      #expect(viewMenu.items[0].keyEquivalent == "b")
      #expect(viewMenu.items[0].keyEquivalentModifierMask == [.command, .option])
      #expect(viewMenu.items[1].keyEquivalent.isEmpty)
      #expect(viewMenu.items[1].keyEquivalentModifierMask.isEmpty)
    }
  }

  @Test
  func installBuildsOwnedAppKitMenus() throws {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    let titles = app.mainMenu?.items.map(\.title) ?? []
    #expect(titles.count == 8)
    #expect(Array(titles.suffix(7)) == ["File", "Edit", "View", "Tabs", "Spaces", "Window", "Help"])

    try assertAppMenu(app.mainMenu)
    try assertFileMenu(app.mainMenu)
    try assertEditMenu(app.mainMenu)
    try assertViewMenu(app.mainMenu)
    try assertTabsMenu(app.mainMenu)
    try assertSpacesMenu(app.mainMenu)
    try assertWindowMenu(app.mainMenu)
    try assertHelpMenu(app.mainMenu)
    try assertImageAccessibilityDescriptions(
      app.mainMenu,
      matching: [
        "app.supabit.supaterm.file.newWindow",
        "app.supabit.supaterm.file.newTab",
        "app.supabit.supaterm.file.newTabInGroup",
        "app.supabit.supaterm.file.splitRight",
        "app.supabit.supaterm.file.splitLeft",
        "app.supabit.supaterm.file.splitDown",
        "app.supabit.supaterm.file.splitUp",
        "app.supabit.supaterm.file.close",
        "app.supabit.supaterm.file.openCommandPalette",
        "app.supabit.supaterm.view.changeTabTitle",
        "app.supabit.supaterm.view.changeTerminalTitle",
        "app.supabit.supaterm.tabs.jumpToLatestUnread",
        "app.supabit.supaterm.window.zoomSplit",
        "app.supabit.supaterm.window.previousSplit",
        "app.supabit.supaterm.window.nextSplit",
        "app.supabit.supaterm.window.selectSplitAbove",
        "app.supabit.supaterm.window.selectSplitBelow",
        "app.supabit.supaterm.window.selectSplitLeft",
        "app.supabit.supaterm.window.selectSplitRight",
        "app.supabit.supaterm.window.equalizeSplits",
        "app.supabit.supaterm.window.moveSplitDividerUp",
        "app.supabit.supaterm.window.moveSplitDividerDown",
        "app.supabit.supaterm.window.moveSplitDividerLeft",
        "app.supabit.supaterm.window.moveSplitDividerRight",
        "app.supabit.supaterm.help.changelog",
        "app.supabit.supaterm.help.submitGitHubIssue",
      ]
    )
  }

  @Test
  func copyMenuValidationUsesFocusedSurfaceSelection() throws {
    initializeGhosttyForTests()

    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let selection = MenuSelectionTextSource()
    let surface = GhosttySurfaceView(
      runtime: GhosttyRuntime(),
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      selectionReader: { _ in selection.value }
    )
    let window = NSPanel(
      contentRect: NSRect(x: 0, y: 0, width: 400, height: 300),
      styleMask: [.titled, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    defer {
      app.mainMenu = previousMainMenu
      surface.closeSurface()
      window.contentView = nil
      window.orderOut(nil)
    }

    window.contentView = surface
    window.makeKeyAndOrderFront(nil)
    window.makeFirstResponder(surface)
    controller.install()

    let editMenu = try #require(app.mainMenu?.items.first { $0.title == "Edit" }?.submenu)
    let copyItem = try #require(editMenu.items.first { $0.title == "Copy" })
    try #require(copyItem.target == nil)
    try #require(app.keyWindow === window)
    let copyAction = try #require(copyItem.action)
    try #require(
      app.target(forAction: copyAction, to: copyItem.target, from: copyItem) as AnyObject? === surface)

    editMenu.update()
    #expect(!copyItem.isEnabled)

    selection.value = "selected text"
    editMenu.update()
    #expect(copyItem.isEnabled)
  }

  @Test
  func refreshUsesShortcutSourceForGhosttyBackedItems() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "new_window":
            KeyboardShortcut("u", modifiers: [.command, .option])
          case "start_search":
            KeyboardShortcut("l", modifiers: [.command, .shift])
          case "prompt_tab_title":
            KeyboardShortcut("r", modifiers: [.command, .option])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let fileMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "File" })?.submenu)
      #expect(fileMenu.items[0].keyEquivalent == "u")
      #expect(fileMenu.items[0].keyEquivalentModifierMask == [.command, .option])

      let editMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "Edit" })?.submenu)
      let findMenu = try #require(editMenu.items.last?.submenu)
      #expect(findMenu.items[0].keyEquivalent == "l")
      #expect(findMenu.items[0].keyEquivalentModifierMask == [.command, .shift])

      let viewMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "View" })?.submenu)
      #expect(viewMenu.items[1].keyEquivalent == "i")
      #expect(viewMenu.items[1].keyEquivalentModifierMask == [.command])
      #expect(viewMenu.items[6].keyEquivalent == "r")
      #expect(viewMenu.items[6].keyEquivalentModifierMask == [.command, .option])
    }
  }

  @Test
  func refreshPreservesFindNavigationDefaultsForPartialShortcutSource() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var settings = .default
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()

      let editMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "Edit" })?.submenu)
      let findMenu = try #require(editMenu.items.last?.submenu)
      assertDefaultFindNavigationShortcuts(findMenu)

      var shortcuts = [
        "new_window": KeyboardShortcut("u", modifiers: [.command, .option])
      ]
      registry.register(
        keyboardShortcutForAction: { shortcuts[$0] },
        windowControllerID: UUID(),
        store: Store(initialState: AppFeature.State()) {
          AppFeature()
        },
        terminal: TerminalHostState(managesTerminalSurfaces: false),
        requestConfirmedWindowClose: {}
      )
      controller.refresh()

      assertDefaultFindNavigationShortcuts(findMenu)

      shortcuts["reload_config"] = KeyboardShortcut("g", modifiers: [.command])
      controller.refresh()

      let commandG = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "g",
          charactersIgnoringModifiers: "g",
          isARepeat: false,
          keyCode: UInt16(kVK_ANSI_G)
        )
      )
      #expect(!controller.performGhosttyBindingMenuKeyEquivalent(with: commandG))
      assertDefaultFindNavigationShortcuts(findMenu)

      shortcuts["reload_config"] = nil
      shortcuts["toggle_split_zoom"] = KeyboardShortcut("g", modifiers: [.command])
      controller.refresh()

      #expect(findMenu.items[1].keyEquivalent.isEmpty)
      #expect(findMenu.items[1].keyEquivalentModifierMask.isEmpty)
      let windowMenu = try #require(
        app.mainMenu?.items.first(where: { $0.title == "Window" })?.submenu
      )
      let zoomSplit = try #require(windowMenu.items.first(where: { $0.title == "Zoom Split" }))
      #expect(zoomSplit.keyEquivalent == "g")
      #expect(zoomSplit.keyEquivalentModifierMask == [.command])

      shortcuts["toggle_split_zoom"] = nil
      $settings.withLock {
        $0.shortcutOverrides[.toggleSidebar] = SupatermShortcutOverride(
          keyCode: UInt16(kVK_ANSI_G),
          modifiers: [.command]
        )
      }
      controller.refresh()

      #expect(findMenu.items[1].keyEquivalent.isEmpty)
      #expect(findMenu.items[1].keyEquivalentModifierMask.isEmpty)
      let viewMenu = try #require(
        app.mainMenu?.items.first(where: { $0.title == "View" })?.submenu
      )
      #expect(viewMenu.items[0].keyEquivalent == "g")
      #expect(viewMenu.items[0].keyEquivalentModifierMask == [.command])

      $settings.withLock {
        $0.shortcutOverrides[.toggleSidebar] = nil
      }
      shortcuts["copy_to_clipboard"] = KeyboardShortcut("g", modifiers: [.command])
      controller.refresh()

      assertDefaultFindNavigationShortcuts(findMenu)
      let copy = try #require(editMenu.items.first(where: { $0.title == "Copy" }))
      #expect(copy.keyEquivalent == "c")
      #expect(copy.keyEquivalentModifierMask == [.command])

      shortcuts["navigate_search:previous"] = KeyboardShortcut(
        "j",
        modifiers: [.command, .option]
      )
      controller.refresh()

      #expect(findMenu.items[2].keyEquivalent == "j")
      #expect(findMenu.items[2].keyEquivalentModifierMask == [.command, .option])
    }
  }

  @Test
  func performNewWindowUsesConfiguredAction() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    var invocations = 0

    controller.setNewWindowAction {
      invocations += 1
      return true
    }

    #expect(controller.performNewWindow())
    #expect(invocations == 1)
  }

  @Test
  func performSubmitGitHubIssueUsesConfiguredAction() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    var invocations = 0

    controller.setSubmitGitHubIssueAction {
      invocations += 1
      return true
    }

    #expect(controller.performSubmitGitHubIssue())
    #expect(invocations == 1)
  }

  @Test
  func performQuitTerminatingSessionsUsesAppDelegate() {
    let app = NSApplication.shared
    let previousDelegate = app.delegate
    let delegate = GhosttyAppActionPerformerSpy()
    app.delegate = delegate
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    defer {
      app.delegate = previousDelegate
    }

    #expect(controller.performQuitTerminatingSessions())

    #expect(delegate.quitTerminatingSessionsCount == 1)
    #expect(delegate.quitCount == 0)
  }

  @Test
  func aboutAndSettingsMenuItemsUseConfiguredSettingsAction() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    var tabs: [SettingsFeature.Tab] = []

    controller.setShowSettingsAction { tab in
      tabs.append(tab)
      return true
    }

    controller.about(nil)
    controller.showSettings(nil)

    #expect(tabs == [.about, .general])
  }

  @Test
  func closeSurfaceClosesKeyNonTerminalWindow() {
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    let window = CloseRecordingWindow()

    #expect(controller.performCloseSurface(for: window, sender: nil))

    #expect(window.performCloseCount == 1)
  }

  @Test
  func menuContextTreatsClosableNonTerminalWindowAsDirectClose() {
    let registry = TerminalWindowRegistry()
    let window = CloseRecordingWindow()

    #expect(registry.menuContext(keyWindow: window).closesKeyWindowDirectly)
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentRoutesReboundOpenConfigToSettings() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "open_config":
            KeyboardShortcut("P", modifiers: [.command])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      var tabs: [SettingsFeature.Tab] = []
      controller.setShowSettingsAction { tab in
        tabs.append(tab)
        return true
      }
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let appMenu = try #require(app.mainMenu?.items.first?.submenu)
      let settingsItem = try #require(appMenu.items.first(where: { $0.title == "Settings..." }))
      #expect(settingsItem.keyEquivalent == "p")
      #expect(settingsItem.keyEquivalentModifierMask == [.command, .shift])

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .shift],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "p",
          charactersIgnoringModifiers: "p",
          isARepeat: false,
          keyCode: 35
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      #expect(tabs == [.terminal])
    }
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentIgnoresSystemMenuItems() throws {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    let event = try #require(
      NSEvent.keyEvent(
        with: .keyDown,
        location: .zero,
        modifierFlags: [.command],
        timestamp: 0,
        windowNumber: 0,
        context: nil,
        characters: "h",
        charactersIgnoringModifiers: "h",
        isARepeat: false,
        keyCode: 4
      )
    )

    #expect(!controller.performGhosttyBindingMenuKeyEquivalent(with: event))
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentRoutesForwardDeleteWithFunctionModifier() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "new_window":
            KeyboardShortcut(.deleteForward, modifiers: [])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      var invocations = 0
      controller.setNewWindowAction {
        invocations += 1
        return true
      }
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.function],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: KeyEquivalent.deleteForward.character.description,
          charactersIgnoringModifiers: KeyEquivalent.deleteForward.character.description,
          isARepeat: false,
          keyCode: UInt16(kVK_ForwardDelete)
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      #expect(invocations == 1)
    }
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentRoutesCommandPaletteShortcut() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "toggle_command_palette":
            KeyboardShortcut("p", modifiers: [.command, .shift])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      registry.updateWindow(NSWindow(), for: windowControllerID)
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .shift],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "p",
          charactersIgnoringModifiers: "p",
          isARepeat: false,
          keyCode: 35
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      #expect(store.terminal.commandPalette != nil)
    }
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentRoutesJumpToLatestUnreadShortcut() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      initializeGhosttyForTests()

      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState()
      host.windowActivity = .inactive
      host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
      let tabID = try #require(host.selectedTabID)
      let surface = try #require(host.selectedSurfaceView)
      let surfaceID = surface.id
      host.notificationStore.append(
        TerminalHostState.PaneNotification(
          attentionState: .unread,
          body: "Done",
          createdAt: Date(timeIntervalSince1970: 1),
          title: "Codex"
        ),
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
      let window = makeWindow(focusing: surface)
      registry.updateWindow(window, for: windowControllerID)
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
        surface.closeSurface()
        window.contentView = nil
      }

      controller.install()
      controller.refresh()

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .control],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "u",
          charactersIgnoringModifiers: "u",
          isARepeat: false,
          keyCode: UInt16(kVK_ANSI_U)
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      let focusedUnreadSurface = await waitUntil {
        window.firstResponder === surface && host.unreadNotificationCount(for: tabID) == 0
      }
      #expect(focusedUnreadSurface)
    }
  }

  @Test
  func newTabInGroupShortcutRequiresSelectedGroup() async throws {
    try await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
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
      registry.updateWindow(NSWindow(), for: windowControllerID)
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }
      controller.install()

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .option],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "t",
          charactersIgnoringModifiers: "t",
          isARepeat: false,
          keyCode: 17
        )
      )

      #expect(!controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      let groupID = try #require(
        tabCollection.createGroup(title: "Group", containing: [tabID])
      ).groupID
      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      await flushEffects()

      #expect(
        recorder.commands
          == [.createTabInGroup(groupID, inheritingFromSurfaceID: nil)]
      )
    }
  }

  @Test
  func refreshUsesGhosttyShortcutForCommandPalette() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "toggle_command_palette":
            KeyboardShortcut("y", modifiers: [.command, .option])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let fileMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "File" })?.submenu)
      let item = try #require(fileMenu.items.first(where: { $0.title == "Open Command Palette" }))
      #expect(item.keyEquivalent == "y")
      #expect(item.keyEquivalentModifierMask == [.command, .option])
    }
  }

  @Test
  func refreshClearsCommandPaletteShortcutWhenGhosttyLeavesActionUnbound() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "new_window":
            KeyboardShortcut("u", modifiers: [.command, .option])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let fileMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "File" })?.submenu)
      let item = try #require(fileMenu.items.first(where: { $0.title == "Open Command Palette" }))
      #expect(item.keyEquivalent.isEmpty)
      #expect(item.keyEquivalentModifierMask.isEmpty)
    }
  }

  @Test
  func refreshClearsQuitShortcutWhenGhosttyLeavesQuitUnbound() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "new_window":
            KeyboardShortcut("u", modifiers: [.command, .option])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let appMenu = try #require(app.mainMenu?.items.first?.submenu)
      let quitItem = try #require(appMenu.items.last)
      #expect(quitItem.keyEquivalent.isEmpty)
      #expect(quitItem.keyEquivalentModifierMask.isEmpty)
    }
  }

  @Test
  func refreshUsesGhosttyShortcutForCheckForUpdates() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      var state = AppFeature.State()
      state.update.canCheckForUpdates = true
      let store = Store(initialState: state) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "check_for_updates":
            KeyboardShortcut("u", modifiers: [.command, .shift])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
      }

      controller.install()
      controller.refresh()

      let appMenu = try #require(app.mainMenu?.items.first?.submenu)
      let item = try #require(appMenu.items.first(where: { $0.title == "Check for Updates..." }))
      #expect(item.keyEquivalent == "u")
      #expect(item.keyEquivalentModifierMask == [.command, .shift])
    }
  }

  @Test
  func validateCheckForUpdatesMenuItemShowsRestartToUpdateWhenInstallIsPending() throws {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
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
    registry.updateWindow(NSWindow(), for: windowControllerID)
    let controller = SupatermMenuController(registry: registry)
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    let appMenu = try #require(app.mainMenu?.items.first?.submenu)
    let item = try #require(
      appMenu.items.first(where: {
        $0.identifier == NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.checkForUpdates")
      }))

    #expect(controller.validateMenuItem(item))
    #expect(item.title == "Restart to Update...")
  }

  @Test
  func validateCheckForUpdatesMenuItemShowsRestartToUpdateWhenRestartIsDeferred() throws {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let registry = TerminalWindowRegistry()
    let host = TerminalHostState(managesTerminalSurfaces: false)
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
    registry.updateWindow(NSWindow(), for: windowControllerID)
    let controller = SupatermMenuController(registry: registry)
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    let appMenu = try #require(app.mainMenu?.items.first?.submenu)
    let item = try #require(
      appMenu.items.first(where: {
        $0.identifier == NSUserInterfaceItemIdentifier("app.supabit.supaterm.app.checkForUpdates")
      }))

    #expect(controller.validateMenuItem(item))
    #expect(item.title == "Restart to Update...")
  }

  @Test
  func performGhosttyBindingMenuKeyEquivalentRoutesReboundQuit() throws {
    try withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let app = NSApplication.shared
      let previousMainMenu = app.mainMenu
      let previousDelegate = app.delegate
      let delegate = GhosttyAppActionPerformerSpy()
      app.delegate = delegate
      let registry = TerminalWindowRegistry()
      let host = TerminalHostState(managesTerminalSurfaces: false)
      let store = Store(initialState: AppFeature.State()) {
        AppFeature()
      }
      let windowControllerID = UUID()
      registry.register(
        keyboardShortcutForAction: { action in
          switch action {
          case "quit":
            KeyboardShortcut("k", modifiers: [.command, .option])
          default:
            nil
          }
        },
        windowControllerID: windowControllerID,
        store: store,
        terminal: host,
        requestConfirmedWindowClose: {}
      )
      let controller = SupatermMenuController(registry: registry)
      defer {
        app.mainMenu = previousMainMenu
        app.delegate = previousDelegate
      }

      controller.install()
      controller.refresh()

      let reboundEvent = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command, .option],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "k",
          charactersIgnoringModifiers: "k",
          isARepeat: false,
          keyCode: 40
        )
      )
      let defaultEvent = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "q",
          charactersIgnoringModifiers: "q",
          isARepeat: false,
          keyCode: 12
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: reboundEvent))
      #expect(!controller.performGhosttyBindingMenuKeyEquivalent(with: defaultEvent))
      #expect(delegate.quitCount == 1)
    }
  }

  private func assertDefaultFindNavigationShortcuts(_ findMenu: NSMenu) {
    #expect(findMenu.items[1].keyEquivalent == "g")
    #expect(findMenu.items[1].keyEquivalentModifierMask == [.command])
    #expect(findMenu.items[2].keyEquivalent == "g")
    #expect(findMenu.items[2].keyEquivalentModifierMask == [.command, .shift])
  }

  private func assertAppMenu(_ menu: NSMenu?) throws {
    let appMenu = try #require(menu?.items.first?.submenu)
    #expect(appMenu.items[0].title.hasPrefix("About "))
    #expect(appMenu.items[0].action == #selector(SupatermMenuController.about(_:)))
    #expect(appMenu.items[1].title == "Settings...")
    #expect(appMenu.items[1].action == #selector(SupatermMenuController.showSettings(_:)))
    #expect(appMenu.items[1].keyEquivalent == ",")
    #expect(appMenu.items[1].keyEquivalentModifierMask == [.command])
    #expect(appMenu.items[2].isSeparatorItem)
    #expect(appMenu.items[3].title == "Check for Updates...")
    #expect(appMenu.items[3].keyEquivalent == "u")
    #expect(appMenu.items[3].keyEquivalentModifierMask == [.command, .shift])
    #expect(appMenu.items[11].title.hasPrefix("Quit ") == true)
    #expect(appMenu.items[11].title.hasSuffix(" and Close All Sessions") == true)
    #expect(appMenu.items[11].action == #selector(SupatermMenuController.quitTerminatingSessions(_:)))
    #expect(appMenu.items[11].keyEquivalent.isEmpty)
    #expect(appMenu.items[11].keyEquivalentModifierMask.isEmpty)
    #expect(appMenu.items.last?.title.hasPrefix("Quit ") == true)
    #expect(appMenu.items.last?.action == #selector(SupatermMenuController.quit(_:)))
    #expect(appMenu.items.last?.keyEquivalent == "q")
    #expect(appMenu.items.last?.keyEquivalentModifierMask == [.command])
  }

  private func assertFileMenu(_ menu: NSMenu?) throws {
    let fileMenu = try #require(menu?.items.first(where: { $0.title == "File" })?.submenu)
    #expect(
      fileMenu.items.map(\.title) == [
        "New Window",
        "New Tab",
        "New Tab in Group",
        "Open Command Palette",
        "",
        "Split Right",
        "Split Left",
        "Split Down",
        "Split Up",
        "",
        "Close Pane",
        "Close Tab",
        "Close Window",
        "Close All Windows",
        "",
        "Terminate All Terminal Sessions...",
      ])
    #expect(fileMenu.items[0].keyEquivalent == "n")
    #expect(fileMenu.items[0].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[0].image != nil)
    #expect(fileMenu.items[2].keyEquivalent == "t")
    #expect(fileMenu.items[2].keyEquivalentModifierMask == [.command, .option])
    #expect(fileMenu.items[2].image != nil)
    #expect(fileMenu.items[3].keyEquivalent == "p")
    #expect(fileMenu.items[3].keyEquivalentModifierMask == [.command, .shift])
    #expect(fileMenu.items[3].image != nil)
    #expect(fileMenu.items[4].isSeparatorItem)
    #expect(fileMenu.items[10].keyEquivalent == "w")
    #expect(fileMenu.items[10].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[10].image != nil)
  }

  private func assertTabsMenu(_ menu: NSMenu?) throws {
    let tabsMenu = try #require(menu?.items.first(where: { $0.title == "Tabs" })?.submenu)
    #expect(
      tabsMenu.items.map(\.title) == [
        "Jump to Latest Unread",
        "",
        "Next Tab",
        "Previous Tab",
        "",
        "Tab 1",
        "Tab 2",
        "Tab 3",
        "Tab 4",
        "Tab 5",
        "Tab 6",
        "Tab 7",
        "Tab 8",
        "Tab 9",
        "Tab 10",
        "Last Tab",
      ])
    #expect(tabsMenu.items[0].keyEquivalent == "u")
    #expect(tabsMenu.items[0].keyEquivalentModifierMask == [.command, .control])
    #expect(tabsMenu.items[0].image != nil)
  }

  private func assertEditMenu(_ menu: NSMenu?) throws {
    let editMenu = try #require(menu?.items.first(where: { $0.title == "Edit" })?.submenu)
    #expect(
      editMenu.items.map(\.title) == [
        "Undo",
        "Redo",
        "",
        "Copy",
        "Paste",
        "Paste Selection",
        "Select All",
        "",
        "Find",
      ])
    #expect(editMenu.items[3].identifier?.rawValue == "app.supabit.supaterm.edit.copy")
    #expect(editMenu.items[4].identifier?.rawValue == "app.supabit.supaterm.edit.paste")
    #expect(editMenu.items[5].identifier?.rawValue == "app.supabit.supaterm.edit.pasteSelection")
    #expect(editMenu.items[6].identifier?.rawValue == "app.supabit.supaterm.edit.selectAll")
    let findMenu = try #require(editMenu.items[8].submenu)
    #expect(
      findMenu.items.compactMap { $0.identifier?.rawValue } == [
        "app.supabit.supaterm.edit.find",
        "app.supabit.supaterm.edit.findNext",
        "app.supabit.supaterm.edit.findPrevious",
        "app.supabit.supaterm.edit.hideFindBar",
        "app.supabit.supaterm.edit.selectionForFind",
      ])
  }

  private func assertViewMenu(_ menu: NSMenu?) throws {
    let viewMenu = try #require(menu?.items.first(where: { $0.title == "View" })?.submenu)
    #expect(
      viewMenu.items.map(\.title) == [
        "Toggle Sidebar",
        "Toggle Agent Panel",
        "Open Pull Request",
        "Fork Agent Session",
        "Copy Agent Session ID",
        "",
        "Change Tab Title...",
        "Change Terminal Title...",
      ])
    #expect(viewMenu.items[2].keyEquivalent == "p")
    #expect(viewMenu.items[2].keyEquivalentModifierMask == [.command, .option])
    #expect(viewMenu.items[3].keyEquivalent == "f")
    #expect(viewMenu.items[3].keyEquivalentModifierMask == [.command, .option])
    #expect(viewMenu.items[4].keyEquivalent == "c")
    #expect(viewMenu.items[4].keyEquivalentModifierMask == [.command, .option])
  }

  private func assertSpacesMenu(_ menu: NSMenu?) throws {
    let spacesMenu = try #require(menu?.items.first(where: { $0.title == "Spaces" })?.submenu)
    #expect(spacesMenu.items.count == 13)
    #expect(Array(spacesMenu.items.map(\.title).prefix(2)) == ["Next Space", "Previous Space"])
    #expect(spacesMenu.items[0].keyEquivalentModifierMask == [.command, .control])
    #expect(spacesMenu.items[1].keyEquivalentModifierMask == [.command, .control])
    #expect(spacesMenu.items[3].keyEquivalent == "1")
    #expect(spacesMenu.items[3].keyEquivalentModifierMask == [.control])
    #expect(spacesMenu.items[12].keyEquivalent == "0")
    #expect(spacesMenu.items[12].keyEquivalentModifierMask == [.control])
  }

  private func assertWindowMenu(_ menu: NSMenu?) throws {
    let windowMenu = try #require(menu?.items.first(where: { $0.title == "Window" })?.submenu)
    #expect(
      windowMenu.items.map(\.title) == [
        "Minimize",
        "Zoom",
        "",
        "Zoom Split",
        "Select Previous Split",
        "Select Next Split",
        "Select Split",
        "Resize Split",
        "",
        "Bring All to Front",
      ])
    let selectSplitMenu = try #require(windowMenu.items[6].submenu)
    #expect(
      selectSplitMenu.items.map(\.title) == [
        "Select Split Above",
        "Select Split Below",
        "Select Split Left",
        "Select Split Right",
      ])
    let resizeSplitMenu = try #require(windowMenu.items[7].submenu)
    #expect(
      resizeSplitMenu.items.map(\.title) == [
        "Equalize Panes",
        "",
        "Move Divider Up",
        "Move Divider Down",
        "Move Divider Left",
        "Move Divider Right",
      ])
  }

  private func assertHelpMenu(_ menu: NSMenu?) throws {
    let helpMenu = try #require(menu?.items.first(where: { $0.title == "Help" })?.submenu)
    #expect(helpMenu.items.map(\.title) == ["Changelog", "Submit GitHub Issue"])
    #expect(helpMenu.items[0].action == #selector(SupatermMenuController.openChangelog(_:)))
    #expect(helpMenu.items[0].image != nil)
    #expect(helpMenu.items[1].action == #selector(SupatermMenuController.submitGitHubIssue(_:)))
    #expect(helpMenu.items[1].image != nil)
  }

  private func assertImageAccessibilityDescriptions(
    _ menu: NSMenu?,
    matching identifiers: Set<String>
  ) throws {
    let menu = try #require(menu)
    for item in menu.items {
      if let identifier = item.identifier?.rawValue, identifiers.contains(identifier) {
        #expect(item.image != nil)
        let image = try #require(item.image)
        #expect(image.accessibilityDescription == item.title)
      }
      if let submenu = item.submenu {
        try assertImageAccessibilityDescriptions(submenu, matching: identifiers)
      }
    }
  }
}

@MainActor
private final class MenuSelectionTextSource {
  var value: String?
}

@MainActor
private final class CloseRecordingWindow: NSWindow {
  var performCloseCount = 0

  init() {
    super.init(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 480),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
  }

  override func performClose(_ sender: Any?) {
    performCloseCount += 1
  }
}
