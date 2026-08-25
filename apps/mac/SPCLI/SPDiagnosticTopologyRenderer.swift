import Foundation
import SupatermCLIShared

enum SPDiagnosticTopologyRenderer {
  static func render(_ snapshot: SupatermAppDebugSnapshot) -> String {
    snapshot.windows.map { window in
      let suffix = window.isKey ? " [key]" : ""
      return
        (["window \(window.index)\(suffix)"]
        + renderSpaces(
          window.spaces,
          displayedSpaceID: window.displayedSpaceID,
          projects: snapshot.projects
        ))
        .joined(separator: "\n")
    }.joined(separator: "\n\n")
  }

  private static func renderSpaces(
    _ spaces: [SupatermAppDebugSnapshot.Space],
    displayedSpaceID: UUID,
    projects: [SupatermSnapshotProject]
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
        + renderSections(space.tabs, projects: projects, prefix: prefix)
    }
  }

  private static func renderSections(
    _ tabs: [SupatermAppDebugSnapshot.Tab],
    projects: [SupatermSnapshotProject],
    prefix: String
  ) -> [String] {
    let knownProjectIDs = Set(projects.map(\.id))
    let sections = projects.compactMap { project -> (String, [SupatermAppDebugSnapshot.Tab])? in
      let projectTabs = tabs.filter { $0.projectID == project.id }
      guard !projectTabs.isEmpty else { return nil }
      let labels = ([project.isPinned ? "pinned" : nil, project.color.rawValue] as [String?])
        .compactMap(\.self)
        .joined(separator: ", ")
      return ("project \(project.id.uuidString.lowercased()) \"\(project.name)\" [\(labels)]", projectTabs)
    }
    let unassignedTabs = tabs.filter { $0.projectID.map(knownProjectIDs.contains) != true }
    let visibleSections = sections + (unassignedTabs.isEmpty ? [] : [("Unassigned", unassignedTabs)])
    return visibleSections.enumerated().flatMap { sectionOffset, section in
      let sectionIsLast = sectionOffset == visibleSections.count - 1
      let sectionBranch = sectionIsLast ? "└─ " : "├─ "
      let tabPrefix = prefix + (sectionIsLast ? "   " : "│  ")
      return ["\(prefix)\(sectionBranch)\(section.0)"]
        + section.1.enumerated().flatMap { tabOffset, tab in
          renderTab(
            tab,
            tabIndex: tabs.firstIndex(where: { $0.id == tab.id })! + 1,
            isPinned: tab.isPinned,
            isLast: tabOffset == section.1.count - 1,
            prefix: tabPrefix
          )
        }
    }
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
        labels.append("status=\(pane.agentStatus?.rawValue ?? "unknown")")
        return "\(panePrefix)\(branch)pane \(pane.index)\(title) [\(labels.joined(separator: ", "))]"
      }
  }
}
