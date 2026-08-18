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
  let details: [TerminalSidebarTabDetail]
  let unreadCount: Int
  let agentStatus: TerminalHostState.TabAgentStatus?
  let hasTerminalBell: Bool
  let terminalProgress: TerminalSidebarTerminalProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
    details: [TerminalSidebarTabDetail]
  ) -> String? {
    guard !details.isEmpty else { return nil }
    return details.map(\.helpText).joined(separator: "\n")
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
      GeometryReader { geometry in
        let showsAgentStatusText =
          geometry.size.width >= TerminalSidebarLayout.tabAgentStatusTextMinimumWidth
        header(
          rowAccessories,
          showsAgentStatusText: showsAgentStatusText
        )
        .terminalAnimation(
          .easeInOut(duration: 0.18),
          value: showsAgentStatusText,
          reduceMotion: reduceMotion
        )
      }
      .frame(height: TerminalSidebarLayout.tabTrailingAccessorySize)

      ForEach(details) { detail in
        TerminalSidebarTabDetailView(
          detail: detail,
          palette: palette,
          isSelected: isSelected
        )
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
      .layoutPriority(1)
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

private struct TerminalSidebarTabDetailView: View {
  let detail: TerminalSidebarTabDetail
  let palette: Palette
  let isSelected: Bool

  var body: some View {
    switch detail {
    case .agentWorkspace(let workspace):
      if let branchDetails = workspace.branchDetails {
        branchView(workspace, branchDetails: branchDetails)
      } else {
        pathView(workspace.abbreviatedWorkingDirectoryPath)
      }
    case .workingDirectory(let path):
      pathView(path)
    }
  }

  private func pathView(_ path: String) -> some View {
    Text(path)
      .font(.system(size: 11, weight: .regular, design: .monospaced))
      .foregroundStyle(secondaryText)
      .lineLimit(1)
      .truncationMode(.middle)
      .frame(maxWidth: .infinity, alignment: .leading)
  }

  private func branchView(
    _ workspace: TerminalTabAgentWorkspace,
    branchDetails: PaneAgentBranchDetails
  ) -> some View {
    HStack(spacing: 5) {
      Image("git-branch")
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 11, height: 11)
        .foregroundStyle(secondaryText)
        .accessibilityHidden(true)

      Text(branchDetails.branchName)
        .font(.system(size: 11, weight: .medium, design: .monospaced))
        .foregroundStyle(secondaryText)
        .lineLimit(1)
        .truncationMode(.middle)
        .layoutPriority(1)

      if let pullRequestStatus = workspace.pullRequestStatus {
        TerminalSidebarPullRequestView(
          status: pullRequestStatus,
          palette: palette
        )
      }

      if workspace.hasChanges {
        HStack(spacing: 3) {
          Text("+\(branchDetails.addedLineCount, format: .number)")
            .foregroundStyle(palette.success)
          Text("-\(branchDetails.removedLineCount, format: .number)")
            .foregroundStyle(palette.danger)
        }
        .font(.system(size: 10, weight: .medium, design: .monospaced))
        .monospacedDigit()
        .fixedSize()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .accessibilityElement(children: .combine)
  }

  private var secondaryText: Color {
    isSelected ? palette.selectedSecondaryText : palette.secondaryText
  }
}

private struct TerminalSidebarPullRequestView: View {
  let status: PaneAgentPullRequestStatus
  let palette: Palette

  var body: some View {
    HStack(spacing: 2) {
      icon

      Text(status.compactTitle)
        .font(.system(size: 10, weight: .semibold, design: .rounded))
    }
    .foregroundStyle(status.color(in: palette))
    .fixedSize()
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(status.accessibilityTitle)
  }

  @ViewBuilder
  private var icon: some View {
    switch status.icon {
    case .asset(let name):
      Image(name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 10, height: 10)
        .accessibilityHidden(true)
    case .system(let name):
      Image(systemName: name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 10, height: 10)
        .accessibilityHidden(true)
    }
  }
}

extension TerminalSidebarTabDetail {
  fileprivate var helpText: String {
    switch self {
    case .agentWorkspace(let workspace):
      workspace.helpText
    case .workingDirectory(let path):
      path
    }
  }
}

extension TerminalTabAgentWorkspace {
  fileprivate var abbreviatedWorkingDirectoryPath: String {
    (workingDirectoryPath as NSString).abbreviatingWithTildeInPath
  }

  fileprivate var pullRequestStatus: PaneAgentPullRequestStatus? {
    branchDetails?.displayedPullRequestStatus
  }

  fileprivate var hasChanges: Bool {
    guard let branchDetails else { return false }
    return branchDetails.addedLineCount != 0 || branchDetails.removedLineCount != 0
  }

  fileprivate var helpText: String {
    guard let branchDetails else { return abbreviatedWorkingDirectoryPath }
    var context = [branchDetails.branchName]
    if let pullRequestStatus {
      context.append(pullRequestStatus.compactContextTitle)
    }
    if hasChanges {
      context.append("+\(branchDetails.addedLineCount) -\(branchDetails.removedLineCount)")
    }
    return "\(context.joined(separator: " · "))\n\(abbreviatedWorkingDirectoryPath)"
  }
}
