import Observation

struct TerminalProjectTabs: Equatable {
  let projectID: TerminalProjectID
  let tabs: [TerminalTabItem]
}

@MainActor
@Observable
final class TerminalProjectManager {
  private struct ProjectGroup {
    let project: TerminalProjectItem
    var tabs: [TerminalTabItem]
  }

  private var projectGroups: [ProjectGroup] = []
  var selectedTabId: TerminalTabID?

  var projects: [TerminalProjectItem] {
    projectGroups.map(\.project)
  }

  var tabs: [TerminalTabItem] {
    projectGroups.flatMap(\.tabs)
  }

  var regularTabs: [TerminalTabItem] {
    tabs.filter { !$0.isPinned }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  var groups: [TerminalProjectTabs] {
    projectGroups.map { group in
      TerminalProjectTabs(
        projectID: group.project.id,
        tabs: group.tabs
      )
    }
  }

  init(projects: [TerminalProjectItem] = []) {
    _ = applyProjects(projects)
  }

  @discardableResult
  func applyProjects(_ projects: [TerminalProjectItem]) -> [TerminalTabID] {
    let nextIDs = Set(projects.map(\.id))
    let removedTabIDs =
      projectGroups
      .filter { !nextIDs.contains($0.project.id) }
      .flatMap { $0.tabs.map(\.id) }
    let previousGroups = Dictionary(
      uniqueKeysWithValues: projectGroups.map { ($0.project.id, $0) }
    )
    projectGroups = projects.map { project in
      ProjectGroup(project: project, tabs: previousGroups[project.id]?.tabs ?? [])
    }
    repairSelection()
    return removedTabIDs
  }

  @discardableResult
  func createTab(
    title: String,
    in projectID: TerminalProjectID,
    id: TerminalTabID = TerminalTabID(),
    isPinned: Bool = false,
    isTitleLocked: Bool = false,
    selecting: Bool = true
  ) -> TerminalTabID? {
    guard let projectIndex = projectGroups.firstIndex(where: { $0.project.id == projectID }) else {
      return nil
    }
    let tab = TerminalTabItem(
      id: id,
      title: title,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    let insertionIndex =
      isPinned
      ? projectGroups[projectIndex].tabs.firstIndex(where: { !$0.isPinned })
        ?? projectGroups[projectIndex].tabs.endIndex
      : projectGroups[projectIndex].tabs.endIndex
    projectGroups[projectIndex].tabs.insert(tab, at: insertionIndex)
    if selecting || selectedTabId == nil {
      selectedTabId = tab.id
    }
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard tab(for: id) != nil else { return }
    selectedTabId = id
  }

  func clearSelection() {
    selectedTabId = nil
  }

  func updateTitle(_ id: TerminalTabID, title: String) {
    updateTab(id) { tab in
      guard !tab.isTitleLocked else { return }
      tab.title = title
    }
  }

  func setLockedTitle(_ id: TerminalTabID, title: String?) {
    updateTab(id) { tab in
      tab.isTitleLocked = title != nil
      if let title {
        tab.title = title
      }
    }
  }

  func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    updateTab(id) { $0.isDirty = isDirty }
  }

  func moveTab(
    _ id: TerminalTabID,
    to projectID: TerminalProjectID,
    isPinned: Bool,
    at destinationIndex: Int
  ) {
    guard let destinationProjectIndex = projectGroupIndex(for: projectID) else { return }
    guard let source = tabLocation(for: id) else { return }
    var tab = projectGroups[source.projectIndex].tabs.remove(at: source.tabIndex)
    tab.isPinned = isPinned

    let destinationTabs = projectGroups[destinationProjectIndex].tabs
    let laneIndices = destinationTabs.indices.filter { destinationTabs[$0].isPinned == isPinned }
    let laneStart = laneIndices.first ?? (isPinned ? 0 : destinationTabs.count)
    let laneCount = laneIndices.count
    let resolvedIndex = laneStart + max(0, min(destinationIndex, laneCount))
    projectGroups[destinationProjectIndex].tabs.insert(tab, at: resolvedIndex)
  }

  func togglePinned(_ id: TerminalTabID) {
    guard
      let projectID = projectID(for: id),
      let tab = tab(for: id)
    else { return }
    let nextPinned = !tab.isPinned
    moveTab(
      id,
      to: projectID,
      isPinned: nextPinned,
      at: tabs(in: projectID, isPinned: nextPinned).count
    )
  }

  func closeTab(_ id: TerminalTabID) {
    guard let location = tabLocation(for: id) else { return }
    let previousTabs = tabs
    guard let previousIndex = previousTabs.firstIndex(where: { $0.id == id }) else { return }
    let wasSelected = selectedTabId == id
    projectGroups[location.projectIndex].tabs.remove(at: location.tabIndex)
    guard wasSelected else { return }

    let remainingTabs = tabs
    if remainingTabs.indices.contains(previousIndex) {
      selectedTabId = remainingTabs[previousIndex].id
    } else {
      selectedTabId = remainingTabs.last?.id
    }
  }

  func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let location = tabLocation(for: id) else { return [] }
    let projectTabs = projectGroups[location.projectIndex].tabs
    let nextIndex = projectTabs.index(after: location.tabIndex)
    guard nextIndex < projectTabs.endIndex else { return [] }
    return projectTabs[nextIndex...].map(\.id)
  }

