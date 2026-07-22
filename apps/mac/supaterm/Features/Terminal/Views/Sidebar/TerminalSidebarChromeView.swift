import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermUpdateFeature
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

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let fixedHoveredGroupID: TerminalTabGroupID?
  let dismissReleaseAnnouncement: () -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @Shared(.supatermSettings) private var supatermSettings = .default

  var body: some View {
    VStack(spacing: 10) {
      tabList
      VStack(spacing: 10) {
        if updateStore.phase.showsSidebarSection {
          TerminalSidebarUpdateSection(
            store: updateStore,
            palette: palette
          )
        }
        if let releaseAnnouncement {
          ReleaseAnnouncementCardView(
            announcement: releaseAnnouncement,
            palette: palette,
            dismiss: dismissReleaseAnnouncement
          )
        }
        TerminalSidebarSpaceBar(
          store: store,
          palette: palette,
          terminal: terminal
        )
      }
      .padding(.horizontal, 8)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }

  private var tabList: some View {
    TerminalSidebarOutlineList(
      store: store,
      terminal: terminal,
      palette: palette,
      outline: outline,
      rows: rows,
      selectedTabID: terminal.selectedTabID,
      fixedHoveredGroupID: fixedHoveredGroupID,
      reduceMotion: reduceMotion,
      actions: rowActions,
      performDrop: performDrop
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityIdentifier("sidebar.tab-outline")
  }

  private var outline: TerminalSidebarOutline {
    TerminalSidebarOutline(
      roots: terminal.rootItems.map { root in
        switch root {
        case .tab(let item):
          TerminalSidebarOutline.Root(
            content: .tab(item.tab.id),
            isPinned: item.isPinned
          )
        case .group(let group):
          TerminalSidebarOutline.Root(
            content: .group(group.id, group.color, group.lifetime, group.tabs.map(\.id)),
            isPinned: group.isPinned
          )
        }
      },
      collapsedGroupIDs: terminal.collapsedTabGroupIDs,
      topologyRevision: terminal.selectedSpaceTopologyRevision,
      spaceID: terminal.selectedSpaceID
    )
  }

  private var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] {
    var rows: [TerminalSidebarEntryID: TerminalSidebarRowPresentation] = [:]
    let shortcutHints = tabShortcutHintsByID
    for root in terminal.rootItems {
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
            isPinned: group.isPinned,
            isCollapsed: terminal.collapsedTabGroupIDs.contains(group.id),
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
    if terminal.rootItems.contains(where: \.isPinned),
      terminal.rootItems.contains(where: { !$0.isPinned })
    {
      rows[.pinDivider] = .pinDivider
    }
    rows[.newTab] = .newTab
    return rows
  }

  private func tabPresentation(
    _ tab: TerminalTabItem,
    groupID: TerminalTabGroupID?,
    rootIsPinned: Bool,
    shortcutHints: [TerminalTabID: String]
  ) -> TerminalSidebarTabRowPresentation {
    return TerminalSidebarTabRowPresentation(
      tab: tab,
      groupID: groupID,
      rootIsPinned: rootIsPinned,
      notificationPresentation: terminal.latestSidebarNotificationPresentation(for: tab.id),
      paneWorkingDirectories: terminal.paneWorkingDirectories(for: tab.id),
      unreadCount: terminal.unreadNotificationCount(for: tab.id),
      terminalProgress: terminal.sidebarTerminalProgress(for: tab.id),
      hasTerminalBell: terminal.tabHasBell(for: tab.id),
      showsAgentMarks: supatermSettings.codingAgentsShowIcons,
      showsAgentSpinner: supatermSettings.codingAgentsShowSpinner,
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
    TerminalSidebarTabShortcutHints.byTabID(for: terminal.visibleTabs) { slot in
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
    guard command.topologyStamp.spaceID == terminal.selectedSpaceID else { return nil }
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
