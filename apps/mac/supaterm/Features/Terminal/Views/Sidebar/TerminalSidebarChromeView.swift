import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI
import Textual

private let terminalSidebarScrollSpace = "TerminalSidebarScrollSpace"
private let terminalSidebarScrollTopID = "TerminalSidebarScrollTop"
private let terminalSidebarScrollBottomID = "TerminalSidebarScrollBottom"

struct TerminalSidebarMeasuredTabFrame: Equatable {
  let zoneID: TerminalSidebarDropZoneID
  let scrollFrame: CGRect
  let zoneFrame: CGRect
}

extension TerminalSidebarDropZoneID {
  fileprivate var coordinateSpaceID: String {
    switch self {
    case .pinned:
      "TerminalSidebarPinnedZone"
    case .regular:
      "TerminalSidebarRegularZone"
    }
  }
}

private struct TerminalSidebarTabFramePreferenceKey: PreferenceKey {
  static let defaultValue: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]

  static func reduce(
    value: inout [TerminalTabID: TerminalSidebarMeasuredTabFrame],
    nextValue: () -> [TerminalTabID: TerminalSidebarMeasuredTabFrame]
  ) {
    value.merge(nextValue()) { $1 }
  }
}

private struct TerminalSidebarScrollOffsetPreferenceKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(
    value: inout CGFloat,
    nextValue: () -> CGFloat
  ) {
    value = nextValue()
  }
}

private struct TerminalSidebarContentHeightKey: PreferenceKey {
  static let defaultValue: CGFloat = 0

