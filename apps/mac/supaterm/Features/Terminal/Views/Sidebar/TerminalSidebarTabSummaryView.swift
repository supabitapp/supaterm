import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  enum StatusAccessory: Equatable {
    case attention
    case pinned
    case terminalProgress(TerminalTabProgress)
  }

  enum TrailingSlot: Equatable {
    case reserved
    case shortcut(String)
    case status(StatusAccessory)
  }

  let tab: TerminalTabItem
  let palette: Palette
  let isSelected: Bool
  let isPinned: Bool
  let panes: [TerminalTabPanePresentation]
  let terminalProgress: TerminalTabProgress?
  let shortcutHint: String?
  let showsShortcutHint: Bool
  let isRowHovering: Bool

  static func statusAccessory(
    isPinned: Bool,
    terminalProgress: TerminalTabProgress?,
    paneIndicator: TerminalTabPanePresentation.Indicator? = nil
  ) -> StatusAccessory? {
    if let terminalProgress {
      return .terminalProgress(terminalProgress)
    }
    if paneIndicator == .attention {
      return .attention
    }
    if isPinned {
      return .pinned
    }
    return nil
  }

  static func trailingSlot(
    shortcutHint: String?,
    showsShortcutHint: Bool,
    isRowHovering: Bool,
    statusAccessory: StatusAccessory?
  ) -> TrailingSlot? {
    if showsShortcutHint {
      return shortcutHint.map(TrailingSlot.shortcut)
    }
    if isRowHovering {
      return .reserved
    }
    return statusAccessory.map(TrailingSlot.status)
  }

  static func titleTruncationMode(_ title: String) -> Text.TruncationMode {
    title.contains("/") ? .middle : .tail
  }

  static func helpText(
    tab: TerminalTabItem,
    panes: [TerminalTabPanePresentation]
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
          indicator: nil,
          trailingSlot: tabTrailingSlot,
          palette: palette,
          isSelected: isSelected
        )
      }

      ForEach(panes) { pane in
        let ownsTabAccessories = !showsTitleHeader && pane.id == panes.first?.id
        TerminalSidebarTabLineView(
          title: pane.title,
          indicator: pane.indicator,
          trailingSlot: paneTrailingSlot(pane, ownsTabAccessories: ownsTabAccessories),
          palette: palette,
          isSelected: isSelected
        )
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var tabTrailingSlot: TrailingSlot? {
    Self.trailingSlot(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: isPinned,
        terminalProgress: terminalProgress
      )
    )
  }

  private func paneTrailingSlot(
    _ pane: TerminalTabPanePresentation,
    ownsTabAccessories: Bool
  ) -> TrailingSlot? {
    Self.trailingSlot(
      shortcutHint: ownsTabAccessories ? shortcutHint : nil,
      showsShortcutHint: ownsTabAccessories && showsShortcutHint,
      isRowHovering: ownsTabAccessories && isRowHovering,
      statusAccessory: Self.statusAccessory(
        isPinned: ownsTabAccessories && isPinned,
        terminalProgress: ownsTabAccessories ? terminalProgress : nil,
        paneIndicator: pane.indicator
      )
    )
  }
}

private struct TerminalSidebarTabLineView: View {
  let title: String
  let indicator: TerminalTabPanePresentation.Indicator?
  let trailingSlot: TerminalSidebarTabSummaryView.TrailingSlot?
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

        if case .agent(let agentStatus) = indicator {
          TerminalSidebarAgentStatusView(
            status: agentStatus,
            showsText: showsAgentStatusText,
            palette: palette
          )
          .layoutPriority(1)
        }

        if let trailingSlot {
          trailingAccessory(trailingSlot)
            .layoutPriority(2)
        }
      }
      .terminalAnimation(
        .easeInOut(duration: 0.18),
        value: showsAgentStatusText,
        reduceMotion: reduceMotion
      )
    }
    .frame(height: TerminalSidebarLayout.tabPaneLineHeight)
  }

  private var titleColor: Color {
    isSelected ? palette.selectedText : palette.selectableRow.title
  }

  private func trailingAccessory(
    _ trailingSlot: TerminalSidebarTabSummaryView.TrailingSlot
  ) -> some View {
    ZStack {
      switch trailingSlot {
      case .reserved:
        Color.clear

      case .shortcut(let shortcutHint):
        Text(shortcutHint)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(
            isSelected
              ? palette.selectedSecondaryText
              : palette.secondaryText
          )
      case .status(let statusAccessory):
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
