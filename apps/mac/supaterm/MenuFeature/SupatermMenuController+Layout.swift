import AppKit

extension SupatermMenuController {
  func menuLayout() -> [SupatermMenuSectionSpec] {
    [
      appMenuLayout(),
      fileMenuLayout(),
      editMenuLayout(),
      viewMenuLayout(),
      tabsMenuLayout(),
      spacesMenuLayout(),
      windowMenuLayout(),
      helpMenuLayout(),
    ]
  }

  private func appMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: appName,
      entries: [
        .item(MenuItemIdentifier.about),
        .item(MenuItemIdentifier.settings),
        .separator,
        .item(MenuItemIdentifier.checkForUpdates),
        .separator,
        .services(title: "Services"),
        .separator,
        .system(
          title: "Hide \(appName)",
          action: #selector(NSApplication.hide(_:)),
          keyEquivalent: "h",
          modifiers: nil
        ),
        .system(
          title: "Hide Others",
          action: #selector(NSApplication.hideOtherApplications(_:)),
          keyEquivalent: "h",
          modifiers: [.command, .option]
        ),
        .system(
          title: "Show All",
          action: #selector(NSApplication.unhideAllApplications(_:)),
          keyEquivalent: "",
          modifiers: nil
        ),
        .separator,
        .item(MenuItemIdentifier.quitTerminatingSessions),
        .item(MenuItemIdentifier.quit),
      ]
    )
  }

  private func fileMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "File",
      entries: [
        .item(MenuItemIdentifier.newWindow),
        .item(MenuItemIdentifier.newTab),
        .item(MenuItemIdentifier.openCommandPalette),
        .separator,
        .item(MenuItemIdentifier.splitRight),
        .item(MenuItemIdentifier.splitLeft),
        .item(MenuItemIdentifier.splitDown),
        .item(MenuItemIdentifier.splitUp),
        .separator,
        .item(MenuItemIdentifier.closeSurface),
        .item(MenuItemIdentifier.closeTab),
        .item(MenuItemIdentifier.closeWindow),
        .item(MenuItemIdentifier.closeAllWindows),
        .separator,
        .item(MenuItemIdentifier.terminateAllTerminalSessions),
      ]
    )
  }

  private func editMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Edit",
      entries: [
        .system(title: "Undo", action: #selector(UndoManager.undo), keyEquivalent: "", modifiers: nil),
        .system(title: "Redo", action: #selector(UndoManager.redo), keyEquivalent: "", modifiers: nil),
        .separator,
        .item(MenuItemIdentifier.copy),
        .item(MenuItemIdentifier.paste),
        .item(MenuItemIdentifier.pasteSelection),
        .item(MenuItemIdentifier.selectAll),
        .separator,
        .submenu(
          title: "Find",
          entries: [
            .item(MenuItemIdentifier.find),
            .item(MenuItemIdentifier.findNext),
            .item(MenuItemIdentifier.findPrevious),
            .separator,
            .item(MenuItemIdentifier.hideFindBar),
            .separator,
            .item(MenuItemIdentifier.selectionForFind),
          ]
        ),
      ]
    )
  }

  private func viewMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "View",
      entries: [
        .item(MenuItemIdentifier.toggleSidebar),
        .item(MenuItemIdentifier.toggleAgentPanel),
        .item(MenuItemIdentifier.forkAgentSession),
        .item(MenuItemIdentifier.copyAgentSessionID),
        .separator,
        .item(MenuItemIdentifier.changeTabTitle),
        .item(MenuItemIdentifier.changeTerminalTitle),
      ]
    )
  }

  private func tabsMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Tabs",
      entries: [
        .item(MenuItemIdentifier.nextTab),
        .item(MenuItemIdentifier.previousTab),
        .separator,
        .slots(prefix: MenuItemIdentifier.selectTabPrefix),
        .item(MenuItemIdentifier.selectLastTab),
      ]
    )
  }

  private func spacesMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Spaces",
      entries: [
        .slots(prefix: MenuItemIdentifier.selectSpacePrefix)
      ]
    )
  }

  private func windowMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Window",
      entries: [
        .system(
          title: "Minimize",
          action: #selector(NSWindow.performMiniaturize(_:)),
          keyEquivalent: "m",
          modifiers: nil
        ),
        .system(title: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "", modifiers: nil),
        .separator,
        .item(MenuItemIdentifier.zoomSplit),
        .item(MenuItemIdentifier.previousSplit),
        .item(MenuItemIdentifier.nextSplit),
        .submenu(
          title: "Select Split",
          entries: [
            .item(MenuItemIdentifier.selectSplitAbove),
            .item(MenuItemIdentifier.selectSplitBelow),
            .item(MenuItemIdentifier.selectSplitLeft),
            .item(MenuItemIdentifier.selectSplitRight),
          ]
        ),
        .submenu(
          title: "Resize Split",
          entries: [
            .item(MenuItemIdentifier.equalizeSplits),
            .separator,
            .item(MenuItemIdentifier.moveSplitDividerUp),
            .item(MenuItemIdentifier.moveSplitDividerDown),
            .item(MenuItemIdentifier.moveSplitDividerLeft),
            .item(MenuItemIdentifier.moveSplitDividerRight),
          ]
        ),
        .separator,
        .system(
          title: "Bring All to Front",
          action: #selector(NSApplication.arrangeInFront(_:)),
          keyEquivalent: "",
          modifiers: nil
        ),
      ]
    )
  }

  private func helpMenuLayout() -> SupatermMenuSectionSpec {
    SupatermMenuSectionSpec(
      title: "Help",
      entries: [
        .item(MenuItemIdentifier.changelog),
        .item(MenuItemIdentifier.submitGitHubIssue),
      ]
    )
  }
}
