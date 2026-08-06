import SupaTheme
import SupatermCLIShared
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
  let favicon: TerminalFavicon
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

    HStack(alignment: .center, spacing: 6) {
      faviconView

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
      .frame(
        width: TerminalSidebarLayout.tabTrailingAccessorySize,
        height: TerminalSidebarLayout.tabTrailingAccessorySize
      )
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var notificationTextColor: Color {
    isSelected
      ? palette.selectedText.opacity(0.82)
      : palette.secondaryText
  }

  @ViewBuilder
  private var faviconView: some View {
    let image = favicon.image
    switch image {
    case .asset(let name):
      Image(name)
        .renderingMode(.template)
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 14, height: 14)
        .frame(width: 16, height: 16)
        .foregroundStyle(faviconColor)
        .accessibilityHidden(true)
    case .system(let name):
      Image(systemName: name)
        .font(.system(size: 11, weight: .medium))
        .frame(width: 16, height: 16)
        .foregroundStyle(faviconColor)
        .accessibilityHidden(true)
    }
  }

  private var faviconColor: Color {
    isSelected ? palette.selectedSecondaryText : palette.secondaryText
  }

  @ViewBuilder
  private func statusAccessoryView(
    _ statusAccessory: StatusAccessory
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

private enum TerminalFaviconImage {
  case asset(String)
  case system(String)
}

extension TerminalFavicon {
  fileprivate var image: TerminalFaviconImage {
    switch self {
    case .command(let command):
      return command.image
    case .project(.swift):
      return .system("swift")
    case .project(let project):
      return .asset("\(project.rawValue)-mark")
    case .shell:
      return .system("terminal")
    }
  }
}

extension CommandGlyph {
  fileprivate var image: TerminalFaviconImage {
    switch self {
    case .claude:
      return .asset(SupatermAgentKind.claude.markImageName)
    case .codex:
      return .asset(SupatermAgentKind.codex.markImageName)
    case .pi:
      return .asset(SupatermAgentKind.pi.markImageName)
    case .sourceControl:
      return .system("arrow.triangle.branch")
    case .remote:
      return .system("network")
    case .editor:
      return .system("text.cursor")
    case .build:
      return .system("hammer.fill")
    case .package:
      return .system("shippingbox.fill")
    case .code:
      return .system("chevron.left.forwardslash.chevron.right")
    case .ruby:
      return .asset("ruby-mark")
    case .container:
      return .system("shippingbox")
    case .search:
      return .system("magnifyingglass")
    case .rust:
      return .asset("rust-mark")
    }
  }
}