  static func reduce(
    value: inout CGFloat,
    nextValue: () -> CGFloat
  ) {
    value = nextValue()
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

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let dismissReleaseAnnouncement: () -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @Shared(.supatermSettings) private var supatermSettings = .default
  @StateObject private var dragSession = TerminalSidebarDragSession()
  @State private var scrollOffset: CGFloat = 0
  @State private var contentHeight: CGFloat = 0
  @State private var tabFrames: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]

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
    .onAppear {
      dragSession.colorScheme = colorScheme
      dragSession.themeID = terminal.selectedSpaceThemeID
    }
    .onChange(of: colorScheme) { _, newValue in
      dragSession.colorScheme = newValue
    }
    .onChange(of: terminal.selectedSpaceThemeID) { _, newValue in
      dragSession.themeID = newValue
    }
    .onChange(of: dragSession.pendingReorder) { _, pendingReorder in
      handle(pendingReorder)
    }
  }

  private var tabList: some View {
    GeometryReader { geometry in
      ScrollViewReader { proxy in
        ZStack {
          ScrollView(.vertical, showsIndicators: false) {
            VStack(spacing: 8) {
              Color.clear
                .frame(height: 0)
                .background {
                  GeometryReader { geometry in
                    Color.clear.preference(
                      key: TerminalSidebarScrollOffsetPreferenceKey.self,
                      value: max(0, -geometry.frame(in: .named(terminalSidebarScrollSpace)).minY)
                    )
                  }
                }
                .id(terminalSidebarScrollTopID)

              pinnedSection

              if !terminal.pinnedTabs.isEmpty {
                TerminalSidebarSectionDivider(palette: palette)
              }

              regularSection

              TerminalSidebarRegularSectionHeader(
                palette: palette,
                action: newTab
              )

              Color.clear
                .frame(height: 1)
                .id(terminalSidebarScrollBottomID)
            }
            .background {
              GeometryReader { geometry in
                Color.clear.preference(
                  key: TerminalSidebarContentHeightKey.self,
                  value: geometry.size.height
                )
              }
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 8)
          }
          .coordinateSpace(name: terminalSidebarScrollSpace)
          .onPreferenceChange(TerminalSidebarScrollOffsetPreferenceKey.self) { scrollOffset in
            self.scrollOffset = scrollOffset
          }
          .onPreferenceChange(TerminalSidebarContentHeightKey.self) { contentHeight in
            self.contentHeight = contentHeight
          }
          .onPreferenceChange(TerminalSidebarTabFramePreferenceKey.self) { tabFrames in
            self.tabFrames = tabFrames
            dragSession.updateMeasuredTabFrames(tabFrames)
          }

          if TerminalSidebarLayout.showsTopIndicator(scrollOffset: scrollOffset) {
            TerminalSidebarScrollIndicatorButton(
              symbol: "chevron.up",
              palette: palette
            ) {
              TerminalMotion.animate(
                .easeInOut(duration: 0.3),
                reduceMotion: reduceMotion
              ) {
                proxy.scrollTo(terminalSidebarScrollTopID, anchor: .top)
              }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .padding(.horizontal, 8)
            .padding(.top, 4)
          }

          if TerminalSidebarLayout.showsBottomIndicator(
            scrollOffset: scrollOffset,
            viewportHeight: geometry.size.height,
            contentHeight: contentHeight,
            selectedFrame: selectedTabFrame
          ) {
            TerminalSidebarScrollIndicatorButton(
              symbol: "chevron.down",
              palette: palette
            ) {
              scrollToBottom(using: proxy)
            }
            .frame(maxHeight: .infinity, alignment: .bottom)
            .padding(.horizontal, 8)
            .padding(.bottom, 4)
          }
        }
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }

  private var pinnedSection: some View {
    TerminalSidebarDropZoneHostView(
      zoneID: .pinned,
      manager: dragSession
    ) {
      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(Array(terminal.pinnedTabs.enumerated()), id: \.element.id) { index, tab in
          draggableRow(
            tab: tab,
            index: index,
            zoneID: .pinned
          )
        }
      }
      .coordinateSpace(name: TerminalSidebarDropZoneID.pinned.coordinateSpaceID)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(
      .top,
      TerminalSidebarLayout.sectionTopInset(
        zoneID: .pinned,
        pinnedTabCount: terminal.pinnedTabs.count
      )
    )
    .onAppear {
      dragSession.updateTabIDs(terminal.pinnedTabs.map(\.id), for: .pinned)
    }
    .onChange(of: terminal.pinnedTabs.map(\.id)) { _, tabIDs in
      dragSession.updateTabIDs(tabIDs, for: .pinned)
    }
  }

  private var regularSection: some View {
    TerminalSidebarDropZoneHostView(
      zoneID: .regular,
      manager: dragSession
    ) {
      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(Array(terminal.regularTabs.enumerated()), id: \.element.id) { index, tab in
          draggableRow(
            tab: tab,
            index: index,
            zoneID: .regular
          )
        }
      }
      .coordinateSpace(name: TerminalSidebarDropZoneID.regular.coordinateSpaceID)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .padding(
      .top,
      TerminalSidebarLayout.sectionTopInset(
        zoneID: .regular,
        pinnedTabCount: terminal.pinnedTabs.count
      )
    )
    .onAppear {
      dragSession.updateTabIDs(terminal.regularTabs.map(\.id), for: .regular)
    }
    .onChange(of: terminal.regularTabs.map(\.id)) { _, tabIDs in
      dragSession.updateTabIDs(tabIDs, for: .regular)
    }
  }

  @ViewBuilder
  private func draggableRow(
    tab: TerminalTabItem,
    index: Int,
    zoneID: TerminalSidebarDropZoneID
  ) -> some View {
    let notificationPresentation = terminal.latestSidebarNotificationPresentation(for: tab.id)
    let paneWorkingDirectories = terminal.paneWorkingDirectories(for: tab.id)
    let unreadCount = terminal.unreadNotificationCount(for: tab.id)
    let terminalProgress = terminal.sidebarTerminalProgress(for: tab.id)
    let agentPresentation = terminal.tabAgentPresentation(for: tab.id)
    let hasTerminalBell = terminal.tabHasBell(for: tab.id)
    let preview = TerminalSidebarDragPreviewItem(
      tab: tab,
      notificationPreviewMarkdown: notificationPresentation?.previewMarkdown,
      paneWorkingDirectories: paneWorkingDirectories,
      unreadCount: unreadCount,
      badgeActivities: agentPresentation.badgeActivities,
      badgeActivity: agentPresentation.badgeActivity,
      badgeActivityIsFocused: agentPresentation.badgeActivityIsFocused,
      terminalProgress: terminalProgress,
      hasTerminalBell: hasTerminalBell,
      showsAgentMarks: supatermSettings.codingAgentsShowIcons,
      showsAgentSpinner: supatermSettings.codingAgentsShowSpinner
    )

    TerminalSidebarDragSourceView(
      item: TerminalSidebarDragItem(
        tabID: tab.id
      ),
      preview: preview,
      zoneID: zoneID,
      index: index,
      manager: dragSession
    ) {
      TerminalSidebarTabRow(
        store: store,
        terminal: terminal,
        tab: tab,
        notificationPresentation: notificationPresentation,
        paneWorkingDirectories: paneWorkingDirectories,
        unreadCount: unreadCount,
        terminalProgress: terminalProgress,
        hasTerminalBell: hasTerminalBell,
        palette: palette,
        showsAgentMarks: supatermSettings.codingAgentsShowIcons,
        showsAgentSpinner: supatermSettings.codingAgentsShowSpinner,
        shortcutHint: tabShortcutHintsByID[tab.id],
        showsShortcutHint: commandHoldObserver.isPressed
      )
      .id(tab.id)
      .background {
        GeometryReader { geometry in
          let measuredFrame = TerminalSidebarMeasuredTabFrame(
            zoneID: zoneID,
            scrollFrame: geometry.frame(in: .named(terminalSidebarScrollSpace)),
            zoneFrame: geometry.frame(in: .named(zoneID.coordinateSpaceID))
          )
          Color.clear.preference(
            key: TerminalSidebarTabFramePreferenceKey.self,
            value: [tab.id: measuredFrame]
          )
        }
      }
      .opacity(dragSession.draggedItem?.tabID == tab.id ? 0 : 1)
      .offset(y: dragSession.reorderOffset(for: zoneID, tabID: tab.id))
      .terminalAnimation(
        .spring(response: 0.3, dampingFraction: 0.8),
        value: dragSession.insertionIndex[zoneID],
        reduceMotion: reduceMotion
      )
    }
  }

  private var selectedTabFrame: CGRect? {
    guard let selectedTabID = terminal.selectedTabID else { return nil }
    return tabFrames[selectedTabID]?.scrollFrame
  }

  private var tabShortcutHintsByID: [TerminalTabID: String] {
    TerminalSidebarTabShortcutHints.byTabID(for: terminal.visibleTabs) { slot in
      ghosttyShortcuts.keyboardShortcut(for: .goToTab(slot))
    }
  }

  private func newTab() {
    TerminalMotion.animate(.easeInOut(duration: 0.2), reduceMotion: reduceMotion) {
      _ = store.send(
        .newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)
      )
    }
  }

  private func scrollToBottom(
    using proxy: ScrollViewProxy
  ) {
    TerminalMotion.animate(.easeInOut(duration: 0.3), reduceMotion: reduceMotion) {
      if let selectedTabID = terminal.selectedTabID {
        proxy.scrollTo(selectedTabID, anchor: .bottom)
      } else {
        proxy.scrollTo(terminalSidebarScrollBottomID, anchor: .bottom)
      }
    }
  }

  private func handle(
    _ pendingReorder: TerminalSidebarPendingReorder?
  ) {
    guard let pendingReorder else { return }

    switch (pendingReorder.sourceZone, pendingReorder.targetZone) {
    case (.pinned, .pinned):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        terminal.pinnedTabs.map(\.id),
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != terminal.pinnedTabs.map(\.id) {
        _ = store.send(.pinnedTabOrderChanged(reorderedIDs))
      }

    case (.regular, .regular):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        terminal.regularTabs.map(\.id),
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != terminal.regularTabs.map(\.id) {
        _ = store.send(.regularTabOrderChanged(reorderedIDs))
      }

    case (.regular, .pinned):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: terminal.pinnedTabs.map(\.id),
            at: pendingReorder.toIndex
          ),
          regularOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: terminal.regularTabs.map(\.id)
          )
        )
      )

    case (.pinned, .regular):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: terminal.pinnedTabs.map(\.id)
          ),
          regularOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: terminal.regularTabs.map(\.id),
            at: pendingReorder.toIndex
          )
        )
      )
    }

    dragSession.pendingReorder = nil
  }
}

