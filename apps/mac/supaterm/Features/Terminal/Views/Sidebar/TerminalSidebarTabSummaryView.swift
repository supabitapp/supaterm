import SupaTheme
import SupatermUI
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum LeadingAccessory: Equatable {
    case icon(TerminalSidebarPanePresentation.Icon)
    case agent(TerminalHostState.TabAgentStatus)
  }

  enum TrailingAccessory: Equatable {
    case reserved
    case shortcut(String)
    case attention
    case pinned
    case terminalProgress(TerminalSidebarTerminalProgress)

    fileprivate var usesVariableWidth: Bool {
      switch self {
      case .shortcut:
        true
      default:
        false
      }
    }
  }

  let tab: TerminalTabItem
  let palette: Palette
  let isSelected: Bool
  let isPinned: Bool
  let panes: [TerminalSidebarPanePresentation]
  let agentStatus: TerminalHostState.TabAgentStatusPresentation?
  let terminalProgress: TerminalSidebarTerminalProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func trailingAccessory(
    shortcutHint: String? = nil,
    showsShortcutHint: Bool = false,
    isRowHovering: Bool = false,
    isPinned: Bool = false,
    terminalProgress: TerminalSidebarTerminalProgress? = nil,
    hasAttention: Bool = false
  ) -> TrailingAccessory? {
    if isRowHovering {
      return .reserved
    }
    if showsShortcutHint {
      return shortcutHint.map(TrailingAccessory.shortcut)
    }
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if hasAttention {
      return .attention
    }
    if isPinned {
      return .pinned
    }
    return nil
  }

  static func titleTruncationMode(_ title: String) -> Text.TruncationMode {
    title.contains("/") ? .middle : .tail
  }

  static func tabIcon(
    panes: [TerminalSidebarPanePresentation]
  ) -> TerminalSidebarPanePresentation.Icon {
    if let focusedIcon = panes.first(where: \.isFocused)?.icon {
      return focusedIcon
    }
    guard let icon = panes.first?.icon, panes.allSatisfy({ $0.icon == icon }) else {
      return .terminal
    }
    return icon
  }

  static func leadingAccessory(
    panes: [TerminalSidebarPanePresentation],
    agentStatus: TerminalHostState.TabAgentStatusPresentation?
  ) -> LeadingAccessory {
    if let agentStatus {
      return .agent(agentStatus.status)
    }
    return .icon(tabIcon(panes: panes))
  }

  static func hasVisibleStatusIndicator(
    hasAttention: Bool,
    terminalProgress: TerminalSidebarTerminalProgress?,
    showsShortcutHint: Bool
  ) -> Bool {
    Self.trailingAccessory(
      showsShortcutHint: showsShortcutHint,
      terminalProgress: terminalProgress,
      hasAttention: hasAttention
    ) == .attention
  }

  static func helpText(
    tab: TerminalTabItem,
    panes: [TerminalSidebarPanePresentation]
  ) -> String {
    var titles = tab.isTitleLocked ? [tab.title] : []
    titles.append(contentsOf: panes.map(\.title))
    return titles.isEmpty ? tab.title : titles.joined(separator: "\n")
  }

  static func agentStatusHelpText(
    _ agentStatus: TerminalHostState.TabAgentStatusPresentation,
    panes: [TerminalSidebarPanePresentation]
  ) -> String {
    let state =
      switch agentStatus.status {
      case .needsInput: "needs input"
      case .done: "done"
      case .working: "working"
      }
    guard let index = panes.firstIndex(where: { $0.id == agentStatus.surfaceID }) else {
      return "\(agentStatus.agent.displayName) \(state)"
    }
    let pane = panes[index]
    let location = panes.count == 1 ? pane.title : "pane \(index + 1): \(pane.title)"
    return "\(agentStatus.agent.displayName) \(state) in \(location)"
  }

  var body: some View {
    TerminalSidebarTabLineView(
      title: tab.title,
      leadingAccessory: Self.leadingAccessory(panes: panes, agentStatus: agentStatus),
      trailingAccessory: trailingAccessory,
      palette: palette,
      isSelected: isSelected
    )
  }

  private var trailingAccessory: TrailingAccessory? {
    Self.trailingAccessory(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      isPinned: isPinned,
      terminalProgress: terminalProgress,
      hasAttention: panes.contains(where: \.hasAttention)
    )
  }
}

private struct TerminalSidebarTabLineView: View {
  let title: String
  let leadingAccessory: TerminalSidebarTabSummaryView.LeadingAccessory
  let trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory?
  let palette: Palette
  let isSelected: Bool

  var body: some View {
    HStack(spacing: 6) {
      leadingAccessoryView

      Text(title)
        .font(.system(size: 12, weight: .medium))
        .foregroundStyle(titleColor)
        .lineLimit(1)
        .truncationMode(TerminalSidebarTabSummaryView.titleTruncationMode(title))
        .frame(maxWidth: .infinity, alignment: .leading)

      if let trailingAccessory {
        trailingAccessoryView(trailingAccessory)
          .layoutPriority(2)
      }
    }
    .frame(height: TerminalSidebarLayout.tabLineHeight)
  }

  private var titleColor: Color {
    isSelected ? palette.selectedText : palette.selectableRow.title
  }

  private var leadingAccessoryView: some View {
    Group {
      switch leadingAccessory {
      case .icon(let icon):
        Group {
          switch icon {
          case .terminal:
            Image(systemName: "terminal.fill")
              .renderingMode(.template)
              .resizable()
          case .agent(let imageName):
            Image(imageName)
              .renderingMode(.template)
              .resizable()
          }
        }
        .aspectRatio(contentMode: .fit)
        .foregroundStyle(
          isSelected
            ? palette.selectedSecondaryText
            : palette.secondaryText
        )

      case .agent(let status):
        TerminalSidebarAgentStatusIconView(status: status, palette: palette)
      }
    }
    .frame(
      width: TerminalSidebarLayout.tabLeadingIconSize,
      height: TerminalSidebarLayout.tabLeadingIconSize
    )
    .accessibilityHidden(true)
  }

  private func trailingAccessoryView(
    _ trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory
  ) -> some View {
    Group {
      switch trailingAccessory {
      case .reserved:
        Color.clear

      case .shortcut(let shortcutHint):
        KeyboardShortcutPill(
          shortcutHint,
          color: isSelected
            ? palette.selectedSecondaryText
            : palette.secondaryText
        )
      case .attention:
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
    .frame(
      width: trailingAccessory.usesVariableWidth
        ? nil
        : TerminalSidebarLayout.tabTrailingAccessorySize
    )
    .frame(
      minWidth: trailingAccessory.usesVariableWidth
        ? TerminalSidebarLayout.tabTrailingAccessorySize
        : nil
    )
    .frame(height: TerminalSidebarLayout.tabTrailingAccessorySize)
  }
}
