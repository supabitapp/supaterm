import Foundation
import SupatermCLIShared

enum SPDiagnosticTopologyRenderer {
  static func render(_ snapshot: SupatermAppDebugSnapshot) -> String {
    var lines: [String] = []
    for (windowOffset, window) in snapshot.windows.enumerated() {
      let suffix = window.isKey ? " [key]" : ""
      lines.append("window \(window.index)\(suffix)")
      lines.append(
        contentsOf: renderSpaces(window.spaces, displayedSpaceID: window.displayedSpaceID))
      if windowOffset < snapshot.windows.count - 1 {
        lines.append("")
      }
    }
    return lines.joined(separator: "\n")
  }

  private static func renderSpaces(
    _ spaces: [SupatermAppDebugSnapshot.Space],
    displayedSpaceID: UUID
  ) -> [String] {
    spaces.enumerated().flatMap { offset, space in
      let isLast = offset == spaces.count - 1
      let branch = isLast ? "└─ " : "├─ "
      let prefix = isLast ? "   " : "│  "
      var labels = [space.color.rawValue]
      if space.id == displayedSpaceID {
        labels.append("displayed")
      }
      if !space.isWarm {
        labels.append("cold")
      }
      return ["\(branch)space \(space.index) \"\(space.name)\" [\(labels.joined(separator: ", "))]"]
        + renderRootItems(space.rootItems, prefix: prefix)
    }
  }

  private static func renderRootItems(
    _ items: [SupatermAppDebugSnapshot.RootItem],
    prefix: String
  ) -> [String] {
    var tabIndex = 0
    return items.enumerated().flatMap { offset, item in
      let isLast = offset == items.count - 1
      let branch = isLast ? "└─ " : "├─ "
      let childPrefix = prefix + (isLast ? "   " : "│  ")
      switch item {
      case .group(let group):
        var labels = [group.color.rawValue]
        if group.isPinned {
          labels.append("pinned")
        }
        if group.isCollapsed {
          labels.append("collapsed")
        }
        let id = group.id.uuidString.lowercased()
        let label = labels.joined(separator: ", ")
        var lines = ["\(prefix)\(branch)group \(id) \"\(group.title)\" [\(label)]"]
        for (tabOffset, tab) in group.tabs.enumerated() {
          tabIndex += 1
          lines += renderTab(
            tab,
            tabIndex: tabIndex,
            isPinned: false,
            isLast: tabOffset == group.tabs.count - 1,
            prefix: childPrefix
          )
        }
        return lines
      case .tab(let rootTab):
        tabIndex += 1
        return renderTab(
          rootTab.tab,
          tabIndex: tabIndex,
          isPinned: rootTab.isPinned,
          isLast: isLast,
          prefix: prefix,
          branch: branch
        )
      }
    }
  }

  private static func renderTab(
    _ tab: SupatermAppDebugSnapshot.Tab,
    tabIndex: Int,
    isPinned: Bool,
    isLast: Bool,
    prefix: String,
    branch: String? = nil
  ) -> [String] {
    let tabBranch = branch ?? (isLast ? "└─ " : "├─ ")
    let panePrefix = prefix + (isLast ? "   " : "│  ")
    let labels: [String?] = [
      tab.isSelected ? "selected" : nil,
      isPinned ? "pinned" : nil,
    ]
    let renderedLabels = labels.compactMap(\.self)
    let suffix = renderedLabels.isEmpty ? "" : " [\(renderedLabels.joined(separator: ", "))]"
    let line = "\(prefix)\(tabBranch)tab \(tabIndex) \"\(tab.title)\"\(suffix)"
    return [line]
      + tab.panes.enumerated().map { offset, pane in
        let branch = offset == tab.panes.count - 1 ? "└─ " : "├─ "
        let title = pane.displayTitle.isEmpty ? "" : " \"\(pane.displayTitle)\""
        let suffix = pane.isFocused ? " [focused]" : ""
        return "\(panePrefix)\(branch)pane \(pane.index)\(title)\(suffix)"
      }
  }
}
