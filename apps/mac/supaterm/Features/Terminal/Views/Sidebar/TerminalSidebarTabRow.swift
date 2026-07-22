import AppKit
import ComposableArchitecture
import SupaTheme
import SwiftUI

struct TerminalSidebarTabRow: View {
  enum ContextMenuItem: Equatable {
    case newTab
    case divider
    case togglePinned(Bool)
    case moveToNewGroup
    case moveToGroup
    case removeFromGroup
    case changeTabTitle
    case closeTabsBelow(Bool)
    case closeOtherTabs(Bool)
    case close

    var title: String? {
      switch self {
      case .newTab:
        "New Tab"
      case .divider:
        nil
      case .togglePinned(let isPinned):
        isPinned ? "Unpin Tab" : "Pin Tab"
      case .moveToNewGroup:
        "Move to New Group"
      case .moveToGroup:
        "Move to Group..."
      case .removeFromGroup:
        "Remove from Group"
      case .changeTabTitle:
        "Change Tab Title..."
      case .closeTabsBelow:
        "Close All Below"
      case .closeOtherTabs:
        "Close Others"
      case .close:
        "Close"
      }
    }
  }

  enum CloseButtonPresentation: Equatable {
    case hidden
    case enabled
  }

  private struct AnimatedPresentation: Equatable {
    let badgeActivities: [TerminalHostState.AgentActivity]
    let badgeActivity: TerminalHostState.AgentActivity?
    let hasTerminalBell: Bool
    let notificationPreviewText: String?
    let paneWorkingDirectories: [String]
    let showsAgentMarks: Bool
    let showsAgentSpinner: Bool
    let terminalProgress: TerminalSidebarTerminalProgress?
    let unreadCount: Int

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.badgeActivities == rhs.badgeActivities
        && lhs.badgeActivity == rhs.badgeActivity
        && lhs.hasTerminalBell == rhs.hasTerminalBell
        && lhs.notificationPreviewText == rhs.notificationPreviewText
        && lhs.paneWorkingDirectories == rhs.paneWorkingDirectories
        && lhs.showsAgentMarks == rhs.showsAgentMarks
        && lhs.showsAgentSpinner == rhs.showsAgentSpinner
        && lhs.terminalProgress == rhs.terminalProgress
        && lhs.unreadCount == rhs.unreadCount
    }
  }

  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tab: TerminalTabItem
  let groupID: TerminalTabGroupID?
  let rootIsPinned: Bool
  let renameState: TerminalSidebarRenameState?
  let selectionState: TerminalSidebarTabSelectionState
  let outline: TerminalSidebarOutline
  let notificationPresentation: TerminalHostState.SidebarNotificationPresentation?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let terminalProgress: TerminalSidebarTerminalProgress?
  let hasTerminalBell: Bool
  let palette: Palette
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let shortcutHint: String?
  let showsShortcutHint: Bool

  static func contextMenuItems(
    isPinned: Bool,
    hasTabsBelow: Bool,
    hasOtherTabs: Bool,
    isGrouped: Bool = false
  ) -> [ContextMenuItem] {
    var items: [ContextMenuItem] = [
      .newTab,
      .divider,
    ]
    items.append(contentsOf: [
      .togglePinned(isPinned),
      .moveToNewGroup,
      .moveToGroup,
    ])
    if isGrouped {
      items.append(.removeFromGroup)
    }
    items.append(.changeTabTitle)
    items.append(contentsOf: [
      .divider,
      .closeTabsBelow(hasTabsBelow),
      .closeOtherTabs(hasOtherTabs),
      .divider,
      .close,
    ])
    return items
  }

  static func closeButtonPresentation(
    isHovering: Bool,
    showsShortcutHint: Bool
  ) -> CloseButtonPresentation {
    guard isHovering, !showsShortcutHint else { return .hidden }
    return .enabled
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false
  @State private var isCloseHovering = false

  private var selectionStyle: TerminalSidebarTabSelectionStyle {
    selectionState.style(for: tab.id, primaryTabID: terminal.selectedTabID)
  }

  private var isPrimarySelected: Bool {
    selectionStyle == .primary
  }

  private var isSelected: Bool {
    selectionStyle != .none
  }

  private var agentPresentation: TerminalHostState.TabAgentPresentation {
    terminal.tabAgentPresentation(for: tab.id)
  }

  private var contextSurfaceID: UUID? {
    terminal.contextSurfaceID(for: tab.id)
  }

  private var hasTabsBelow: Bool {
    guard let index = terminal.tabs.firstIndex(where: { $0.id == tab.id }) else { return false }
    return terminal.tabs.index(after: index) < terminal.tabs.endIndex
  }

  private var hasOtherTabs: Bool {
    terminal.tabs.contains { $0.id != tab.id }
  }

  var body: some View {
    Button(action: select) {
      HStack(spacing: 8) {
        let summary = TerminalSidebarTabSummaryView(
          tab: tab,
          palette: palette,
          isSelected: isPrimarySelected,
          isPinned: groupID == nil && rootIsPinned,
          notificationPreviewText: notificationPresentation?.previewText,
          paneWorkingDirectories: paneWorkingDirectories,
          unreadCount: unreadCount,
          badgeActivities: agentPresentation.badgeActivities,
          badgeActivity: agentPresentation.badgeActivity,
          badgeActivityIsFocused: agentPresentation.badgeActivityIsFocused,
          hasTerminalBell: hasTerminalBell,
          terminalProgress: terminalProgress,
          showsAgentMarks: showsAgentMarks,
          showsAgentSpinner: showsAgentSpinner,
          shortcutHint: shortcutHint,
          showsShortcutHint: showsShortcutHint,
          isRowHovering: isHovering
        )
        .lineLimit(8)
        if let helpText = TerminalSidebarTabSummaryView.helpText(
          paneWorkingDirectories: paneWorkingDirectories
        ) {
          summary.help(helpText)
        } else {
          summary
        }

        let closeButtonPresentation = Self.closeButtonPresentation(
          isHovering: isHovering,
          showsShortcutHint: showsShortcutHint
        )
        if closeButtonPresentation != .hidden {
          Button(action: close) {
            Image(systemName: "xmark")
              .font(.system(size: 12, weight: .heavy))
              .foregroundStyle(isPrimarySelected ? palette.selectedText : palette.sidebarTabTitle)
              .frame(width: 24, height: 24)
              .accessibilityHidden(true)
              .background(
                isCloseHovering
                  ? (isPrimarySelected ? palette.selectedPillFill : palette.unselectedFill)
                  : .clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
              )
          }
          .buttonStyle(.plain)
          .onHover { isCloseHovering = $0 }
        }
      }
      .padding(.horizontal, TerminalSidebarLayout.rowHorizontalPadding)
      .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
      .frame(minHeight: TerminalSidebarLayout.tabRowMinHeight)
      .frame(maxWidth: .infinity)
    }
    .buttonStyle(
      SelectableRowButtonStyle(
        palette: palette,
        isSelected: isPrimarySelected,
        isHovering: isHovering,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: .sidebar(
          restFill: selectionStyle == .secondary ? palette.sidebarItemHoverFill : .clear
        )
      )
    )
    .terminalAnimation(
      .spring(response: 0.24, dampingFraction: 0.88),
      value: animatedPresentation,
      reduceMotion: reduceMotion
    )
    .overlay(
      TerminalSidebarMiddleClickActionView(action: close)
    )
    .onHover { isHovering in
      self.isHovering = isHovering
    }
    .contextMenu {
      let contextualTabIDs = selectionState.contextualTabIDs(
        for: tab.id,
        primaryTabID: terminal.selectedTabID,
        outline: outline
      )
      if contextualTabIDs.count > 1 {
        TerminalSidebarBatchTabMenu(
          store: store,
          terminal: terminal,
          tabIDs: contextualTabIDs,
          contextualTabID: tab.id,
          renameState: renameState
        )
      } else {
        ForEach(
          Array(
            Self.contextMenuItems(
              isPinned: groupID == nil && rootIsPinned,
              hasTabsBelow: hasTabsBelow,
              hasOtherTabs: hasOtherTabs,
              isGrouped: groupID != nil
            ).enumerated()
          ),
          id: \.offset
        ) { _, item in
          switch item {
          case .newTab:
            Button {
              _ = store.send(
                .newTabButtonTapped(inheritingFromSurfaceID: contextSurfaceID)
              )
            } label: {
              Label("New Tab", systemImage: "plus")
            }

          case .divider:
            Divider()

          case .togglePinned(let isPinned):
            Button {
              _ = store.send(.togglePinned(tab.id))
            } label: {
              Label(isPinned ? "Unpin Tab" : "Pin Tab", systemImage: isPinned ? "pin.slash" : "pin")
            }

          case .moveToNewGroup:
            Button {
              let result = terminal.createGroup(
                title: "New Group",
                color: .neutral,
                containing: [tab.id]
              )
              if let result {
                renameState?.begin(groupID: result.groupID, title: "New Group")
              }
            } label: {
              Label("Move to New Group", systemImage: "rectangle.3.group")
            }

          case .moveToGroup:
            Menu {
              ForEach(availableGroups) { group in
                Button(group.title) {
                  _ = store.send(
                    .moveCommitted(
                      TerminalTabMoveRequest(
                        expectedTopologyRevision: terminal.selectedSpaceTopologyRevision,
                        itemIDs: [.tab(tab.id)],
                        destination: .group(group.id, index: group.tabs.count)
                      )
                    )
                  )
                }
              }
            } label: {
              Label("Move to Group...", systemImage: "arrow.right")
            }
            .disabled(availableGroups.isEmpty)

          case .removeFromGroup:
            Button {
              _ = store.send(.removeTabFromGroupRequested(tab.id))
            } label: {
              Label("Remove from Group", systemImage: "arrow.up.backward")
            }

          case .changeTabTitle:
            Button {
              terminal.promptTabTitle(tab.id)
            } label: {
              Label("Change Tab Title...", systemImage: "pencil")
            }

          case .closeTabsBelow(let isEnabled):
            Button {
              _ = store.send(.closeTabsBelowRequested(tab.id))
            } label: {
              Label("Close All Below", systemImage: "arrow.down.to.line")
            }
            .disabled(!isEnabled)

          case .closeOtherTabs(let isEnabled):
            Button {
              _ = store.send(.closeOtherTabsRequested([tab.id]))
            } label: {
              Label("Close Others", systemImage: "xmark.circle")
            }
            .disabled(!isEnabled)

          case .close:
            Button(role: .destructive) {
              _ = store.send(.closeTabRequested(tab.id))
            } label: {
              Label("Close", systemImage: "xmark")
            }
          }
        }
      }
    }
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityIdentifier(accessibilityIdentifier)
  }

  private var animatedPresentation: AnimatedPresentation {
    AnimatedPresentation(
      badgeActivities: agentPresentation.badgeActivities,
      badgeActivity: agentPresentation.badgeActivity,
      hasTerminalBell: hasTerminalBell,
      notificationPreviewText: notificationPresentation?.previewText,
      paneWorkingDirectories: paneWorkingDirectories,
      showsAgentMarks: showsAgentMarks,
      showsAgentSpinner: showsAgentSpinner,
      terminalProgress: terminalProgress,
      unreadCount: unreadCount
    )
  }

  private var availableGroups: [TerminalTabGroupItem] {
    terminal.rootItems.compactMap { root in
      guard case .group(let group) = root, group.id != groupID else { return nil }
      return group
    }
  }

  private var accessibilityIdentifier: String {
    TerminalSidebarAccessibilityIdentifier.tab(tab.id, groupID: groupID)
  }

  private func select() {
    selectionState.clear()
    _ = store.send(.tabSelected(tab.id))
  }

  private func close() {
    TerminalMotion.animate(.easeInOut(duration: 0.15), reduceMotion: reduceMotion) {
      _ = store.send(.closeTabRequested(tab.id))
    }
  }
}