private struct TerminalSidebarSectionDivider: View {
  let palette: Palette

  var body: some View {
    RoundedRectangle(cornerRadius: 100, style: .continuous)
      .fill(palette.divider)
      .frame(height: 1)
  }
}

private struct TerminalSidebarRegularSectionHeader: View {
  let palette: Palette
  let action: () -> Void

  var body: some View {
    Button(action: action) {
      HStack(spacing: 8) {
        Image(systemName: "plus")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 18, height: 18)
          .foregroundStyle(palette.secondaryText)
          .accessibilityHidden(true)

        Text("New Tab")
          .font(.system(size: 13, weight: .medium))
          .foregroundStyle(palette.primaryText)

        Spacer(minLength: 0)
      }
      .padding(.horizontal, 10)
      .frame(height: 36)
    }
    .buttonStyle(TerminalSidebarButtonStyle(layout: .rect))
  }
}

private struct TerminalSidebarScrollIndicatorButton: View {
  let symbol: String
  let palette: Palette
  let action: () -> Void

  var body: some View {
    HStack {
      RoundedRectangle(cornerRadius: 100, style: .continuous)
        .fill(palette.secondaryText.opacity(0.14))
        .frame(height: 1)

      Button(action: action) {
        Image(systemName: symbol)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .frame(width: 24, height: 24)
          .background(palette.detailBackground.opacity(0.92), in: Circle())
          .accessibilityHidden(true)
          .overlay {
            Circle()
              .stroke(palette.detailStroke, lineWidth: 1)
          }
      }
      .buttonStyle(.plain)
    }
    .padding(.horizontal, 8)
  }
}
