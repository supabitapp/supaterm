import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum StatusAccessory: Equatable {
    case attention
    case pinned
    case terminalProgress(TerminalSidebarTerminalProgress)
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
  let terminalProgress: TerminalSidebarTerminalProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func statusAccessory(
    isPinned: Bool,
    terminalProgress: TerminalSidebarTerminalProgress?,
    agentStatus: TerminalHostState.TabAgentStatus? = nil,
    hasPaneAttention: Bool = false
  ) -> StatusAccessory? {
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if agentStatus == nil, hasPaneAttention {
      return .attention
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
  ) -> RowAccessories? {
    let visibleShortcutHint = showsShortcutHint ? shortcutHint : nil
    let visibleStatusAccessory = showsShortcutHint || isRowHovering ? nil : statusAccessory
    let reservesCloseButton = isRowHovering && !showsShortcutHint
    guard visibleShortcutHint != nil || visibleStatusAccessory != nil || reservesCloseButton else {
      return nil
    }
    return RowAccessories(
      shortcutHint: visibleShortcutHint,
      statusAccessory: visibleStatusAccessory
    )
  }

  static func titleTruncationMode(_ title: String) -> Text.TruncationMode {
    title.contains("/") ? .middle : .tail
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
    let showsTitleHeader = tab.isTitleLocked || panes.isEmpty

    VStack(alignment: .leading, spacing: TerminalSidebarLayout.tabPaneLineSpacing) {
      if showsTitleHeader {
        TerminalSidebarTabLineView(
          title: tab.title,
          agentStatus: nil,
          rowAccessories: tabRowAccessories,
          palette: palette,
          isSelected: isSelected
        )
      }

      ForEach(panes) { pane in
        let ownsTabAccessories = !showsTitleHeader && pane.id == panes.first?.id
        TerminalSidebarTabLineView(
          title: pane.title,
          agentStatus: pane.agentStatus,
          rowAccessories: paneRowAccessories(pane, ownsTabAccessories: ownsTabAccessories),
          palette: palette,
          isSelected: isSelected
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var tabRowAccessories: RowAccessories? {
    Self.rowAccessories(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: isPinned,
        terminalProgress: terminalProgress
      )
    )
  }

  private func paneRowAccessories(
    _ pane: TerminalHostState.TabPanePresentation,
    ownsTabAccessories: Bool
  ) -> RowAccessories? {
    Self.rowAccessories(
      shortcutHint: ownsTabAccessories ? shortcutHint : nil,
      showsShortcutHint: ownsTabAccessories && showsShortcutHint,
      isRowHovering: ownsTabAccessories && isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: ownsTabAccessories && isPinned,
        terminalProgress: ownsTabAccessories ? terminalProgress : nil,
        agentStatus: pane.agentStatus,
        hasPaneAttention: pane.hasAttention
      )
    )
  }
}

private struct TerminalSidebarTabLineView: View {
  let title: String
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
          .font(.system(size: 12, weight: .medium))
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
    isSelected ? palette.selectedText : palette.selectableRow.title
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
    case .attention:
      TerminalSidebarBellIndicatorView(
        isSelected: isSelected,
        palette: palette
      )
      .accessibilityLabel("Terminal attention")

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
