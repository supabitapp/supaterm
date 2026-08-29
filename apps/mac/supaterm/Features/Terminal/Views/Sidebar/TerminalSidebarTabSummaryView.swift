import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum StatusAccessory: Equatable {
    case pinned
    case terminalBell
    case terminalProgress(TerminalSidebarTerminalProgress)
    case unreadCount(Int)
  }

  struct RowAccessories: Equatable {
    let shortcutHint: String?
    let statusAccessory: StatusAccessory?
  }

  let tab: TerminalTabItem
  let palette: Palette
  let isSelected: Bool
  let isPinned: Bool
  let panes: [TerminalHostState.TabPanePresentation]
  let unreadCount: Int
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func statusAccessory(
    isPinned: Bool,
    unreadCount: Int,
    terminalProgress: TerminalSidebarTerminalProgress?,
    hasTerminalBell: Bool = false
  ) -> StatusAccessory? {
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if unreadCount > 0 {
      return .unreadCount(unreadCount)
    }
    if hasTerminalBell {
      return .terminalBell
    }
    if isPinned {
      return .pinned
    }
    return nil
  }

  static func rowAccessories(
    shortcutHint: String?,
    showsShortcutHint: Bool,
    isRowHovering: Bool,
    statusAccessory: StatusAccessory?
  ) -> RowAccessories {
    RowAccessories(
      shortcutHint: showsShortcutHint ? shortcutHint : nil,
      statusAccessory: showsShortcutHint || isRowHovering ? nil : statusAccessory
    )
  }

  static func titleTruncationMode(_ title: String) -> Text.TruncationMode {
    title.contains("/") ? .middle : .tail
  }

  static func unreadCountText(_ unreadCount: Int) -> String {
    unreadCount > 99 ? "99+" : unreadCount.formatted()
  }

  static func helpText(
    tab: TerminalTabItem,
    panes: [TerminalHostState.TabPanePresentation]
  ) -> String {
    var titles = tab.isTitleLocked ? [tab.title] : []
    titles.append(contentsOf: panes.map(\.title))
    return titles.isEmpty ? tab.title : titles.joined(separator: "\n")
  }

  var body: some View {
    let rowAccessories = Self.rowAccessories(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: isPinned,
        unreadCount: unreadCount,
        terminalProgress: terminalProgress,
        hasTerminalBell: hasTerminalBell
      )
    )
    let showsTitleHeader = tab.isTitleLocked || panes.isEmpty

    VStack(alignment: .leading, spacing: TerminalSidebarLayout.tabPaneLineSpacing) {
      if showsTitleHeader {
        TerminalSidebarTabLineView(
          title: tab.title,
          emphasis: .primary,
          agentStatus: nil,
          rowAccessories: rowAccessories,
          palette: palette,
          isSelected: isSelected
        )
      }

      ForEach(panes) { pane in
        TerminalSidebarTabLineView(
          title: pane.title,
          emphasis: pane.isFocused ? .primary : .secondary,
          agentStatus: pane.agentStatus,
          rowAccessories: !showsTitleHeader && pane.id == panes.first?.id ? rowAccessories : nil,
          palette: palette,
          isSelected: isSelected
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

private struct TerminalSidebarTabLineView: View {
  enum Emphasis {
    case primary
    case secondary
  }

  let title: String
  let emphasis: Emphasis
  let agentStatus: TerminalHostState.TabAgentStatus?
  let rowAccessories: TerminalSidebarTabSummaryView.RowAccessories?
  let palette: Palette
  let isSelected: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geometry in
      let showsAgentStatusText =
        geometry.size.width >= TerminalSidebarLayout.tabAgentStatusTextMinimumWidth
      HStack(spacing: 6) {
        Text(title)
          .font(.system(size: 12, weight: emphasis == .primary ? .medium : .regular))
          .foregroundStyle(titleColor)
          .lineLimit(1)
          .truncationMode(TerminalSidebarTabSummaryView.titleTruncationMode(title))
          .frame(maxWidth: .infinity, alignment: .leading)

        if let agentStatus {
          TerminalSidebarAgentStatusView(
            status: agentStatus,
            showsText: showsAgentStatusText,
            palette: palette
          )
          .layoutPriority(1)
        }

        if let rowAccessories {
          trailingAccessory(rowAccessories)
            .layoutPriority(2)
        }
      }
      .terminalAnimation(
        .easeInOut(duration: 0.18),
        value: showsAgentStatusText,
        reduceMotion: reduceMotion
      )
    }
    .frame(
      height: rowAccessories == nil
        ? TerminalSidebarLayout.tabPaneLineHeight
        : TerminalSidebarLayout.tabTrailingAccessorySize
    )
  }

  private var titleColor: Color {
    switch (isSelected, emphasis) {
    case (true, .primary):
      palette.selectedText
    case (true, .secondary):
      palette.selectedSecondaryText
    case (false, .primary):
      palette.selectableRow.title
    case (false, .secondary):
      palette.secondaryText
    }
  }

  private func trailingAccessory(
    _ rowAccessories: TerminalSidebarTabSummaryView.RowAccessories
  ) -> some View {
    ZStack {
      if let shortcutHint = rowAccessories.shortcutHint {
        Text(shortcutHint)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(
            isSelected
              ? palette.selectedSecondaryText
              : palette.secondaryText
          )
      }

      if let statusAccessory = rowAccessories.statusAccessory {
        statusAccessoryView(statusAccessory)
      }
    }
    .frame(minWidth: TerminalSidebarLayout.tabTrailingAccessorySize)
    .frame(height: TerminalSidebarLayout.tabTrailingAccessorySize)
  }

  @ViewBuilder
  private func statusAccessoryView(
    _ statusAccessory: TerminalSidebarTabSummaryView.StatusAccessory
  ) -> some View {
    switch statusAccessory {
    case .unreadCount(let unreadCount):
      Text(TerminalSidebarTabSummaryView.unreadCountText(unreadCount))
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(isSelected ? palette.selectedText : Color.white)
        .accessibilityLabel(
          "\(unreadCount) unread \(unreadCount == 1 ? "notification" : "notifications")"
        )
        .padding(.horizontal, unreadCount > 9 ? 4 : 5)
        .frame(minWidth: 16, minHeight: 16)
        .background(
          isSelected ? palette.selectedText.opacity(0.16) : palette.accent,
          in: Capsule(style: .continuous)
        )

    case .terminalBell:
      TerminalSidebarBellIndicatorView(
        isSelected: isSelected,
        palette: palette
      )

    case .pinned:
      Image(systemName: "pin.fill")
        .font(.system(size: 9, weight: .semibold))
        .foregroundStyle(
          isSelected
            ? palette.selectedSecondaryText
            : palette.secondaryText
        )
        .accessibilityLabel("Pinned")

    case .terminalProgress(let terminalProgress):
      TerminalSidebarProgressIndicatorView(
        progress: terminalProgress,
        isSelected: isSelected,
        palette: palette
      )
    }
  }
}
