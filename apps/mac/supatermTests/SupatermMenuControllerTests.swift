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

    let fileMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "File" })?.submenu)
    #expect(
      fileMenu.items.map(\.title) == [
        "New Window",
        "New Tab",
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
    #expect(fileMenu.items[2].isSeparatorItem)
    #expect(fileMenu.items[8].keyEquivalent == "w")
    #expect(fileMenu.items[8].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[8].image != nil)

    let tabsMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "Tabs" })?.submenu)
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

    let spacesMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "Spaces" })?.submenu)
    #expect(spacesMenu.items.count == 10)
    #expect(spacesMenu.items[0].keyEquivalent == "1")
    #expect(spacesMenu.items[0].keyEquivalentModifierMask == [.control])
    #expect(spacesMenu.items[9].keyEquivalent == "0")
    #expect(spacesMenu.items[9].keyEquivalentModifierMask == [.control])

    let windowMenu = try #require(app.mainMenu?.items.first(where: { $0.title == "Window" })?.submenu)
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
        keyboardShortcut: { command in
          switch command {
          case .newWindow:
            KeyboardShortcut("u", modifiers: [.command, .option])
          case .startSearch:
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
}
