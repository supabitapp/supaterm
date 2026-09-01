import SupaTheme
import SupatermUI
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum TrailingAccessory: Equatable {
    case reserved
    case shortcut(String)
    case agent(TerminalHostState.TabAgentStatus)
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
    paneIndicator: TerminalSidebarPanePresentation.Indicator? = nil
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
    switch paneIndicator {
    case .agent(let status):
      return .agent(status)
    case .attention:
      return .attention
    case nil:
      break
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
    let icons = Set(panes.map(\.icon))
    return icons.count == 1 ? icons.first ?? .terminal : .terminal
  }

  static func hasVisibleStatusIndicator(
    tab: TerminalTabItem,
    panes: [TerminalSidebarPanePresentation],
    terminalProgress: TerminalSidebarTerminalProgress?,
    showsShortcutHint: Bool
  ) -> Bool {
    let showsTitleHeader = tab.isTitleLocked || panes.isEmpty
    return panes.contains { pane in
      let ownsTabAccessories = !showsTitleHeader && pane.id == panes.first?.id
      switch Self.trailingAccessory(
        showsShortcutHint: showsShortcutHint,
        terminalProgress: ownsTabAccessories ? terminalProgress : nil,
        paneIndicator: pane.indicator
      ) {
      case .agent, .attention:
        return true
      default:
        return false
      }
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

  var body: some View {
    let showsTitleHeader = tab.isTitleLocked || panes.isEmpty

    VStack(alignment: .leading, spacing: TerminalSidebarLayout.tabPaneLineSpacing) {
      if showsTitleHeader {
        TerminalSidebarTabLineView(
          title: tab.title,
          icon: Self.tabIcon(panes: panes),
          trailingAccessory: tabTrailingAccessory,
          palette: palette,
          isSelected: isSelected
        )
      }

      ForEach(panes) { pane in
        let ownsTabAccessories = !showsTitleHeader && pane.id == panes.first?.id
        TerminalSidebarTabLineView(
          title: pane.title,
          icon: pane.icon,
          trailingAccessory: paneTrailingAccessory(
            pane.indicator,
            ownsTabAccessories: ownsTabAccessories
          ),
          palette: palette,
          isSelected: isSelected
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var tabTrailingAccessory: TrailingAccessory? {
    Self.trailingAccessory(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      isPinned: isPinned,
      terminalProgress: terminalProgress
    )
  }

  private func paneTrailingAccessory(
    _ indicator: TerminalSidebarPanePresentation.Indicator?,
    ownsTabAccessories: Bool
  ) -> TrailingAccessory? {
    guard ownsTabAccessories || !isRowHovering else { return nil }
    return Self.trailingAccessory(
      shortcutHint: ownsTabAccessories ? shortcutHint : nil,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: ownsTabAccessories && isRowHovering,
      isPinned: ownsTabAccessories && isPinned,
      terminalProgress: ownsTabAccessories ? terminalProgress : nil,
      paneIndicator: indicator
    )
  }
}

private struct TerminalSidebarTabLineView: View {
  let title: String
  let icon: TerminalSidebarPanePresentation.Icon
  let trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory?
  let palette: Palette
  let isSelected: Bool

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
    .frame(height: TerminalSidebarLayout.tabPaneLineHeight)
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
      case .agent(let status):
        TerminalSidebarAgentStatusView(
          status: status,
          showsText: showsAgentStatusText,
          palette: palette
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