struct TerminalSidebarBatchTabMenu: View {
  enum PinAction: Equatable {
    case pin
    case unpin
    case disabled
  }

  let store: StoreOf<TerminalWindowFeature>
  let terminal: TerminalHostState
  let tabIDs: [TerminalTabID]
  let contextualTabID: TerminalTabID
  let renameState: TerminalSidebarRenameState?

  var body: some View {
    Button(pinTitle, systemImage: pinAction == .unpin ? "pin.slash" : "pin") {
      togglePinned()
    }
    .disabled(pinAction == .disabled)

    Button("New Group with \(tabIDs.count) Tabs", systemImage: "rectangle.3.group") {
      createGroup()
    }

    Menu("Move to Group", systemImage: "arrow.right") {
      ForEach(groups) { group in
        Button(group.title) {
          moveToGroup(group)
        }
        .disabled(moveToGroupIsNoOp(group))
      }
    }
    .disabled(groups.isEmpty)

    if let sharedGroup {
      Button("Remove from Group", systemImage: "arrow.up.backward") {
        removeFromGroup(sharedGroup)
      }
    }

    Divider()

    Button(role: .destructive) {
      _ = store.send(.closeTabsRequested(tabIDs))
    } label: {
      Label("Close \(tabIDs.count) Tabs", systemImage: "xmark")
    }

    Button("Close Other Tabs", systemImage: "xmark.circle") {
      _ = store.send(.closeOtherTabsRequested(tabIDs))
    }
    .disabled(!hasOtherTabs)

    Button("Close Tabs Below", systemImage: "arrow.down.to.line") {
      _ = store.send(.closeTabsBelowRequested(contextualTabID))
    }
    .disabled(!hasTabsBelow)
  }

