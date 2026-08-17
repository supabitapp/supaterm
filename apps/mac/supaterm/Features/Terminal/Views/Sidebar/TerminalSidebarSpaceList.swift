import ComposableArchitecture
import SupaTheme
import SupatermCLIShared
import SwiftUI

nonisolated struct TerminalSidebarGroupIconRequest: Hashable, Sendable {
  let workingDirectoryPathsByTab: [[String]]

  func resolve() -> URL? {
    for path in workingDirectoryPathsByTab.joined() {
      guard
        let rootPath = TerminalTabGroupTitleSuggester.repositoryRoot(for: path),
        let iconURL = SupatermProjectIconResolver.resolve(
          in: URL(fileURLWithPath: rootPath, isDirectory: true)
        )
      else {
        continue
      }
      return iconURL
    }
    return nil
  }
}

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
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let instance: TerminalSpaceInstance
  let palette: Palette
  let swipe: SpaceSwipeController
  let controllerCache: TerminalSidebarControllerCache
  let fixedHoveredGroupID: TerminalTabGroupID?

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @State private var groupIconURLs: [TerminalTabGroupID: URL] = [:]

  var body: some View {
    TerminalSidebarOutlineList(
      store: store,
      terminal: terminal,
      palette: palette,
      swipe: swipe,
      controllerCache: controllerCache,
      spaceID: instance.spaceID,
      outline: outline,
      rows: rows,
      selectedTabID: snapshot.collection.selectedTabID,
      fixedHoveredGroupID: fixedHoveredGroupID,
      reduceMotion: reduceMotion,
      actions: rowActions,
      performDrop: performDrop
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .task(id: groupIconRequests) {
      let requests = groupIconRequests
      groupIconURLs = [:]
      let icons = await Task.detached(priority: .utility) {
        requests.reduce(into: [TerminalTabGroupID: URL]()) { icons, request in
          icons[request.key] = request.value.resolve()
        }
      }.value
      guard !Task.isCancelled else { return }
      groupIconURLs = icons
    }
  }

  private var snapshot: TerminalTabSurfaceSnapshot {
    instance.tabSurfaceSnapshot
  }

  private var outline: TerminalSidebarOutline {
    TerminalSidebarOutline(snapshot: snapshot)
  }

  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] {
    var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
    let shortcutHints = tabShortcutHintsByID
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item):
        rows[.tab(item.tab.id)] = .tab(
          tabPresentation(
            item.tab,
            groupID: nil,
            rootIsPinned: item.isPinned,
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
            tabCount: group.tabs.count
          )
        )
        for tab in group.tabs {
          rows[.tab(tab.id)] = .tab(
            tabPresentation(
              tab,
              groupID: group.id,
              rootIsPinned: group.isPinned,
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

  private var groupIconRequests: [TerminalTabGroupID: TerminalSidebarGroupIconRequest] {
    Dictionary(
      uniqueKeysWithValues: snapshot.collection.rootItems.compactMap { root in
        guard case .group(let group) = root else { return nil }
        return (
          group.id,
          TerminalSidebarGroupIconRequest(
            workingDirectoryPathsByTab: group.tabs.map {
              terminal.paneWorkingDirectoryPaths(for: $0.id)
            }
          )
        )
      }
    )
  }

  private func tabPresentation(
    _ tab: TerminalTabItem,
    groupID: TerminalTabGroupID?,
    rootIsPinned: Bool,
    shortcutHints: [TerminalTabID: String]
  ) -> TerminalSidebarTabRowPresentation {
    TerminalSidebarTabRowPresentation(
      tab: tab,
      groupID: groupID,
      rootIsPinned: rootIsPinned,
      paneWorkingDirectories: terminal.paneWorkingDirectories(for: tab.id),
      unreadCount: terminal.unreadNotificationCount(for: tab.id),
      terminalProgress: terminal.sidebarTerminalProgress(for: tab.id),
      hasTerminalBell: terminal.tabHasBell(for: tab.id),
      shortcutHint: shortcutHints[tab.id],
      showsShortcutHint: commandHoldObserver.isPressed
    )
  }

  private var rowActions: TerminalSidebarRowActions {
    TerminalSidebarRowActions(
      toggleGroupCollapsed: { _ = store.send(.toggleGroupCollapsedRequested($0)) },
      createTabInGroup: createTab,
      renameGroup: { terminal.renameGroup($0, title: $1) },
      setGroupColor: { terminal.setGroupColor($0, color: $1) },
      toggleGroupPinned: { _ = store.send(.togglePinnedRootItemRequested(.group($0))) },
      ungroup: { _ = store.send(.ungroupRequested($0)) },
      closeGroup: { _ = store.send(.closeGroupRequested($0)) },
      newTab: newTab
    )
  }

  private var tabShortcutHintsByID: [TerminalTabID: String] {
    TerminalSidebarTabShortcutHints.byTabID(for: snapshot.collection.tabs) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
  }

  private func createTab(in groupID: TerminalTabGroupID) {
    _ = store.send(
      .newTabInGroupRequested(
        groupID,
        inheritingFromSurfaceID: terminal.selectedSurfaceView?.id
      )
    )
  }

  private func newTab() {
    TerminalMotion.animate(.easeInOut(duration: 0.2), reduceMotion: reduceMotion) {
      _ = store.send(
        .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
      )
    }
  }

  private func performDrop(
    _ command: TerminalSidebarDropCommand
  ) -> TerminalSidebarDropReceipt? {
    guard command.topologyStamp.spaceID == terminal.displayedSpaceID else { return nil }
    return try? TerminalSidebarDropReceipt(
      spaceID: command.topologyStamp.spaceID,
      result: terminal.move(
        TerminalTabMoveRequest(
          operationID: command.operationID,
          expectedTopologyRevision: command.topologyStamp.revision,
          itemIDs: command.itemIDs,
          destination: command.destination
        )
      )
    )
  }
}
