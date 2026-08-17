import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum StatusAccessory: Equatable {
    case agentStatus(TerminalHostState.TabAgentStatus)
    case pinned
    case terminalBell
    case terminalProgress(TerminalSidebarTerminalProgress)
    case unreadCount(Int)
  }

  let tab: TerminalTabItem
  let palette: Palette
  let isSelected: Bool
  let isPinned: Bool
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let agentStatus: TerminalHostState.TabAgentStatus?
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func statusAccessory(
    isPinned: Bool,
    unreadCount: Int,
    agentStatus: TerminalHostState.TabAgentStatus?,
    terminalProgress: TerminalSidebarTerminalProgress?,
    hasTerminalBell: Bool = false
  ) -> StatusAccessory? {
    if agentStatus == .needsInput {
      return .agentStatus(.needsInput)
    }
    if agentStatus == .done {
      return .agentStatus(.done)
    }
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if unreadCount > 0 {
      return .unreadCount(unreadCount)
    }
    if hasTerminalBell {
      return .terminalBell
    }
    if agentStatus == .working {
      return .agentStatus(.working)
    }
    if isPinned {
      return .pinned
    }
    return nil
  }

  struct RowAccessories: Equatable {
    let shortcutHint: String?
    let statusAccessory: StatusAccessory?
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
    paneWorkingDirectories: [String]
  ) -> String? {
    guard !paneWorkingDirectories.isEmpty else { return nil }
    return paneWorkingDirectories.joined(separator: "\n")
  }

  var body: some View {
    let rowAccessories = Self.rowAccessories(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: isPinned,
        unreadCount: unreadCount,
        agentStatus: agentStatus,
        terminalProgress: terminalProgress,
        hasTerminalBell: hasTerminalBell
      )
    )

    VStack(alignment: .leading, spacing: 2) {
      ViewThatFits(in: .horizontal) {
        header(
          rowAccessories,
          showsAgentStatusText: true
        )
        .frame(minWidth: TerminalSidebarLayout.tabAgentStatusTextMinimumWidth)
        header(
          rowAccessories,
          showsAgentStatusText: false
        )
      }

      ForEach(paneWorkingDirectories, id: \.self) { workingDirectory in
        Text(workingDirectory)
          .font(.system(size: 11, weight: .regular, design: .monospaced))
          .foregroundStyle(
            isSelected
              ? palette.selectedSecondaryText
              : palette.secondaryText
          )
          .lineLimit(1)
          .truncationMode(.middle)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func header(
    _ rowAccessories: RowAccessories,
    showsAgentStatusText: Bool
  ) -> some View {
    HStack(spacing: 6) {
      Text(tab.title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(isSelected ? palette.selectedText : palette.selectableRow.title)
        .lineLimit(1)
        .truncationMode(Self.titleTruncationMode(tab.title))
        .frame(maxWidth: .infinity, minHeight: TerminalSidebarLayout.tabTrailingAccessorySize, alignment: .leading)

      trailingAccessory(
        rowAccessories,
        showsAgentStatusText: showsAgentStatusText
      )
    }
  }

  private func trailingAccessory(
    _ rowAccessories: RowAccessories,
    showsAgentStatusText: Bool
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
        statusAccessoryView(
          statusAccessory,
          showsAgentStatusText: showsAgentStatusText
        )
      }
    }
    .frame(minWidth: TerminalSidebarLayout.tabTrailingAccessorySize)
    .frame(height: TerminalSidebarLayout.tabTrailingAccessorySize)
  }

  @ViewBuilder
  private func statusAccessoryView(
    _ statusAccessory: StatusAccessory,
    showsAgentStatusText: Bool
  ) -> some View {
    switch statusAccessory {
    case .unreadCount(let unreadCount):
      Text(Self.unreadCountText(unreadCount))
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

    case .agentStatus(let status):
      TerminalSidebarAgentStatusView(
        status: status,
        showsText: showsAgentStatusText,
        palette: palette
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