  var pinAction: PinAction {
    let pinStates = Set(tabIDs.map { terminal.isPinned($0) })
    guard pinStates.count == 1, let isPinned = pinStates.first else { return .disabled }
    return isPinned ? .unpin : .pin
  }

  private var pinTitle: String {
    "\(pinAction == .unpin ? "Unpin" : "Pin") \(tabIDs.count) Tabs"
  }

  private var groups: [TerminalTabGroupItem] {
    terminal.rootItems.compactMap { root in
      guard case .group(let group) = root else { return nil }
      return group
    }
  }

  private var sharedGroup: TerminalTabGroupItem? {
    let selected = Set(tabIDs)
    return groups.first { group in
      selected.isSubset(of: Set(group.tabs.map(\.id))) && selected.count == tabIDs.count
    }
  }

  private var hasOtherTabs: Bool {
    let selected = Set(tabIDs)
    return terminal.tabs.contains { !selected.contains($0.id) }
  }

  private var hasTabsBelow: Bool {
    guard let index = terminal.tabs.firstIndex(where: { $0.id == contextualTabID }) else {
      return false
    }
    return terminal.tabs.index(after: index) < terminal.tabs.endIndex
  }

  private func togglePinned() {
    guard pinAction != .disabled else { return }
    let isPinned = pinAction == .pin
    let destinationIndex = terminal.rootItems.count { $0.isPinned == isPinned }
    move(
      tabIDs,
      to: .root(TerminalRootPlacement(isPinned: isPinned, index: destinationIndex))
    )
  }

