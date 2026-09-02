import SupaTheme
import SupatermUI
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum TrailingAccessory: Equatable {
    case reserved
    case shortcut(String)
    case agent(TerminalHostState.TabAgentStatusPresentation)
    case attention
    case pinned
    case terminalProgress(TerminalSidebarTerminalProgress)

    fileprivate var usesVariableWidth: Bool {
      switch self {
      case .agent, .shortcut:
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
  var rendersAgentStatus = true

  static func trailingAccessory(
    shortcutHint: String? = nil,
    showsShortcutHint: Bool = false,
    isRowHovering: Bool = false,
    isPinned: Bool = false,
    terminalProgress: TerminalSidebarTerminalProgress? = nil,
    agentStatus: TerminalHostState.TabAgentStatusPresentation? = nil,
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
    if let agentStatus {
      return .agent(agentStatus)
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
    panes: [TerminalSidebarPanePresentation],
    agentStatus: TerminalHostState.TabAgentStatusPresentation? = nil
  ) -> TerminalSidebarPanePresentation.Icon {
    if let agentID = agentStatus?.agent.id,
      let imageName = TerminalCodingAgentCatalog.markImageName(for: agentID)
    {
      return .agent(imageName)
    }
    if let focusedIcon = panes.first(where: \.isFocused)?.icon {
      return focusedIcon
    }
    guard let icon = panes.first?.icon, panes.allSatisfy({ $0.icon == icon }) else {
      return .terminal
    }
    return icon
  }

  static func hasVisibleStatusIndicator(
    agentStatus: TerminalHostState.TabAgentStatusPresentation?,
    hasAttention: Bool,
    terminalProgress: TerminalSidebarTerminalProgress?,
    showsShortcutHint: Bool
  ) -> Bool {
    switch Self.trailingAccessory(
      showsShortcutHint: showsShortcutHint,
      terminalProgress: terminalProgress,
      agentStatus: agentStatus,
      hasAttention: hasAttention
    ) {
    case .agent, .attention:
      return true
    default:
      return false
    }
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
      icon: Self.tabIcon(panes: panes, agentStatus: agentStatus),
      trailingAccessory: trailingAccessory,
      palette: palette,
      isSelected: isSelected,
      rendersAgentStatus: rendersAgentStatus
    )
  }

  private var trailingAccessory: TrailingAccessory? {
    Self.trailingAccessory(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      isPinned: isPinned,
      terminalProgress: terminalProgress,
      agentStatus: agentStatus,
      hasAttention: panes.contains(where: \.hasAttention)
    )
  }
}

private struct TerminalSidebarTabLineView: View {
  let title: String
  let icon: TerminalSidebarPanePresentation.Icon
  let trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory?
  let palette: Palette
  let isSelected: Bool
  let rendersAgentStatus: Bool

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    GeometryReader { geometry in
      let showsAgentStatusText =
        geometry.size.width >= TerminalSidebarLayout.tabAgentStatusTextMinimumWidth
      HStack(spacing: 6) {
        leadingIcon

        Text(title)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(titleColor)
          .lineLimit(1)
          .truncationMode(TerminalSidebarTabSummaryView.titleTruncationMode(title))
          .frame(maxWidth: .infinity, alignment: .leading)

        if let trailingAccessory {
          trailingAccessoryView(
            trailingAccessory,
            showsAgentStatusText: showsAgentStatusText
          )
          .layoutPriority(2)
        }
      }
      .terminalAnimation(
        .easeInOut(duration: 0.18),
        value: showsAgentStatusText,
        reduceMotion: reduceMotion
      )
      .frame(width: geometry.size.width, height: geometry.size.height)
    }
    .frame(height: TerminalSidebarLayout.tabLineHeight)
  }

  private var titleColor: Color {
    isSelected ? palette.selectedText : palette.selectableRow.title
  }

  private var leadingIcon: some View {
    Group {
      switch icon {
      case .terminal:
        Image(systemName: "terminal.fill")
          .renderingMode(.template)
          .resizable()
          .accessibilityHidden(true)
      case .agent(let imageName):
        Image(imageName)
          .renderingMode(.template)
          .resizable()
          .accessibilityHidden(true)
      }
    }
    .aspectRatio(contentMode: .fit)
    .frame(width: 13, height: 13)
    .foregroundStyle(
      isSelected
        ? palette.selectedSecondaryText
        : palette.secondaryText
    )
  }

  private func trailingAccessoryView(
    _ trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory,
    showsAgentStatusText: Bool
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
      case .agent(let agentStatus):
        TerminalSidebarAgentStatusView(
          status: agentStatus.status,
          showsText: showsAgentStatusText,
          palette: palette
        )
        .opacity(rendersAgentStatus ? 1 : 0)
        .accessibilityHidden(!rendersAgentStatus)

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
