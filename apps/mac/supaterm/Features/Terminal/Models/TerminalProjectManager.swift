import Observation

struct TerminalProjectTabs: Equatable {
  let projectID: TerminalProjectID
  var tabs: [TerminalTabItem]
}

@MainActor
@Observable
final class TerminalProjectManager {
  private(set) var projects: [TerminalProjectItem] = []
  private var tabsByProjectID: [TerminalProjectID: [TerminalTabItem]] = [:]
  var selectedTabId: TerminalTabID?

  var tabs: [TerminalTabItem] {
    projects.flatMap { tabsByProjectID[$0.id] ?? [] }
  }

  var regularTabs: [TerminalTabItem] {
    tabs.filter { !$0.isPinned }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  var groups: [TerminalProjectTabs] {
    projects.map { project in
      TerminalProjectTabs(
        projectID: project.id,
        tabs: tabsByProjectID[project.id] ?? []
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
      tabsByProjectID
      .filter { !nextIDs.contains($0.key) }
      .flatMap { $0.value.map(\.id) }

    self.projects = projects
    tabsByProjectID = Dictionary(
      uniqueKeysWithValues: projects.map { project in
        (project.id, tabsByProjectID[project.id] ?? [])
      }
    )
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
    guard tabsByProjectID[projectID] != nil else { return nil }
    let tab = TerminalTabItem(
      id: id,
      title: title,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    var projectTabs = tabsByProjectID[projectID] ?? []
    let insertionIndex =
      isPinned
      ? projectTabs.firstIndex(where: { !$0.isPinned }) ?? projectTabs.endIndex
      : projectTabs.endIndex
    projectTabs.insert(tab, at: insertionIndex)
    tabsByProjectID[projectID] = projectTabs
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
    guard tabsByProjectID[projectID] != nil else { return }
    guard let sourceProjectID = self.projectID(for: id) else { return }
    guard var tab = removeTab(id, from: sourceProjectID) else { return }
    tab.isPinned = isPinned

    var destinationTabs = tabsByProjectID[projectID] ?? []
    let laneIndices = destinationTabs.indices.filter { destinationTabs[$0].isPinned == isPinned }
    let laneStart = laneIndices.first ?? (isPinned ? 0 : destinationTabs.count)
    let laneCount = laneIndices.count
    let resolvedIndex = laneStart + max(0, min(destinationIndex, laneCount))
    destinationTabs.insert(tab, at: resolvedIndex)
    tabsByProjectID[projectID] = destinationTabs
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
    guard let projectID = projectID(for: id) else { return }
    let previousTabs = tabs
    guard let previousIndex = previousTabs.firstIndex(where: { $0.id == id }) else { return }
    let wasSelected = selectedTabId == id
    _ = removeTab(id, from: projectID)
    guard wasSelected else { return }

    let remainingTabs = tabs
    if remainingTabs.indices.contains(previousIndex) {
      selectedTabId = remainingTabs[previousIndex].id
    } else {
      selectedTabId = remainingTabs.last?.id
    }
  }

  func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    guard
      let projectID = projectID(for: id),
      let projectTabs = tabsByProjectID[projectID],
      let index = projectTabs.firstIndex(where: { $0.id == id })
    else { return [] }
    let nextIndex = projectTabs.index(after: index)
    guard nextIndex < projectTabs.endIndex else { return [] }
    return projectTabs[nextIndex...].map(\.id)
  }

  func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let projectID = projectID(for: id) else { return [] }
    return (tabsByProjectID[projectID] ?? []).map(\.id).filter { $0 != id }
  }

  func restoreTabs(
    _ groups: [TerminalProjectTabs],
    selectedTabID: TerminalTabID?
  ) {
    let restoredByProjectID = Dictionary(uniqueKeysWithValues: groups.map { ($0.projectID, $0.tabs) })
    tabsByProjectID = Dictionary(
      uniqueKeysWithValues: projects.map { project in
        (project.id, ordered(restoredByProjectID[project.id] ?? []))
      }
    )
    selectedTabId = selectedTabID.flatMap { tab(for: $0) == nil ? nil : $0 } ?? tabs.first?.id
  }

  func tab(for id: TerminalTabID) -> TerminalTabItem? {
    guard let projectID = projectID(for: id) else { return nil }
    return tabsByProjectID[projectID]?.first(where: { $0.id == id })
  }

  func projectID(for tabID: TerminalTabID) -> TerminalProjectID? {
    projects.first { project in
      tabsByProjectID[project.id]?.contains(where: { $0.id == tabID }) == true
    }?.id
  }

  func project(for tabID: TerminalTabID) -> TerminalProjectItem? {
    guard let projectID = projectID(for: tabID) else { return nil }
    return projects.first(where: { $0.id == projectID })
  }

  func project(at index: Int) -> TerminalProjectItem? {
    let offset = index - 1
    guard projects.indices.contains(offset) else { return nil }
    return projects[offset]
  }

  func projectIndex(for projectID: TerminalProjectID) -> Int? {
    projects.firstIndex(where: { $0.id == projectID }).map { $0 + 1 }
  }

  func tabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    tabsByProjectID[projectID] ?? []
  }

  func tabs(in projectID: TerminalProjectID, isPinned: Bool) -> [TerminalTabItem] {
    (tabsByProjectID[projectID] ?? []).filter { $0.isPinned == isPinned }
  }

  private func updateTab(
    _ id: TerminalTabID,
    update: (inout TerminalTabItem) -> Void
  ) {
    guard let projectID = projectID(for: id) else { return }
    guard let index = tabsByProjectID[projectID]?.firstIndex(where: { $0.id == id }) else { return }
    update(&tabsByProjectID[projectID]![index])
  }

  private func removeTab(
    _ id: TerminalTabID,
    from projectID: TerminalProjectID
  ) -> TerminalTabItem? {
    guard let index = tabsByProjectID[projectID]?.firstIndex(where: { $0.id == id }) else {
      return nil
    }
    return tabsByProjectID[projectID]?.remove(at: index)
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
