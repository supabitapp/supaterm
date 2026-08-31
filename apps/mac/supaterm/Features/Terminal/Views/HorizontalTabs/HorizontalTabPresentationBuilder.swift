import AppKit
import SupaTheme

@MainActor
enum HorizontalTabPresentationBuilder {
  private struct TabContext {
    let selectedTabID: TerminalTabID?
    let selectionState: TerminalTabSelectionState?
    let selectedTint: ThemeTint?
    let surface: TerminalHorizontalTabSurfacePresentation
  }

  static func presentations(
    snapshot: TerminalTabSurfaceSnapshot,
    surface: TerminalHorizontalTabSurfacePresentation,
    selectionState: TerminalTabSelectionState?
  ) -> [TerminalSidebarEntryID: TerminalHorizontalTabItemPresentation] {
    var result: [TerminalSidebarEntryID: TerminalHorizontalTabItemPresentation] = [:]
    let selectedTabID = snapshot.collection.selectedTabID
    for root in snapshot.collection.rootItems {
      switch root {
      case .tab(let item):
        result[.tab(item.tab.id)] = tabPresentation(
          item.tab,
          isPinned: item.isPinned,
          context: TabContext(
            selectedTabID: selectedTabID,
            selectionState: selectionState,
            selectedTint: nil,
            surface: surface
          )
        )
      case .group(let group):
        let hasUnread = group.tabs.contains { tab in
          guard let chrome = surface.tabsByID[tab.id] else { return false }
          return chrome.panes.contains(where: { $0.indicator == .attention })
            || chrome.horizontalAgentStatus == .needsInput
        }
        result[.group(group.id)] = TerminalHorizontalTabItemPresentation(
          content: .group(
            id: group.id,
            title: group.title,
            color: group.color,
            iconURL: surface.groupIconURLs[group.id],
            isCollapsed: snapshot.collapsedGroupIDs.contains(group.id),
            hasUnread: hasUnread,
            tabCount: group.tabs.count
          ),
          selection: .none,
          selectedTint: group.color
        )
        for tab in group.tabs {
          result[.tab(tab.id)] = tabPresentation(
            tab,
            isPinned: false,
            context: TabContext(
              selectedTabID: selectedTabID,
              selectionState: selectionState,
              selectedTint: group.color,
              surface: surface
            )
          )
        }
      }
    }
    return result
  }

  static func measureContent(
    _ presentation: TerminalHorizontalTabItemPresentation?,
    fallback: String
  ) -> CGFloat {
    guard let presentation else {
      return measure(fallback, font: TerminalHorizontalTabTypography.titleFont)
    }
    switch presentation.content {
    case .group(_, let title, _, _, _, _, _):
      return measure(title, font: TerminalHorizontalTabTypography.groupTitleFont)
    case .tab(_, let title, let subtitle, _, let agentStatus, _):
      let titleWidth = measure(title, font: TerminalHorizontalTabTypography.titleFont)
      let subtitleWidth =
        subtitle.map {
          measure($0, font: TerminalHorizontalTabTypography.subtitleFont)
        } ?? 0
      return max(titleWidth, subtitleWidth) + (agentStatus == nil ? 0 : 18)
    }
  }

  private static func tabPresentation(
    _ tab: TerminalTabItem,
    isPinned: Bool,
    context: TabContext
  ) -> TerminalHorizontalTabItemPresentation {
    let chrome = context.surface.tabsByID[tab.id] ?? .empty
    let paneTitle = chrome.panes.first(where: \.isFocused)?.title ?? chrome.panes.first?.title
    let subtitle: String? =
      if tab.isTitleLocked, paneTitle != tab.title {
        paneTitle
      } else {
        nil
      }
    return TerminalHorizontalTabItemPresentation(
      content: .tab(
        id: tab.id,
        title: chrome.horizontalTitle(for: tab),
        subtitle: subtitle,
        accessibilityTitle: chrome.horizontalAccessibilityTitle(for: tab),
        agentStatus: chrome.horizontalAgentStatus,
        trailingStatus: chrome.horizontalTrailingStatus(for: tab, isPinned: isPinned)
      ),
      selection: context.selectionState?.style(for: tab.id, primaryTabID: context.selectedTabID)
        ?? (tab.id == context.selectedTabID ? .primary : .none),
      selectedTint: context.selectedTint
    )
  }

  private static func measure(_ title: String, font: NSFont) -> CGFloat {
    let label = NSTextField(labelWithString: title)
    label.font = font
    label.lineBreakMode = .byTruncatingTail
    label.maximumNumberOfLines = 1
    return ceil(label.fittingSize.width)
  }
}

extension TerminalHorizontalTabItemPresentation {
  var displayTitle: String {
    switch content {
    case .group(_, let title, _, _, _, _, _), .tab(_, let title, _, _, _, _):
      title
    }
  }
}
