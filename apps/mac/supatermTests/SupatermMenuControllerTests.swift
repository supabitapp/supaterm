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

  private func makeMainMenu() -> (NSMenu, NSMenu) {
    let mainMenu = NSMenu()
    let fileMenuItem = NSMenuItem(title: "File", action: nil, keyEquivalent: "")
    let fileMenu = NSMenu(title: "File")
    fileMenuItem.submenu = fileMenu
    fileMenu.addItem(NSMenuItem(title: "New Window", action: nil, keyEquivalent: ""))
    fileMenu.addItem(.separator())
    fileMenu.addItem(
      NSMenuItem(
        title: "Close",
        action: #selector(NSWindow.performClose(_:)),
        keyEquivalent: "w"
      )
    )
    mainMenu.addItem(fileMenuItem)
    return (mainMenu, fileMenu)
  }
}