  func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let location = tabLocation(for: id) else { return [] }
    return projectGroups[location.projectIndex].tabs.map(\.id).filter { $0 != id }
  }

  func restoreTabs(
    _ groups: [TerminalProjectTabs],
    selectedTabID: TerminalTabID?
  ) {
    let restoredByProjectID = Dictionary(uniqueKeysWithValues: groups.map { ($0.projectID, $0.tabs) })
    for index in projectGroups.indices {
      let projectID = projectGroups[index].project.id
      projectGroups[index].tabs = ordered(restoredByProjectID[projectID] ?? [])
    }
    selectedTabId = selectedTabID.flatMap { tab(for: $0) == nil ? nil : $0 } ?? tabs.first?.id
  }

  func tab(for id: TerminalTabID) -> TerminalTabItem? {
    guard let location = tabLocation(for: id) else { return nil }
    return projectGroups[location.projectIndex].tabs[location.tabIndex]
  }

  func projectID(for tabID: TerminalTabID) -> TerminalProjectID? {
    guard let location = tabLocation(for: tabID) else { return nil }
    return projectGroups[location.projectIndex].project.id
  }

  func project(for tabID: TerminalTabID) -> TerminalProjectItem? {
    guard let location = tabLocation(for: tabID) else { return nil }
    return projectGroups[location.projectIndex].project
  }

  func project(at index: Int) -> TerminalProjectItem? {
    let offset = index - 1
    guard projectGroups.indices.contains(offset) else { return nil }
    return projectGroups[offset].project
  }

  func projectIndex(for projectID: TerminalProjectID) -> Int? {
    projectGroupIndex(for: projectID).map { $0 + 1 }
  }

  func tabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    guard let projectIndex = projectGroupIndex(for: projectID) else { return [] }
    return projectGroups[projectIndex].tabs
  }

  func tabs(in projectID: TerminalProjectID, isPinned: Bool) -> [TerminalTabItem] {
    tabs(in: projectID).filter { $0.isPinned == isPinned }
  }

  private func updateTab(
    _ id: TerminalTabID,
    update: (inout TerminalTabItem) -> Void
  ) {
    guard let location = tabLocation(for: id) else { return }
    update(&projectGroups[location.projectIndex].tabs[location.tabIndex])
  }

  private func projectGroupIndex(for projectID: TerminalProjectID) -> Int? {
    projectGroups.firstIndex { $0.project.id == projectID }
  }

  private func tabLocation(
    for tabID: TerminalTabID
  ) -> (projectIndex: Int, tabIndex: Int)? {
    for projectIndex in projectGroups.indices {
      if let tabIndex = projectGroups[projectIndex].tabs.firstIndex(where: { $0.id == tabID }) {
        return (projectIndex, tabIndex)
      }
    }
    return nil
  }

  private func ordered(_ tabs: [TerminalTabItem]) -> [TerminalTabItem] {
    tabs.filter(\.isPinned) + tabs.filter { !$0.isPinned }
  }

  private func repairSelection() {
    guard let selectedTabId else {
      self.selectedTabId = tabs.first?.id
      return
    }
    if tab(for: selectedTabId) == nil {
      self.selectedTabId = tabs.first?.id
    }
  }
}
