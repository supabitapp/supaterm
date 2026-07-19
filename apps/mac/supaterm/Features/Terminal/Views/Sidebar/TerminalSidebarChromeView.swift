import AppKit
import ComposableArchitecture
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

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

struct TerminalSidebarProjectGroup: Equatable, Identifiable {
  let spaceID: TerminalSpaceID
  let project: TerminalProjectItem
  let displayName: String
  let pinnedTabs: [TerminalTabItem]
  let regularTabs: [TerminalTabItem]
  let isCollapsed: Bool

  var id: TerminalProjectID {
    project.id
  }

  var showsDivider: Bool {
    !isCollapsed && !pinnedTabs.isEmpty && !regularTabs.isEmpty
  }

  var showsEmptyState: Bool {
    !isCollapsed && pinnedTabs.isEmpty && regularTabs.isEmpty
  }

  var showsTabSections: Bool {
    !isCollapsed && (!pinnedTabs.isEmpty || !regularTabs.isEmpty)
  }

  init(
    spaceID: TerminalSpaceID,
    project: TerminalProjectItem,
    displayName: String,
    pinnedTabs: [TerminalTabItem],
    regularTabs: [TerminalTabItem],
    isCollapsed: Bool
  ) {
    self.spaceID = spaceID
    self.project = project
    self.displayName = displayName
    self.pinnedTabs = pinnedTabs
    self.regularTabs = regularTabs
    self.isCollapsed = isCollapsed
  }
}

private struct TerminalSidebarProjectDeletion: Equatable {
  let projectID: TerminalProjectID
  let spaceID: TerminalSpaceID
}

