import AppKit

@MainActor
enum TerminalHorizontalTabContextMenu {
  static func menu(
    for entryID: TerminalSidebarEntryID,
    snapshot: TerminalTabSurfaceSnapshot,
    surface: TerminalHorizontalTabSurfacePresentation,
    terminal: TerminalHostState,
    selectionState: TerminalTabSelectionState? = nil
  ) -> NSMenu? {
    let contextualTabIDs: [TerminalTabID] =
      switch entryID {
      case .tab(let tabID):
        selectionState?.contextualTabIDs(
          for: tabID,
          primaryTabID: snapshot.collection.selectedTabID,
          visibleTabIDs: TerminalSidebarOutline(snapshot: snapshot).visibleTabIDs
        ) ?? [tabID]
      case .group, .newTab, .pinDivider:
        []
      }
    let paneCount =
      switch entryID {
      case .tab(let tabID): surface.tabsByID[tabID]?.panes.count ?? 0
      case .group, .newTab, .pinDivider: 0
      }
    guard
      let model = TerminalTabContextMenuModel.menu(
        for: entryID,
        contextualTabIDs: contextualTabIDs,
        snapshot: snapshot,
        paneCount: paneCount,
        layout: .horizontal
      )
    else { return nil }
    let dispatcher = TerminalTabContextMenuDispatcher(
      terminal: terminal,
      beginGroupRename: { groupID, _ in
        terminal.promptGroupTitle(groupID)
      }
    )
    return NSMenu(model: model, dispatcher: dispatcher)
  }
}

@MainActor
private final class TerminalHorizontalTabMenuAction: NSObject {
  private let handler: () -> Void

  init(handler: @escaping () -> Void) {
    self.handler = handler
    super.init()
  }

  @objc func performAction() {
    handler()
  }
}

@MainActor
extension NSMenu {
  fileprivate convenience init(
    model: TerminalTabContextMenuModel,
    dispatcher: TerminalTabContextMenuDispatcher
  ) {
    self.init()
    for item in model.items {
      switch item {
      case .action(let action):
        addAction(action, dispatcher: dispatcher)
      case .submenu(let submenu):
        addItem(NSMenuItem(submenu: submenu, dispatcher: dispatcher))
      case .separator:
        addItem(.separator())
      }
    }
  }

  @discardableResult
  fileprivate func addAction(
    _ action: TerminalTabContextMenuActionItem,
    dispatcher: TerminalTabContextMenuDispatcher
  ) -> NSMenuItem {
    let target = TerminalHorizontalTabMenuAction {
      dispatcher.perform(action.action)
    }
    let item = NSMenuItem(
      title: action.title,
      action: #selector(TerminalHorizontalTabMenuAction.performAction),
      keyEquivalent: ""
    )
    item.target = target
    item.representedObject = target
    item.isEnabled = action.isEnabled
    item.state =
      switch action.state {
      case .off: .off
      case .on: .on
      case .mixed: .mixed
      }
    item.image = action.symbol.flatMap {
      NSImage(systemSymbolName: $0, accessibilityDescription: nil)
    }
    addItem(item)
    return item
  }
}

@MainActor
extension NSMenuItem {
  fileprivate convenience init(
    submenu: TerminalTabContextSubmenu,
    dispatcher: TerminalTabContextMenuDispatcher
  ) {
    self.init(title: submenu.title, action: nil, keyEquivalent: "")
    image = NSImage(systemSymbolName: submenu.symbol, accessibilityDescription: nil)
    let menu = NSMenu()
    for action in submenu.items {
      menu.addAction(action, dispatcher: dispatcher)
    }
    self.submenu = menu
    isEnabled = submenu.isEnabled
  }
}

@MainActor
extension NSMenu {
  @discardableResult
  func addAction(
    title: String,
    symbol: String? = nil,
    isEnabled: Bool = true,
    handler: @escaping () -> Void
  ) -> NSMenuItem {
    let target = TerminalHorizontalTabMenuAction(handler: handler)
    let item = NSMenuItem(
      title: title,
      action: #selector(TerminalHorizontalTabMenuAction.performAction),
      keyEquivalent: ""
    )
    item.target = target
    item.representedObject = target
    item.isEnabled = isEnabled
    item.image = symbol.flatMap {
      NSImage(systemSymbolName: $0, accessibilityDescription: nil)
    }
    addItem(item)
    return item
  }
}
