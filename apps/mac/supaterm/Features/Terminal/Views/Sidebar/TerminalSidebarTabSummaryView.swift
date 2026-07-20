import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum StatusAccessory: Equatable {
    case agentActivity(TerminalHostState.AgentActivity)
    case pinned
    case terminalBell
    case terminalProgress(TerminalSidebarTerminalProgress)
    case unreadCount(Int)
  }

  let tab: TerminalTabItem
  let palette: Palette
  let isSelected: Bool
  let isPinned: Bool
  let notificationPreviewText: String?
  let paneWorkingDirectories: [String]
  let unreadCount: Int
  let badgeActivities: [TerminalHostState.AgentActivity]
  let badgeActivity: TerminalHostState.AgentActivity?
  let badgeActivityIsFocused: Bool
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let showsAgentMarks: Bool
  let showsAgentSpinner: Bool
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func statusAccessory(
    isPinned: Bool,
    unreadCount: Int,
    agentActivity: TerminalHostState.AgentActivity?,
    agentActivityIsFocused: Bool = false,
    terminalProgress: TerminalSidebarTerminalProgress?,
    hasTerminalBell: Bool = false,
    showsAgentSpinner: Bool = true
  ) -> StatusAccessory? {
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if unreadCount > 0 {
      return .unreadCount(unreadCount)
    }
    if let agentActivity, agentActivity.phase == .needsInput {
      if !agentActivityIsFocused {
        return .agentActivity(agentActivity)
      }
    }
    if hasTerminalBell {
      return .terminalBell
    }
    if let agentActivity,
      agentActivity.showsLeadingIndicator,
      agentActivity.phase != .needsInput,
      agentActivity.phase != .running || showsAgentSpinner
    {
      return .agentActivity(agentActivity)
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

  static func trailingAgentBadgeActivities(
    _ activities: [TerminalHostState.AgentActivity],
    showsAgentMarks: Bool,
    showsShortcutHint: Bool
  ) -> [TerminalHostState.AgentActivity] {
    showsAgentMarks && !showsShortcutHint ? activities : []
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
        agentActivity: badgeActivity,
        agentActivityIsFocused: badgeActivityIsFocused,
        terminalProgress: terminalProgress,
        hasTerminalBell: hasTerminalBell,
        showsAgentSpinner: showsAgentSpinner
      )
    )
    let trailingAgentBadgeActivities = Self.trailingAgentBadgeActivities(
      badgeActivities,
      showsAgentMarks: showsAgentMarks,
      showsShortcutHint: showsShortcutHint
    )

    HStack(alignment: .center, spacing: 6) {
      VStack(alignment: .leading, spacing: 2) {
        Text(tab.title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(isSelected ? palette.selectedText : palette.sidebarTabTitle)
          .lineLimit(1)
          .truncationMode(Self.titleTruncationMode(tab.title))
          .frame(maxWidth: .infinity, alignment: .leading)

        if let notificationPreviewText {
          Text(notificationPreviewText)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(notificationTextColor)
            .allowsHitTesting(false)
            .lineLimit(2)
            .truncationMode(.tail)
            .multilineTextAlignment(.leading)
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
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)

      HStack(spacing: 6) {
        if let shortcutHint = rowAccessories.shortcutHint {
          Text(shortcutHint)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(
              isSelected
                ? palette.selectedSecondaryText
                : palette.secondaryText
            )
        }

        if !trailingAgentBadgeActivities.isEmpty {
          TerminalAgentBadgeGroupView(
            activities: trailingAgentBadgeActivities,
            isSelected: isSelected,
            palette: palette
          )
        }

        if let statusAccessory = rowAccessories.statusAccessory {
          statusAccessoryView(statusAccessory)
        }
      }
      .fixedSize(horizontal: true, vertical: false)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var notificationTextColor: Color {
    isSelected
      ? palette.selectedText.opacity(0.82)
      : palette.secondaryText
  }

  @ViewBuilder
  private func statusAccessoryView(
    _ statusAccessory: StatusAccessory
  ) -> some View {
    switch statusAccessory {
    case .unreadCount(let unreadCount):
      Text(unreadCount.formatted())
        .font(.system(size: 9, weight: .bold))
        .foregroundStyle(isSelected ? palette.selectedText : Color.white)
        .padding(.horizontal, unreadCount > 9 ? 6 : 5)
        .frame(minWidth: 16, minHeight: 16)
        .background(
          isSelected ? palette.selectedText.opacity(0.16) : palette.accent,
          in: Capsule(style: .continuous)
        )

    case .agentActivity(let activity):
      TerminalSidebarAgentActivityView(
        activity: activity,
        isSelected: isSelected,
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
