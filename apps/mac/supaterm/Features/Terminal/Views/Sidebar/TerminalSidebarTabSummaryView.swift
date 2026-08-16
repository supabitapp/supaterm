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
  let statusActivity: TerminalHostState.AgentActivity?
  let statusActivityIsFocused: Bool
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
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
        agentActivity: statusActivity,
        agentActivityIsFocused: statusActivityIsFocused,
        terminalProgress: terminalProgress,
        hasTerminalBell: hasTerminalBell,
        showsAgentSpinner: showsAgentSpinner
      )
    )

    TerminalSidebarTabSummaryLayout(
      statusTextMinimumWidth: TerminalSidebarLayout.tabAgentStatusTextMinimumWidth,
      narrowAccessoryWidth: TerminalSidebarLayout.tabTrailingAccessorySize
    ) {
      VStack(alignment: .leading, spacing: 2) {
        Text(tab.title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(isSelected ? palette.selectedText : palette.selectableRow.title)
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

      ViewThatFits(in: .horizontal) {
        trailingAccessory(
          rowAccessories,
          showsAgentStatusText: true
        )
        trailingAccessory(
          rowAccessories,
          showsAgentStatusText: false
        )
      }
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

  private var notificationTextColor: Color {
    isSelected
      ? palette.selectedText.opacity(0.82)
      : palette.secondaryText
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
        .padding(.horizontal, unreadCount > 9 ? 4 : 5)
        .frame(minWidth: 16, minHeight: 16)
        .background(
          isSelected ? palette.selectedText.opacity(0.16) : palette.accent,
          in: Capsule(style: .continuous)
        )

    case .agentActivity(let activity):
      TerminalSidebarAgentStatusView(
        activity: activity,
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

private struct TerminalSidebarTabSummaryLayout: Layout {
  private struct Measurements {
    let contentProposal: ProposedViewSize
    let contentSize: CGSize
    let accessoryProposal: ProposedViewSize
    let accessorySize: CGSize
    let size: CGSize
  }

  let statusTextMinimumWidth: CGFloat
  let narrowAccessoryWidth: CGFloat
  private let spacing: CGFloat = 6

  func sizeThatFits(
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout Void
  ) -> CGSize {
    measurements(
      width: proposal.width,
      height: proposal.height,
      subviews: subviews
    ).size
  }

  func placeSubviews(
    in bounds: CGRect,
    proposal: ProposedViewSize,
    subviews: Subviews,
    cache: inout Void
  ) {
    let measurements = measurements(
      width: bounds.width,
      height: proposal.height,
      subviews: subviews
    )
    subviews[0].place(
      at: CGPoint(x: bounds.minX, y: bounds.midY),
      anchor: .leading,
      proposal: measurements.contentProposal
    )
    subviews[1].place(
      at: CGPoint(x: bounds.maxX, y: bounds.midY),
      anchor: .trailing,
      proposal: measurements.accessoryProposal
    )
  }

  private func measurements(
    width: CGFloat?,
    height: CGFloat?,
    subviews: Subviews
  ) -> Measurements {
    let accessoryProposal = ProposedViewSize(
      width: accessoryWidth(for: width),
      height: height
    )
    let accessorySize = subviews[1].sizeThatFits(accessoryProposal)
    let contentProposal = ProposedViewSize(
      width: width.map { max(0, $0 - spacing - accessorySize.width) },
      height: height
    )
    let contentSize = subviews[0].sizeThatFits(contentProposal)
    let measuredWidth = width ?? contentSize.width + spacing + accessorySize.width
    return Measurements(
      contentProposal: contentProposal,
      contentSize: contentSize,
      accessoryProposal: accessoryProposal,
      accessorySize: accessorySize,
      size: CGSize(
        width: measuredWidth,
        height: max(contentSize.height, accessorySize.height)
      )
    )
  }

  private func accessoryWidth(for width: CGFloat?) -> CGFloat? {
    guard let width else { return nil }
    guard width < statusTextMinimumWidth else { return nil }
    return narrowAccessoryWidth
  }
}
