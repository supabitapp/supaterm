struct TerminalSidebarPresentationModel: Equatable {
  let entries: [TerminalSidebarEntry]
  let visibleEntries: [TerminalSidebarEntry]

  init(
    entries: [TerminalSidebarEntry],
    collapsedProjectIDs: Set<TerminalProjectID>
  ) {
    self.entries = entries
    visibleEntries = entries.filter { entry in
      switch entry.kind {
      case .tab(_, let projectID, _):
        !collapsedProjectIDs.contains(projectID)
      case .newProject:
        true
      case .project:
        true
      }
    }
  }
}
