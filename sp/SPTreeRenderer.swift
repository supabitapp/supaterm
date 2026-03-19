import Foundation
import SupatermCLIShared

enum SPTreeRenderer {
  static func render(_ snapshot: SupatermTreeSnapshot) -> String {
    var lines: [String] = []

    for (windowOffset, window) in snapshot.windows.enumerated() {
      lines.append(windowLine(window))
      lines.append(contentsOf: renderWorkspaces(window.workspaces))

      if windowOffset < snapshot.windows.count - 1 {
        lines.append("")
      }
    }

    return lines.joined(separator: "\n")
  }

  private static func renderWorkspaces(_ workspaces: [SupatermTreeSnapshot.Workspace]) -> [String] {
    workspaces.enumerated().flatMap { workspaceOffset, workspace in
      let isLastWorkspace = workspaceOffset == workspaces.count - 1
      let workspaceBranch = isLastWorkspace ? "└─ " : "├─ "
      let workspacePrefix = isLastWorkspace ? "   " : "│  "

      var lines = ["\(workspaceBranch)\(workspaceLine(workspace))"]
      lines.append(contentsOf: renderTabs(workspace.tabs, prefix: workspacePrefix))
      return lines
    }
  }

  private static func renderTabs(
    _ tabs: [SupatermTreeSnapshot.Tab],
    prefix: String
  ) -> [String] {
    tabs.enumerated().flatMap { tabOffset, tab in
      let isLastTab = tabOffset == tabs.count - 1
      let tabBranch = isLastTab ? "└─ " : "├─ "
      let tabPrefix = prefix + (isLastTab ? "   " : "│  ")

      var lines = ["\(prefix)\(tabBranch)\(tabLine(tab))"]
      lines.append(
        contentsOf: tab.panes.enumerated().map { paneOffset, pane in
          let paneBranch = paneOffset == tab.panes.count - 1 ? "└─ " : "├─ "
          return "\(tabPrefix)\(paneBranch)\(paneLine(pane))"
        }
      )
      return lines
    }
  }

  private static func windowLine(_ window: SupatermTreeSnapshot.Window) -> String {
    var labels: [String] = []
    if window.isKey {
      labels.append("key")
    }

    if labels.isEmpty {
      return "window \(window.index)"
    }
    return "window \(window.index) [\(labels.joined(separator: ", "))]"
  }

  private static func workspaceLine(_ workspace: SupatermTreeSnapshot.Workspace) -> String {
    var labels: [String] = []
    if workspace.isSelected {
      labels.append("selected")
    }

    if labels.isEmpty {
      return "workspace \(workspace.index) \"\(workspace.name)\""
    }
    return "workspace \(workspace.index) \"\(workspace.name)\" [\(labels.joined(separator: ", "))]"
  }

  private static func tabLine(_ tab: SupatermTreeSnapshot.Tab) -> String {
    var labels: [String] = []
    if tab.isSelected {
      labels.append("selected")
    }

    if labels.isEmpty {
      return "tab \(tab.index) \"\(tab.title)\""
    }
    return "tab \(tab.index) \"\(tab.title)\" [\(labels.joined(separator: ", "))]"
  }

  private static func paneLine(_ pane: SupatermTreeSnapshot.Pane) -> String {
    var labels: [String] = []
    if pane.isFocused {
      labels.append("focused")
    }

    if labels.isEmpty {
      return "pane \(pane.index)"
    }
    return "pane \(pane.index) [\(labels.joined(separator: ", "))]"
  }
}
