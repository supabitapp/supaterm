import Observation

@MainActor
@Observable
final class TerminalTabManager {
  private var projectOrder: [TerminalProjectID]
  var tabs: [TerminalTabItem] = []
  var selectedTabId: TerminalTabID?

  init(projectIDs: [TerminalProjectID]) {
    precondition(!projectIDs.isEmpty)
    self.projectOrder = projectIDs
  }

  var pinnedTabs: [TerminalTabItem] {
    tabs.filter(\.isPinned)
  }

  var regularTabs: [TerminalTabItem] {
    tabs.filter { !$0.isPinned }
  }

  func tabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    tabs.filter { $0.projectID == projectID }
  }

  func pinnedTabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    tabs(in: projectID).filter(\.isPinned)
  }

  func regularTabs(in projectID: TerminalProjectID) -> [TerminalTabItem] {
    tabs(in: projectID).filter { !$0.isPinned }
  }

  func createTab(
    projectID: TerminalProjectID,
    title: String,
    isPinned: Bool = false,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    precondition(projectOrder.contains(projectID))
    let tab = TerminalTabItem(
      projectID: projectID,
      title: title,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    tabs.append(tab)
    normalizeOrder()
    selectedTabId = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard tabs.contains(where: { $0.id == id }) else { return }
    selectedTabId = id
  }

  func clearSelection() {
    selectedTabId = nil
  }

  func updateTitle(_ id: TerminalTabID, title: String) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    guard !tabs[index].isTitleLocked else { return }
    tabs[index].title = title
  }

  func setLockedTitle(_ id: TerminalTabID, title: String?) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs[index].isTitleLocked = title != nil
    if let title {
      tabs[index].title = title
    }
  }

  func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs[index].isDirty = isDirty
  }

  func setPinnedTabOrder(
    _ orderedIDs: [TerminalTabID],
    in projectID: TerminalProjectID
  ) {
    let pinnedTabs = pinnedTabs(in: projectID)
    let pinnedByID = Dictionary(uniqueKeysWithValues: pinnedTabs.map { ($0.id, $0) })
    let orderedPinnedTabs = orderedIDs.compactMap { pinnedByID[$0] }
    guard orderedPinnedTabs.count == pinnedTabs.count else { return }
    replaceTabs(
      in: projectID,
      with: orderedPinnedTabs + regularTabs(in: projectID)
    )
  }

  func setRegularTabOrder(
    _ orderedIDs: [TerminalTabID],
    in projectID: TerminalProjectID
  ) {
    let regularTabs = regularTabs(in: projectID)
    let regularByID = Dictionary(uniqueKeysWithValues: regularTabs.map { ($0.id, $0) })
    let orderedRegularTabs = orderedIDs.compactMap { regularByID[$0] }
    guard orderedRegularTabs.count == regularTabs.count else { return }
    replaceTabs(
      in: projectID,
      with: pinnedTabs(in: projectID) + orderedRegularTabs
    )
  }

  func moveTab(
    _ id: TerminalTabID,
    pinnedOrder: [TerminalTabID],
    regularOrder: [TerminalTabID]
  ) {
    guard var tab = tabs.first(where: { $0.id == id }) else { return }
    let projectID = tab.projectID
    let isPinnedDestination = pinnedOrder.contains(id)
    let isRegularDestination = regularOrder.contains(id)
    guard isPinnedDestination != isRegularDestination else { return }

    var pinnedTabs = pinnedTabs(in: projectID).filter { $0.id != id }
    var regularTabs = regularTabs(in: projectID).filter { $0.id != id }
    tab.isPinned = isPinnedDestination
    if isPinnedDestination {
      pinnedTabs.append(tab)
    } else {
      regularTabs.append(tab)
    }

    let pinnedByID = Dictionary(uniqueKeysWithValues: pinnedTabs.map { ($0.id, $0) })
    let regularByID = Dictionary(uniqueKeysWithValues: regularTabs.map { ($0.id, $0) })
    let orderedPinnedTabs = pinnedOrder.compactMap { pinnedByID[$0] }
    let orderedRegularTabs = regularOrder.compactMap { regularByID[$0] }
    guard
      orderedPinnedTabs.count == pinnedTabs.count,
      orderedRegularTabs.count == regularTabs.count
    else {
      return
    }
    replaceTabs(in: projectID, with: orderedPinnedTabs + orderedRegularTabs)
  }

  func togglePinned(_ id: TerminalTabID) {
    guard var tab = tabs.first(where: { $0.id == id }) else { return }
    let projectID = tab.projectID
    tab.isPinned.toggle()
    let remainingTabs = tabs(in: projectID).filter { $0.id != id }
    let pinnedTabs = remainingTabs.filter(\.isPinned)
    let regularTabs = remainingTabs.filter { !$0.isPinned }
    replaceTabs(
      in: projectID,
      with: tab.isPinned ? pinnedTabs + [tab] + regularTabs : pinnedTabs + regularTabs + [tab]
    )
  }

  func closeTab(_ id: TerminalTabID) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    let wasSelected = selectedTabId == id
    tabs.remove(at: index)
    guard wasSelected else { return }
    if tabs.indices.contains(index) {
      selectedTabId = tabs[index].id
    } else {
      selectedTabId = tabs.last?.id
    }
  }

  func closeTabs(in projectIDs: Set<TerminalProjectID>) -> [TerminalTabID] {
    let removedTabIDs = tabs.filter { projectIDs.contains($0.projectID) }.map(\.id)
    for tabID in removedTabIDs {
      closeTab(tabID)
    }
    return removedTabIDs
  }

  func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let tab = tabs.first(where: { $0.id == id }) else { return [] }
    let projectTabs = tabs(in: tab.projectID)
    guard let index = projectTabs.firstIndex(where: { $0.id == id }) else { return [] }
    let nextIndex = projectTabs.index(after: index)
    guard nextIndex < projectTabs.endIndex else { return [] }
    return projectTabs[nextIndex...].map(\.id)
  }

  func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let tab = tabs.first(where: { $0.id == id }) else { return [] }
    return tabs(in: tab.projectID).map(\.id).filter { $0 != id }
  }

  func restoreTabs(
    _ tabs: [TerminalTabItem],
    selectedTabID: TerminalTabID?
  ) {
    self.tabs = tabs.filter { projectOrder.contains($0.projectID) }
    normalizeOrder()
    self.selectedTabId =
      selectedTabID.flatMap { id in
        self.tabs.contains(where: { $0.id == id }) ? id : nil
      }
      ?? self.tabs.first?.id
  }

  func updateProjectOrder(_ projectIDs: [TerminalProjectID]) -> [TerminalTabID] {
    precondition(!projectIDs.isEmpty)
    let validProjectIDs = Set(projectIDs)
    let removedTabIDs = closeTabs(
      in: Set(projectOrder).subtracting(validProjectIDs)
    )
    projectOrder = projectIDs
    normalizeOrder()
    return removedTabIDs
  }

  private func replaceTabs(
    in projectID: TerminalProjectID,
    with projectTabs: [TerminalTabItem]
  ) {
    tabs.removeAll { $0.projectID == projectID }
    tabs.append(contentsOf: projectTabs)
    normalizeOrder()
    if !tabs.contains(where: { $0.id == selectedTabId }) {
      selectedTabId = tabs.first?.id
    }
  }

  private func normalizeOrder() {
    tabs = projectOrder.flatMap { projectID in
      let projectTabs = tabs.filter { $0.projectID == projectID }
      return projectTabs.filter(\.isPinned) + projectTabs.filter { !$0.isPinned }
    }
  }
}
