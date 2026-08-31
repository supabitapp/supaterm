import SupaTheme
import SwiftUI

enum TerminalSidebarTabShortcutHints {
  static let maxVisibleShortcutCount = 10

  static func byTabID(
    for visibleTabs: [TerminalTabItem],
    shortcutForSlot: (Int) -> KeyboardShortcut?
  ) -> [TerminalTabID: String] {
    Dictionary(
      uniqueKeysWithValues:
        visibleTabs
        .prefix(maxVisibleShortcutCount)
        .enumerated()
        .compactMap { index, tab in
          let slot = index + 1
          guard let shortcut = shortcutForSlot(slot) else { return nil }
          return (tab.id, shortcut.display)
        }
    )
  }
}

struct TerminalSidebarSpaceList: View {
  let terminal: TerminalHostState
  let groupIconStore: TerminalTabGroupIconStore
  let instance: TerminalSpaceInstance
  let palette: Palette
  let swipe: SpaceSwipeController
  let controllerCache: TerminalSidebarControllerCache
  let fixedHoveredGroupID: TerminalTabGroupID?
  let shouldPlayTabMoveHaptics: Bool

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts

  var body: some View {
    let snapshot = snapshot
    let groupIconRequests = terminal.tabGroupIconRequests(for: snapshot)
    let groupIconURLs = groupIconStore.iconURLs(for: groupIconRequests)
    TerminalSidebarOutlineList(
      terminal: terminal,
      palette: palette,
      swipe: swipe,
      controllerCache: controllerCache,
      spaceID: instance.spaceID,
      tabSelectionState: instance.tabSelectionState,
      outline: TerminalSidebarOutline(snapshot: snapshot),
      rows: rows(snapshot: snapshot, groupIconURLs: groupIconURLs),
      selectedTabID: snapshot.collection.selectedTabID,
      fixedHoveredGroupID: fixedHoveredGroupID,
      reduceMotion: reduceMotion,
      shouldPlayTabMoveHaptics: shouldPlayTabMoveHaptics,
      actions: rowActions,
      performDrop: performDrop
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: groupIconRequests) {
      await groupIconStore.load(groupIconRequests)
    }
  }

  private var snapshot: TerminalTabSurfaceSnapshot {
    instance.tabSurfaceSnapshot
  }

  private func rows(
    snapshot: TerminalTabSurfaceSnapshot,
    groupIconURLs: [TerminalTabGroupID: URL]
  ) -> [TerminalSidebarEntryID: TerminalSidebarRowPresentation] {
    var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
    let chromePresentations = terminal.tabChromePresentations(for: snapshot)
    let shortcutHints = TerminalSidebarTabShortcutHints.byTabID(
      for: snapshot.collection.tabs
    ) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item):
        rows[.tab(item.tab.id)] = .tab(
          tabPresentation(
            item.tab,
            groupID: nil,
            rootIsPinned: item.isPinned,
            chromePresentation: chromePresentations[item.tab.id] ?? .empty,
            shortcutHints: shortcutHints
          )
        )
      case .group(let group):
        rows[.group(group.id)] = .group(
          TerminalSidebarGroupRowPresentation(
            id: group.id,
            title: group.title,
            color: group.color,
            iconURL: groupIconURLs[group.id],
            isPinned: group.isPinned,
            isCollapsed: snapshot.collapsedGroupIDs.contains(group.id),
            tabCount: group.tabs.count,
            showsNewTabShortcutHint: commandHoldObserver.isOptionPressed
          )
        )
        for tab in group.tabs {
          rows[.tab(tab.id)] = .tab(
            tabPresentation(
              tab,
              groupID: group.id,
              rootIsPinned: group.isPinned,
              chromePresentation: chromePresentations[tab.id] ?? .empty,
              shortcutHints: shortcutHints
            )
          )
        }
      }
    }
    let rootItems = snapshot.collection.rootItems
    if rootItems.contains(where: \.isPinned), rootItems.contains(where: { !$0.isPinned }) {
      rows[.pinDivider] = .pinDivider
    }
    rows[.newTab] = .newTab(.inline)
    return rows
  }

  private func tabPresentation(
    _ tab: TerminalTabItem,
    groupID: TerminalTabGroupID?,
    rootIsPinned: Bool,
    chromePresentation: TerminalTabChromePresentation,
    shortcutHints: [TerminalTabID: String]
  ) -> TerminalSidebarTabRowPresentation {
    TerminalSidebarTabRowPresentation(
      tab: tab,
      groupID: groupID,
      rootIsPinned: rootIsPinned,
      panes: chromePresentation.panes,
      terminalProgress: chromePresentation.progress,
      shortcutHint: shortcutHints[tab.id],
      showsShortcutHint: commandHoldObserver.isPressed
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleGroupCollapsed: { terminal.toggleGroupCollapsed($0) },
      createTabInGroup: createTab,
      renameGroup: { terminal.renameGroup($0, title: $1) },
      setGroupColor: { terminal.setGroupColor($0, color: $1) },
      toggleGroupPinned: { terminal.togglePinned(.group($0)) },
      ungroup: { terminal.ungroup($0) },
      closeGroup: { terminal.requestCloseGroup($0) },
      newTab: newTab
    )
  }

  private func createTab(in groupID: TerminalTabGroupID) {
    AppPostHog.capture("terminal_tab_created")
    _ = terminal.createTab(
      in: groupID,
      inheritingFromSurfaceID: terminal.selectedSurfaceView?.id
    )
  }

  private func newTab() {
    TerminalMotion.animate(.easeInOut(duration: 0.2), reduceMotion: reduceMotion) {
      AppPostHog.capture("terminal_tab_created")
      _ = terminal.createTab(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
    }
  }

  private func performDrop(
    _ command: TerminalSidebarDropCommand
  ) -> TerminalSidebarDropReceipt? {
    TerminalSidebarDropTransaction.commit(command, to: terminal)
  }
}