  private func createGroup() {
    let result = terminal.createGroup(
      title: "New Group",
      color: .neutral,
      containing: tabIDs
    )
    if let result {
      renameState?.begin(groupID: result.groupID, title: "New Group")
    }
  }

  private func moveToGroup(_ group: TerminalTabGroupItem) {
    let selected = Set(tabIDs)
    let destinationIndex = group.tabs.count { !selected.contains($0.id) }
    move(tabIDs, to: .group(group.id, index: destinationIndex))
  }

  private func moveToGroupIsNoOp(_ group: TerminalTabGroupItem) -> Bool {
    let selected = Set(tabIDs)
    return group.tabs.map(\.id).filter { !selected.contains($0) } + tabIDs
      == group.tabs.map(\.id)
  }

  private func removeFromGroup(_ group: TerminalTabGroupItem) {
    let lane = terminal.rootItems.filter { $0.isPinned == group.isPinned }
    guard let index = lane.firstIndex(where: { $0.id == .group(group.id) }) else { return }
    let groupIsDeleted =
      group.lifetime == .automatic && Set(group.tabs.map(\.id)).isSubset(of: Set(tabIDs))
    move(
      tabIDs,
      to: .root(
        TerminalRootPlacement(
          isPinned: group.isPinned,
          index: index + (groupIsDeleted ? 0 : 1)
        )
      )
    )
  }

  private func move(_ tabIDs: [TerminalTabID], to destination: TerminalTabPlacement) {
    _ = store.send(
      .moveCommitted(
        TerminalTabMoveRequest(
          expectedTopologyRevision: terminal.selectedSpaceTopologyRevision,
          itemIDs: tabIDs.map(TerminalTabRootItemID.tab),
          destination: destination
        )
      )
    )
  }
}

private struct TerminalSidebarMiddleClickActionView: NSViewRepresentable {
  let action: () -> Void

  func makeNSView(context: Context) -> TerminalSidebarMiddleClickNSView {
    TerminalSidebarMiddleClickNSView(action: action)
  }

  func updateNSView(_ nsView: TerminalSidebarMiddleClickNSView, context: Context) {
    nsView.action = action
  }
}

private final class TerminalSidebarMiddleClickNSView: NSView {
  var action: () -> Void

  init(action: @escaping () -> Void) {
    self.action = action
    super.init(frame: .zero)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }

  override func hitTest(_ point: NSPoint) -> NSView? {
    guard let event = NSApp.currentEvent,
      event.type == .otherMouseDown || event.type == .otherMouseUp
    else { return nil }
    return super.hitTest(point)
  }

  override func otherMouseUp(with event: NSEvent) {
    if event.buttonNumber == 2 {
      action()
    } else {
      super.otherMouseUp(with: event)
    }
  }

  override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}
