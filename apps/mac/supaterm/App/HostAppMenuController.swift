import AppKit

@MainActor
final class HostAppMenuController: NSObject {
  func install() {
    let main = NSMenu()
    main.addItem(menu(title: "Supaterm", submenu: applicationMenu()))
    main.addItem(menu(title: "File", submenu: fileMenu()))
    main.addItem(menu(title: "Edit", submenu: editMenu()))
    main.addItem(menu(title: "View", submenu: viewMenu()))
    main.addItem(menu(title: "Window", submenu: windowMenu()))
    main.addItem(menu(title: "Help", submenu: helpMenu()))
    NSApp.mainMenu = main
  }

  func performKeyEquivalent(with event: NSEvent) -> Bool {
    NSApp.mainMenu?.performKeyEquivalent(with: event) == true
  }

  private func applicationMenu() -> NSMenu {
    let menu = NSMenu(title: "Supaterm")
    menu.addItem(item("About Supaterm", #selector(showAbout)))
    menu.addItem(.separator())
    menu.addItem(item("Check for Updates…", #selector(checkForUpdates)))
    menu.addItem(item("Settings…", #selector(showSettings), key: ","))
    menu.addItem(item("License…", #selector(showLicense)))
    menu.addItem(.separator())
    let services = NSMenuItem(title: "Services", action: nil, keyEquivalent: "")
    services.submenu = NSMenu(title: "Services")
    menu.addItem(services)
    NSApp.servicesMenu = services.submenu
    menu.addItem(.separator())
    menu.addItem(item("Hide Supaterm", #selector(NSApplication.hide(_:)), key: "h", target: NSApp))
    menu.addItem(
      item(
        "Hide Others",
        #selector(NSApplication.hideOtherApplications(_:)),
        key: "h",
        modifiers: [.command, .option],
        target: NSApp
      )
    )
    menu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:)), target: NSApp))
    menu.addItem(.separator())
    menu.addItem(item("Quit Supaterm", #selector(quit), key: "q"))
    menu.addItem(
      item(
        "Quit and End All Terminals",
        #selector(terminateAll),
        key: "q",
        modifiers: [.command, .option]
      )
    )
    return menu
  }

  private func fileMenu() -> NSMenu {
    let menu = NSMenu(title: "File")
    menu.addItem(item("New Tab", #selector(newTab), key: "t"))
    menu.addItem(item("New Window", #selector(newWindow), key: "n"))
    menu.addItem(.separator())
    menu.addItem(item("Close", #selector(NSWindow.performClose(_:)), key: "w", target: nil))
    menu.addItem(
      item(
        "Close All Windows",
        #selector(closeAllWindows),
        key: "w",
        modifiers: [.command, .shift]
      )
    )
    return menu
  }

  private func editMenu() -> NSMenu {
    let menu = NSMenu(title: "Edit")
    menu.addItem(item("Undo", Selector(("undo:")), key: "z", target: nil))
    menu.addItem(item("Redo", Selector(("redo:")), key: "Z", target: nil))
    menu.addItem(.separator())
    menu.addItem(item("Cut", #selector(NSText.cut(_:)), key: "x", target: nil))
    menu.addItem(item("Copy", #selector(NSText.copy(_:)), key: "c", target: nil))
    menu.addItem(item("Paste", #selector(NSText.paste(_:)), key: "v", target: nil))
    menu.addItem(item("Select All", #selector(NSText.selectAll(_:)), key: "a", target: nil))
    return menu
  }

  private func viewMenu() -> NSMenu {
    let menu = NSMenu(title: "View")
    menu.addItem(item("Toggle Visibility", #selector(toggleVisibility), key: "`"))
    menu.addItem(
      item(
        "Enter Full Screen", #selector(NSWindow.toggleFullScreen(_:)), key: "f", modifiers: [.command, .control],
        target: nil))
    return menu
  }

  private func windowMenu() -> NSMenu {
    let menu = NSMenu(title: "Window")
    menu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), key: "m", target: nil))
    menu.addItem(item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:)), target: NSApp))
    NSApp.windowsMenu = menu
    return menu
  }

  private func helpMenu() -> NSMenu {
    let menu = NSMenu(title: "Help")
    menu.addItem(item("Supaterm Help", #selector(openHelp)))
    NSApp.helpMenu = menu
    return menu
  }

  private func menu(title: String, submenu: NSMenu) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
    item.submenu = submenu
    return item
  }

  private func item(
    _ title: String,
    _ action: Selector,
    key: String = "",
    modifiers: NSEvent.ModifierFlags = [.command],
    target: AnyObject? = nil
  ) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
    item.keyEquivalentModifierMask = key.isEmpty ? [] : modifiers
    item.target = target ?? self
    return item
  }

  private var delegate: AppDelegate? {
    NSApp.delegate as? AppDelegate
  }

  @objc private func newTab() { delegate?.performNewTab() }
  @objc private func newWindow() { _ = delegate?.performNewWindow() }
  @objc private func closeAllWindows() { _ = delegate?.performCloseAllWindows() }
  @objc private func checkForUpdates() { _ = delegate?.performCheckForUpdates() }
  @objc private func showSettings() { _ = delegate?.performShowSettings(tab: .general) }
  @objc private func showLicense() { _ = delegate?.performShowSettings(tab: .license) }
  @objc private func showAbout() { _ = delegate?.performShowSettings(tab: .about) }
  @objc private func quit() { _ = delegate?.performQuit() }
  @objc private func terminateAll() { _ = delegate?.performQuitTerminatingSessions() }
  @objc private func toggleVisibility() { _ = delegate?.performToggleVisibility() }

  @objc private func openHelp() {
    guard let url = URL(string: "https://docs.supaterm.com") else { return }
    NSWorkspace.shared.open(url)
  }
}
