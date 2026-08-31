import SupaTheme
import SwiftUI

struct TerminalSidebarTabSummaryView: View {
  struct Summary: Equatable {
    let headerIndicator: TerminalTabPanePresentation.Indicator?
    let panes: [TerminalTabPanePresentation]
  }

  enum TrailingAccessory: Equatable {
    case reserved
    case shortcut(String)
    case agent(TerminalHostState.TabAgentStatus)
    case attention
    case pinned
    case terminalProgress(TerminalTabProgress)

    fileprivate var usesVariableWidth: Bool {
      if case .agent = self { return true }
      return false
    }
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

  static func trailingAccessory(
    shortcutHint: String? = nil,
    showsShortcutHint: Bool = false,
    isRowHovering: Bool = false,
    isPinned: Bool = false,
    terminalProgress: TerminalTabProgress? = nil,
    paneIndicator: TerminalTabPanePresentation.Indicator? = nil
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

  static func helpText(
    tab: TerminalTabItem,
    panes: [TerminalTabPanePresentation]
  ) -> String {
    let summary = summary(tab: tab, panes: panes)
    var titles = tab.isTitleLocked ? [tab.title] : []
    titles.append(contentsOf: summary.panes.map(\.title))
    var seen = Set<String>()
    let uniqueTitles = titles.filter { seen.insert($0).inserted }
    return uniqueTitles.isEmpty ? tab.title : uniqueTitles.joined(separator: "\n")
  }

  static func summary(
    tab: TerminalTabItem,
    panes: [TerminalTabPanePresentation]
  ) -> Summary {
    guard tab.isTitleLocked,
      let matchingIndex = panes.firstIndex(where: { $0.title == tab.title })
    else {
      return Summary(headerIndicator: nil, panes: panes)
    }
    var displayedPanes = panes
    let headerIndicator = displayedPanes.remove(at: matchingIndex).indicator
    return Summary(headerIndicator: headerIndicator, panes: displayedPanes)
  }

  var body: some View {
    let summary = Self.summary(tab: tab, panes: panes)
    let showsTitleHeader = tab.isTitleLocked || summary.panes.isEmpty

    VStack(alignment: .leading, spacing: TerminalSidebarLayout.tabPaneLineSpacing) {
      if showsTitleHeader {
        TerminalSidebarTabLineView(
          title: tab.title,
          trailingAccessory: tabTrailingAccessory(paneIndicator: summary.headerIndicator),
          palette: palette,
          isSelected: isSelected
        )
      }

      ForEach(summary.panes) { pane in
        let ownsTabAccessories = !showsTitleHeader && pane.id == summary.panes.first?.id
        TerminalSidebarTabLineView(
          title: pane.title,
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

  private func tabTrailingAccessory(
    paneIndicator: TerminalTabPanePresentation.Indicator?
  ) -> TrailingAccessory? {
    Self.trailingAccessory(
      shortcutHint: shortcutHint,
      showsShortcutHint: showsShortcutHint,
      isRowHovering: isRowHovering,
      isPinned: isPinned,
      terminalProgress: terminalProgress,
      paneIndicator: paneIndicator
    )
  }

  private func paneTrailingAccessory(
    _ indicator: TerminalTabPanePresentation.Indicator?,
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
  let trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory?
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

  private func trailingAccessoryView(
    _ trailingAccessory: TerminalSidebarTabSummaryView.TrailingAccessory,
    showsAgentStatusText: Bool
  ) -> some View {
    Group {
      switch trailingAccessory {
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
