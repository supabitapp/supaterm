import AppKit
import Testing

@testable import supaterm

@MainActor
struct SupatermMenuControllerTests {
  @Test
  func installOwnsTheFileMenuStack() {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let (mainMenu, fileMenu) = makeMainMenu()
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    app.mainMenu = mainMenu
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()

    #expect(
      fileMenu.items.map(\.title) == [
        "New Window",
        "New Tab",
        "",
        "Close",
        "Close Tab",
        "Close Window",
        "Close All Windows",
      ])
    #expect(fileMenu.items[0].keyEquivalent == "n")
    #expect(fileMenu.items[0].keyEquivalentModifierMask == [.command])
    #expect(fileMenu.items[3].keyEquivalent == "w")
    #expect(fileMenu.items[3].keyEquivalentModifierMask == [.command])
  }

  @Test
  func installIsIdempotent() {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let (mainMenu, fileMenu) = makeMainMenu()
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    app.mainMenu = mainMenu
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()
    controller.install()

    #expect(
      fileMenu.items.map(\.title) == [
        "New Window",
        "New Tab",
        "",
        "Close",
        "Close Tab",
        "Close Window",
        "Close All Windows",
      ])
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
  func refreshRemovesBuiltInOverlapItemsInsertedAfterInstall() {
    let app = NSApplication.shared
    let previousMainMenu = app.mainMenu
    let (mainMenu, fileMenu) = makeMainMenu()
    let controller = SupatermMenuController(registry: TerminalWindowRegistry())
    app.mainMenu = mainMenu
    defer {
      app.mainMenu = previousMainMenu
    }

    controller.install()
    let newWindowItem = NSMenuItem(title: "New Supaterm Window", action: nil, keyEquivalent: "n")
    newWindowItem.keyEquivalentModifierMask = [.command]
    fileMenu.addItem(newWindowItem)
    let closeItem = NSMenuItem(
      title: "Close",
      action: #selector(NSWindow.performClose(_:)),
      keyEquivalent: "w"
    )
    closeItem.keyEquivalentModifierMask = [.command]
    fileMenu.addItem(closeItem)

    controller.refresh()

    #expect(
      fileMenu.items.map(\.title) == [
        "New Window",
        "New Tab",
        "",
        "Close",
        "Close Tab",
        "Close Window",
        "Close All Windows",
      ])
  }

  private func makeMainMenu() -> (NSMenu, NSMenu) {
    let mainMenu = NSMenu()
    let fileMenuItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
    let fileMenu = NSMenu(title: "File")
    fileMenuItem.submenu = fileMenu
    let newWindowItem = NSMenuItem(title: "New Supaterm Window", action: nil, keyEquivalent: "n")
    newWindowItem.keyEquivalentModifierMask = [.command]
    fileMenu.addItem(newWindowItem)
    fileMenu.addItem(.separator())
    let closeItem = NSMenuItem(
      title: "Close",
      action: #selector(NSWindow.performClose(_:)),
      keyEquivalent: "w"
    )
    closeItem.keyEquivalentModifierMask = [.command]
    fileMenu.addItem(closeItem)
    mainMenu.addItem(fileMenuItem)
    return (mainMenu, fileMenu)
  }
}