struct TerminalSidebarChromeView: View {
  let store: StoreOf<TerminalWindowFeature>
  let updateStore: StoreOf<UpdateFeature>
  let releaseAnnouncement: ReleaseAnnouncement?
  let palette: Palette
  let terminal: TerminalHostState
  let dismissReleaseAnnouncement: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(GhosttyShortcutManager.self) private var ghosttyShortcuts
  @State private var scrollOffset: CGFloat = 0
  @State private var contentHeight: CGFloat = 0
  @State private var tabFrames: [TerminalTabID: TerminalSidebarMeasuredTabFrame] = [:]
  @State private var pendingProjectDeletion: TerminalSidebarProjectDeletion?

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
    .alert(
      "Delete \(pendingProjectName)?",
      isPresented: projectDeletionIsPresented
    ) {
      Button("Delete Project", role: .destructive, action: deletePendingProject)
      Button("Cancel", role: .cancel) {
        pendingProjectDeletion = nil
      }
    } message: {
      Text("All tabs in this project will be closed.")
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

              projectTopBar

              ForEach(projectGroups) { group in
                TerminalSidebarProjectSection(
                  group: group,
                  store: store,
                  terminal: terminal,
                  palette: palette,
                  shortcutHintsByTabID: tabShortcutHintsByID,
                  requestDeletion: requestDeletion
                )
              }

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
            .padding(.horizontal, 4)
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

  private var projectGroups: [TerminalSidebarProjectGroup] {
    guard let spaceID = terminal.selectedSpaceID else { return [] }
    let pinnedTabs = terminal.pinnedTabs
    let regularTabs = terminal.regularTabs
    return terminal.orderedProjects(in: spaceID).map { project in
      TerminalSidebarProjectGroup(
        spaceID: spaceID,
        project: project,
        displayName: terminal.projectDisplayName(project.id, in: spaceID) ?? project.baseDisplayName,
        pinnedTabs: pinnedTabs.filter { $0.projectID == project.id },
        regularTabs: regularTabs.filter { $0.projectID == project.id },
        isCollapsed: terminal.isProjectCollapsed(project.id, in: spaceID)
      )
    }
  }

  private var projectTopBar: some View {
    HStack {
      Spacer(minLength: 0)
      Button(action: addProject) {
        Image(systemName: "folder.badge.plus")
          .font(.system(size: 12, weight: .semibold))
          .frame(width: 24, height: 24)
      }
      .buttonStyle(TerminalSidebarButtonStyle(palette: palette, layout: .icon))
      .foregroundStyle(palette.primaryText)
      .disabled(terminal.selectedSpaceID == nil)
      .accessibilityLabel("Add Project")
      .accessibilityIdentifier("sidebar.add-project-button")
      .help("Add Project")
    }
    .padding(.horizontal, 4)
    .padding(.top, TerminalSidebarLayout.trafficLightTopPadding)
    .frame(height: TerminalSidebarLayout.firstVisibleSectionTopInset, alignment: .top)
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

  private var projectDeletionIsPresented: Binding<Bool> {
    Binding(
      get: { pendingProjectDeletion != nil },
      set: { isPresented in
        if !isPresented {
          pendingProjectDeletion = nil
        }
      }
    )
  }

  private var pendingProjectName: String {
    guard let pendingProjectDeletion else { return "Project" }
    return terminal.projectDisplayName(
      pendingProjectDeletion.projectID,
      in: pendingProjectDeletion.spaceID
    ) ?? "Project"
  }

  private func addProject() {
    guard let spaceID = terminal.selectedSpaceID else { return }
    let panel = NSOpenPanel()
    panel.canChooseDirectories = true
    panel.canChooseFiles = false
    panel.allowsMultipleSelection = false
    panel.canCreateDirectories = true
    panel.prompt = "Add Project"
    guard panel.runModal() == .OK, let directory = panel.url else { return }
    terminal.createProject(
      folderPath: directory.path(percentEncoded: false),
      in: spaceID
    )
  }

  private func requestDeletion(
    projectID: TerminalProjectID,
    spaceID: TerminalSpaceID
  ) {
    pendingProjectDeletion = TerminalSidebarProjectDeletion(
      projectID: projectID,
      spaceID: spaceID
    )
  }

  private func deletePendingProject() {
    guard let pendingProjectDeletion else { return }
    terminal.deleteProject(
      pendingProjectDeletion.projectID,
      in: pendingProjectDeletion.spaceID
    )
    self.pendingProjectDeletion = nil
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

}

private struct TerminalSidebarSectionDivider: View {
  let palette: Palette

  var body: some View {
    RoundedRectangle(cornerRadius: 100, style: .continuous)
      .fill(palette.sidebarSeparator)
      .frame(height: 1)
  }
}

struct TerminalSidebarProjectHeader: View {
  enum ContextMenuItem: Equatable {
    case newTab
    case togglePinned(Bool)
    case divider
    case delete

    var title: String? {
      switch self {
      case .newTab:
        "New Tab"
      case .togglePinned(let isPinned):
        isPinned ? "Unpin Project" : "Pin Project"
      case .divider:
        nil
      case .delete:
        "Delete Project..."
      }
    }
  }

  let project: TerminalProjectItem
  let displayName: String
  let isCollapsed: Bool
  let palette: Palette
  let toggleCollapsed: () -> Void
  let newTab: () -> Void
  let togglePinned: () -> Void
  let delete: () -> Void

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false

  static func contextMenuItems(
    isHome: Bool,
    isPinned: Bool
  ) -> [ContextMenuItem] {
    var items: [ContextMenuItem] = [
      .newTab,
      .togglePinned(isPinned),
    ]
    if !isHome {
      items.append(contentsOf: [.divider, .delete])
    }
    return items
  }

  var body: some View {
    ZStack(alignment: .trailing) {
      Button(action: toggleCollapsed) {
        HStack(spacing: 7) {
          Image(systemName: "chevron.down")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(palette.secondaryText)
            .frame(width: 12, height: 18)
            .rotationEffect(.degrees(isCollapsed ? -90 : 0))
            .terminalAnimation(
              .easeInOut(duration: 0.16),
              value: isCollapsed,
              reduceMotion: reduceMotion
            )
            .accessibilityHidden(true)

          Image(systemName: project.isHome ? "house" : "folder")
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(palette.secondaryText)
            .frame(width: 15, height: 18)
            .accessibilityHidden(true)

          Text(displayName)
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(palette.primaryText)
            .lineLimit(1)

          Spacer(minLength: 28)
        }
        .padding(.horizontal, 8)
        .frame(height: TerminalSidebarLayout.tabRowMinHeight)
        .frame(maxWidth: .infinity)
      }
      .buttonStyle(
        SelectableRowButtonStyle(
          palette: palette,
          isSelected: false,
          isHovering: isHovering,
          cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
          appearance: .sidebar,
          showsSelectionEdge: false
        )
      )
      .accessibilityLabel("\(isCollapsed ? "Expand" : "Collapse") \(displayName)")

      if isHovering {
        Button(action: newTab) {
          Image(systemName: "plus")
            .font(.system(size: 11, weight: .semibold))
            .frame(width: 22, height: 22)
        }
        .buttonStyle(.plain)
        .foregroundStyle(palette.secondaryText)
        .padding(.trailing, 4)
        .accessibilityLabel("New Tab in \(displayName)")
        .help("New Tab")
      }
    }
    .onHover { isHovering = $0 }
    .contextMenu {
      ForEach(
        Array(
          Self.contextMenuItems(
            isHome: project.isHome,
            isPinned: project.isPinned
          ).enumerated()
        ),
        id: \.offset
      ) { _, item in
        switch item {
        case .newTab:
          Button(action: newTab) {
            Label("New Tab", systemImage: "plus")
          }

        case .togglePinned(let isPinned):
          Button(action: togglePinned) {
            Label(
              isPinned ? "Unpin Project" : "Pin Project",
              systemImage: isPinned ? "pin.slash" : "pin"
            )
          }

        case .divider:
          Divider()

        case .delete:
          Button(role: .destructive, action: delete) {
            Label("Delete Project...", systemImage: "trash")
          }
        }
      }
    }
    .accessibilityIdentifier("sidebar.project-header")
  }
}

private struct TerminalSidebarProjectSection: View {
  let group: TerminalSidebarProjectGroup
  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let palette: Palette
  let shortcutHintsByTabID: [TerminalTabID: String]
  let requestDeletion: (TerminalProjectID, TerminalSpaceID) -> Void

  @Environment(CommandHoldObserver.self) private var commandHoldObserver
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.colorScheme) private var colorScheme
  @Shared(.supatermSettings) private var supatermSettings = .default
  @StateObject private var dragSession = TerminalSidebarDragSession()

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      TerminalSidebarProjectHeader(
        project: group.project,
        displayName: group.displayName,
        isCollapsed: group.isCollapsed,
        palette: palette,
        toggleCollapsed: toggleCollapsed,
        newTab: newTab,
        togglePinned: togglePinned,
        delete: {
          requestDeletion(group.project.id, group.spaceID)
        }
      )

      if group.showsEmptyState {
        TerminalSidebarEmptyProjectRow(palette: palette)
          .padding(.leading, 14)
      } else if group.showsTabSections {
        VStack(spacing: 4) {
          if !group.pinnedTabs.isEmpty {
            tabSection(group.pinnedTabs, zoneID: .pinned)
          }

          if group.showsDivider {
            TerminalSidebarSectionDivider(palette: palette)
              .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
          }

          if !group.regularTabs.isEmpty {
            tabSection(group.regularTabs, zoneID: .regular)
          }
        }
        .padding(.leading, 14)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier("sidebar.project-group")
    .onAppear {
      dragSession.colorScheme = colorScheme
      updateDragTabIDs()
    }
    .onChange(of: colorScheme) { _, colorScheme in
      dragSession.colorScheme = colorScheme
    }
    .onChange(of: group.pinnedTabs.map(\.id)) { _, _ in
      updateDragTabIDs()
    }
    .onChange(of: group.regularTabs.map(\.id)) { _, _ in
      updateDragTabIDs()
    }
    .onPreferenceChange(TerminalSidebarTabFramePreferenceKey.self) { tabFrames in
      dragSession.updateMeasuredTabFrames(tabFrames)
    }
    .onChange(of: dragSession.pendingReorder) { _, pendingReorder in
      handle(pendingReorder)
    }
  }

  private func tabSection(
    _ tabs: [TerminalTabItem],
    zoneID: TerminalSidebarDropZoneID
  ) -> some View {
    TerminalSidebarDropZoneHostView(
      zoneID: zoneID,
      manager: dragSession
    ) {
      VStack(spacing: TerminalSidebarLayout.tabRowSpacing) {
        ForEach(Array(tabs.enumerated()), id: \.element.id) { index, tab in
          draggableRow(
            tab: tab,
            index: index,
            zoneID: zoneID
          )
        }
      }
      .coordinateSpace(name: zoneID.coordinateSpaceID)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .accessibilityElement(children: .contain)
    .accessibilityIdentifier(
      zoneID == .pinned
        ? "sidebar.project-pinned-section"
        : "sidebar.project-regular-section"
    )
  }

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
      notificationPreviewText: notificationPresentation?.previewText,
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

    return TerminalSidebarDragSourceView(
      item: TerminalSidebarDragItem(tabID: tab.id),
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
        shortcutHint: shortcutHintsByTabID[tab.id],
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

  private func toggleCollapsed() {
    TerminalMotion.animate(.easeInOut(duration: 0.16), reduceMotion: reduceMotion) {
      terminal.setProjectCollapsed(
        !group.isCollapsed,
        projectID: group.project.id,
        in: group.spaceID
      )
    }
  }

  private func newTab() {
    _ = terminal.createTab(
      projectID: group.project.id,
      workingDirectoryPath: group.project.folderPath
    )
  }

  private func togglePinned() {
    terminal.toggleProjectPinned(group.project.id, in: group.spaceID)
  }

  private func updateDragTabIDs() {
    dragSession.updateTabIDs(group.pinnedTabs.map(\.id), for: .pinned)
    dragSession.updateTabIDs(group.regularTabs.map(\.id), for: .regular)
  }

  private func handle(
    _ pendingReorder: TerminalSidebarPendingReorder?
  ) {
    guard let pendingReorder else { return }
    let pinnedIDs = group.pinnedTabs.map(\.id)
    let regularIDs = group.regularTabs.map(\.id)

    switch (pendingReorder.sourceZone, pendingReorder.targetZone) {
    case (.pinned, .pinned):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        pinnedIDs,
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != pinnedIDs {
        _ = store.send(.pinnedTabOrderChanged(reorderedIDs))
      }

    case (.regular, .regular):
      let reorderedIDs = TerminalSidebarLayout.reorderedIDs(
        regularIDs,
        movingFrom: pendingReorder.fromIndex,
        to: pendingReorder.toIndex
      )
      if reorderedIDs != regularIDs {
        _ = store.send(.regularTabOrderChanged(reorderedIDs))
      }

    case (.regular, .pinned):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: pinnedIDs,
            at: pendingReorder.toIndex
          ),
          regularOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: regularIDs
          )
        )
      )

    case (.pinned, .regular):
      _ = store.send(
        .sidebarTabMoveCommitted(
          tabID: pendingReorder.item.tabID,
          pinnedOrder: TerminalSidebarLayout.removingID(
            pendingReorder.item.tabID,
            from: pinnedIDs
          ),
          regularOrder: TerminalSidebarLayout.insertingID(
            pendingReorder.item.tabID,
            into: regularIDs,
            at: pendingReorder.toIndex
          )
        )
      )
    }

    dragSession.pendingReorder = nil
  }
}

private struct TerminalSidebarEmptyProjectRow: View {
  let palette: Palette

  var body: some View {
    Text("No tabs")
      .font(.system(size: 12, weight: .regular))
      .foregroundStyle(palette.secondaryText)
      .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
      .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      .frame(maxWidth: .infinity, alignment: .leading)
      .accessibilityIdentifier("sidebar.project-empty-row")
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
