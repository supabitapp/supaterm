import Foundation
import SupatermCLIShared

enum SPDiagnosticTopologyRenderer {
  static func render(_ snapshot: SupatermAppDebugSnapshot) -> String {
    snapshot.windows.map { window in
      let suffix = window.isKey ? " [key]" : ""
      return
        (["window \(window.index)\(suffix)"]
        + renderSpaces(window.spaces, displayedSpaceID: window.displayedSpaceID))
        .joined(separator: "\n")
    }.joined(separator: "\n\n")
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
    var lines: [String] = []
    for (offset, item) in items.enumerated() {
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
        lines.append("\(prefix)\(branch)group \(id) \"\(group.title)\" [\(label)]")
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
      case .tab(let rootTab):
        tabIndex += 1
        lines += renderTab(
          rootTab.tab,
          tabIndex: tabIndex,
          isPinned: rootTab.isPinned,
          isLast: isLast,
          prefix: prefix
        )
      }
    }
    return lines
  }

  private static func renderTab(
    _ tab: SupatermAppDebugSnapshot.Tab,
    tabIndex: Int,
    isPinned: Bool,
    isLast: Bool,
    prefix: String
  ) -> [String] {
    let tabBranch = isLast ? "└─ " : "├─ "
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
        var labels: [String] = []
        if pane.isFocused {
          labels.append("focused")
        }
        if let agent = pane.agent {
          labels.append(
            "\(agent.kind.rawValue):\(agent.phase.rawValue) \(agent.phaseSource.rawValue)"
          )
          if let sessionID = agent.sessionID {
            labels.append("session=\(sessionID)")
          }
          if let ruleID = agent.ruleID {
            labels.append("rule=\(ruleID)")
          }
          if let process = agent.process {
            labels.append("pid=\(process.processID)")
          }
        }
        labels.append("status=\(pane.agentStatus.rawValue)")
        return "\(panePrefix)\(branch)pane \(pane.index)\(title) [\(labels.joined(separator: ", "))]"
      }
  }
}
