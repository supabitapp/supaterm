import AppKit
import ComposableArchitecture
import SwiftUI
import Testing

@testable import supaterm

@MainActor
struct SupatermMenuControllerTests {
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
    try assertTabsMenu(app.mainMenu)
    try assertSpacesMenu(app.mainMenu)
    try assertWindowMenu(app.mainMenu)
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
      #expect(tabs == [.general])
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
  func performGhosttyBindingMenuKeyEquivalentRoutesIndexedGhosttyItemsOnly() throws {
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
            KeyboardShortcut("h", modifiers: [.command])
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
      controller.refresh()

      let event = try #require(
        NSEvent.keyEvent(
          with: .keyDown,
          location: .zero,
          modifierFlags: [.command],
          timestamp: 0,
          windowNumber: 0,
          context: nil,
          characters: "k",
          charactersIgnoringModifiers: "k",
          isARepeat: false,
          keyCode: 40
        )
      )

      #expect(controller.performGhosttyBindingMenuKeyEquivalent(with: event))
      #expect(store.terminal.commandPalette != nil)
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
    registry.updateWindow(NSWindow(), for: windowControllerID)
    let controller = SupatermMenuController(registry: registry)
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    let appMenu = try #require(app.mainMenu?.items.first?.submenu)
    let item = try #require(
      appMenu.items.first(where: { $0.identifier == .init("app.supabit.supaterm.app.checkForUpdates") }))

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
        "Open Command Palette",
        "",
        "Split Right",
        "Split Left",
        "Split Down",
        "Split Up",
        "",
        "Close",
        "Close Tab",
        "Close Window",
        "Close All Windows",
      ])
    #expect(fileMenu.items[0].keyEquivalent == "n")
    #expect(fileMenu.items[0].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[0].image != nil)
    #expect(fileMenu.items[2].keyEquivalent == "k")
    #expect(fileMenu.items[2].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[2].image != nil)
    #expect(fileMenu.items[3].isSeparatorItem)
    #expect(fileMenu.items[9].keyEquivalent == "w")
    #expect(fileMenu.items[9].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[9].image != nil)
  }

  private func assertTabsMenu(_ menu: NSMenu?) throws {
    let tabsMenu = try #require(menu?.items.first(where: { $0.title == "Tabs" })?.submenu)
    #expect(
      tabsMenu.items.map(\.title) == [
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
        "Last Tab",
      ])
  }

  private func assertSpacesMenu(_ menu: NSMenu?) throws {
    let spacesMenu = try #require(menu?.items.first(where: { $0.title == "Spaces" })?.submenu)
    #expect(spacesMenu.items.count == 10)
    #expect(spacesMenu.items[0].keyEquivalent == "1")
    #expect(spacesMenu.items[0].keyEquivalentModifierMask == [.control])
    #expect(spacesMenu.items[9].keyEquivalent == "0")
    #expect(spacesMenu.items[9].keyEquivalentModifierMask == [.control])
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
        "Equalize Splits",
        "",
        "Move Divider Up",
        "Move Divider Down",
        "Move Divider Left",
        "Move Divider Right",
      ])
  }
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
