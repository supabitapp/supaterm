import AppKit
import GhosttyKit
import SupatermTerminalModels

extension GhosttySurfaceView {
  public override func menu(for event: NSEvent) -> NSMenu? {
    switch event.type {
    case .rightMouseDown:
      break
    case .leftMouseDown:
      if !event.modifierFlags.contains(.control) {
        return nil
      }
      guard let surface else { return nil }
      if ghostty_surface_mouse_captured(surface) {
        return nil
      }
      let mods = GhosttyKeyEvent.mods(event.modifierFlags)
      _ = ghostty_surface_mouse_button(surface, GHOSTTY_MOUSE_PRESS, GHOSTTY_MOUSE_RIGHT, mods)
    default:
      return nil
    }

    guard let surface else { return nil }
    if ghostty_surface_mouse_captured(surface) {
      return nil
    }

    return Self.contextMenu(hasSelection: ghostty_surface_has_selection(surface))
  }

  @MainActor
  public static func contextMenu(hasSelection: Bool) -> NSMenu {
    let menu = NSMenu()
    menu.automaticallyInsertsWritingToolsItems = false
    if hasSelection {
      menu.addItem(NSMenuItem(title: "Copy", action: #selector(GhosttySurfaceView.copy(_:)), keyEquivalent: ""))
    }
    menu.addItem(NSMenuItem(title: "Paste", action: #selector(GhosttySurfaceView.paste(_:)), keyEquivalent: ""))
    menu.addItem(.separator())
    menu.addItem(
      contextMenuItem(
        title: "Split Right",
        action: #selector(GhosttySurfaceView.splitRight(_:)),
        symbol: "rectangle.righthalf.inset.filled"
      ))
    menu.addItem(
      contextMenuItem(
        title: "Split Left",
        action: #selector(GhosttySurfaceView.splitLeft(_:)),
        symbol: "rectangle.leadinghalf.inset.filled"
      ))
    menu.addItem(
      contextMenuItem(
        title: "Split Down",
        action: #selector(GhosttySurfaceView.splitDown(_:)),
        symbol: "rectangle.bottomhalf.inset.filled"
      ))
    menu.addItem(
      contextMenuItem(
        title: "Split Up",
        action: #selector(GhosttySurfaceView.splitUp(_:)),
        symbol: "rectangle.tophalf.inset.filled"
      ))
    menu.addItem(
      contextMenuItem(
        title: "Close Pane",
        action: #selector(GhosttySurfaceView.closePane(_:)),
        symbol: "xmark"
      ))
    menu.addItem(.separator())
    menu.addItem(
      contextMenuItem(
        title: "Reset Terminal",
        action: #selector(GhosttySurfaceView.resetTerminal(_:)),
        symbol: "arrow.trianglehead.2.clockwise"
      ))
    menu.addItem(.separator())
    menu.addItem(
      contextMenuItem(
        title: "Change Tab Title...",
        action: #selector(GhosttySurfaceView.changeTabTitle(_:)),
        symbol: "pencil.line"
      ))
    menu.addItem(
      contextMenuItem(
        title: "Change Terminal Title...",
        action: #selector(GhosttySurfaceView.changeTitle(_:)),
        symbol: "pencil.line"
      ))
    return menu
  }

  private static func contextMenuItem(title: String, action: Selector, symbol: String) -> NSMenuItem {
    let item = NSMenuItem(title: title, action: action, keyEquivalent: "")
    item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: title)
    return item
  }

  @IBAction func splitRight(_ sender: Any?) {
    _ = bridge.onSplitAction?(.newSplit(direction: .right))
  }

  @IBAction func splitLeft(_ sender: Any?) {
    _ = bridge.onSplitAction?(.newSplit(direction: .left))
  }

  @IBAction func splitDown(_ sender: Any?) {
    _ = bridge.onSplitAction?(.newSplit(direction: .down))
  }

  @IBAction func splitUp(_ sender: Any?) {
    _ = bridge.onSplitAction?(.newSplit(direction: .up))
  }

  @IBAction func closePane(_ sender: Any?) {
    performBindingAction(SupatermCommand.closeSurface.ghosttyBindingAction)
  }

  @IBAction func resetTerminal(_ sender: Any?) {
    performBindingAction("reset")
  }

  @IBAction func changeTitle(_ sender: Any?) {
    performBindingAction("prompt_surface_title")
  }

  @IBAction func changeTabTitle(_ sender: Any?) {
    performBindingAction("prompt_tab_title")
  }

  @IBAction func copy(_ sender: Any?) {
    performBindingAction("copy_to_clipboard")
  }

  @IBAction func paste(_ sender: Any?) {
    performBindingAction("paste_from_clipboard")
  }

  @IBAction func pasteSelection(_ sender: Any?) {
    performBindingAction("paste_from_selection")
  }

  @IBAction public override func selectAll(_ sender: Any?) {
    performBindingAction("select_all")
  }
}
