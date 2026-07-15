import AppKit
import ComposableArchitecture
import SupaTheme
import SwiftUI

struct TerminalSidebarTabRow: View {
  enum ContextMenuItem: Equatable {
    case newTab
    case divider
    case togglePinned(Bool)
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
    case disabled
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
    hasOtherTabs: Bool
  ) -> [ContextMenuItem] {
    var items: [ContextMenuItem] = [
      .newTab,
      .divider,
      .togglePinned(isPinned),
      .changeTabTitle,
    ]
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
    isPinned: Bool,
    isHovering: Bool,
    showsShortcutHint: Bool
  ) -> CloseButtonPresentation {
    guard isHovering, !showsShortcutHint else { return .hidden }
    return isPinned ? .disabled : .enabled
  }

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var isHovering = false
  @State private var isCloseHovering = false

  private var isSelected: Bool {
    terminal.selectedTabID == tab.id
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
          isSelected: isSelected,
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
          isPinned: tab.isPinned,
          isHovering: isHovering,
          showsShortcutHint: showsShortcutHint
        )
        if closeButtonPresentation != .hidden {
          Button(action: close) {
            Image(systemName: "xmark")
              .font(.system(size: 12, weight: .heavy))
              .foregroundStyle(isSelected ? palette.selectedText : palette.sidebarTabTitle)
              .frame(width: 24, height: 24)
              .accessibilityHidden(true)
              .background(
                isCloseHovering
                  ? (isSelected ? palette.selectedPillFill : palette.unselectedFill)
                  : .clear,
                in: RoundedRectangle(cornerRadius: 6, style: .continuous)
              )
          }
          .buttonStyle(.plain)
          .disabled(closeButtonPresentation == .disabled)
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
        isSelected: isSelected,
        isHovering: isHovering,
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        appearance: .sidebar
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
      ForEach(
        Array(
          Self.contextMenuItems(
            isPinned: tab.isPinned,
            hasTabsBelow: hasTabsBelow,
            hasOtherTabs: hasOtherTabs
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
            _ = store.send(.closeOtherTabsRequested(tab.id))
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
    .accessibilityAddTraits(isSelected ? .isSelected : [])
    .accessibilityIdentifier("sidebar.tab-row")
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

  private func select() {
    _ = store.send(.tabSelected(tab.id))
  }

  private func close() {
    TerminalMotion.animate(.easeInOut(duration: 0.15), reduceMotion: reduceMotion) {
      _ = store.send(.closeTabRequested(tab.id))
    }
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
