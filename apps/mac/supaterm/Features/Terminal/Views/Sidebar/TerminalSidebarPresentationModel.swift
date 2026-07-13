enum TerminalSidebarSemanticPath: Equatable {
  case project(isPinned: Bool, laneIndex: Int)
  case tab(projectID: TerminalProjectID, isPinned: Bool, laneIndex: Int)
}

struct TerminalSidebarPresentationModel: Equatable {
  let entries: [TerminalSidebarEntry]
  let visibleEntries: [TerminalSidebarEntry]
  let semanticPathByEntryID: [TerminalSidebarEntryID: TerminalSidebarSemanticPath]

  init(
    entries: [TerminalSidebarEntry],
    collapsedProjectIDs: Set<TerminalProjectID>
  ) {
    self.entries = entries

    var visibleEntries: [TerminalSidebarEntry] = []
    var semanticPathByEntryID: [TerminalSidebarEntryID: TerminalSidebarSemanticPath] = [:]
    var projectLaneCounts: [Bool: Int] = [:]
    var tabLaneCounts: [TerminalProjectID: [Bool: Int]] = [:]

    for entry in entries {
      switch entry.kind {
      case .project(_, let isPinned):
        let laneIndex = projectLaneCounts[isPinned, default: 0]
        projectLaneCounts[isPinned] = laneIndex + 1
        semanticPathByEntryID[entry.id] = .project(
          isPinned: isPinned,
          laneIndex: laneIndex
        )
        visibleEntries.append(entry)
      case .tab(_, let projectID, let isPinned):
        let laneIndex = tabLaneCounts[projectID, default: [:]][isPinned, default: 0]
        tabLaneCounts[projectID, default: [:]][isPinned] = laneIndex + 1
        semanticPathByEntryID[entry.id] = .tab(
          projectID: projectID,
          isPinned: isPinned,
          laneIndex: laneIndex
        )
        if !collapsedProjectIDs.contains(projectID) {
          visibleEntries.append(entry)
        }
      case .newProject:
        visibleEntries.append(entry)
      }
    }

    self.visibleEntries = visibleEntries
    self.semanticPathByEntryID = semanticPathByEntryID
  }
}
