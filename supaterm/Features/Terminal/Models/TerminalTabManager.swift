import Observation

@MainActor
@Observable
final class TerminalTabManager {
  var tabs: [TerminalTabItem] = []
  var selectedTabId: TerminalTabID?

  var pinnedTabs: [TerminalTabItem] {
    tabs.filter(\.isPinned)
  }

  var regularTabs: [TerminalTabItem] {
    tabs.filter { !$0.isPinned }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  func createTab(
    title: String,
    icon: String?,
    isPinned: Bool = false,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    let tab = TerminalTabItem(
      title: title,
      icon: icon,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    if isPinned {
      tabs = pinnedTabs + [tab] + regularTabs
    } else {
      tabs = pinnedTabs + regularTabs + [tab]
    }
    selectedTabId = tab.id
    return tab.id
  }

  func selectTab(_ id: TerminalTabID) {
    guard tabs.contains(where: { $0.id == id }) else { return }
    selectedTabId = id
  }

  func updateTitle(_ id: TerminalTabID, title: String) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    guard !tabs[index].isTitleLocked else { return }
    tabs[index].title = title
  }

  func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs[index].isDirty = isDirty
  }

  func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    let pinnedByID = Dictionary(uniqueKeysWithValues: pinnedTabs.map { ($0.id, $0) })
    let orderedPinnedTabs = orderedIDs.compactMap { pinnedByID[$0] }
    guard orderedPinnedTabs.count == pinnedTabs.count else { return }
    setVisibleTabs(orderedPinnedTabs + regularTabs)
  }

  func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    let regularByID = Dictionary(uniqueKeysWithValues: regularTabs.map { ($0.id, $0) })
    let orderedRegularTabs = orderedIDs.compactMap { regularByID[$0] }
    guard orderedRegularTabs.count == regularTabs.count else { return }
    setVisibleTabs(pinnedTabs + orderedRegularTabs)
  }

  func togglePinned(_ id: TerminalTabID) {
    guard let tab = tabs.first(where: { $0.id == id }) else { return }
    moveTab(id, toPinned: !tab.isPinned)
  }

  func closeTab(_ id: TerminalTabID) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs.remove(at: index)
    guard selectedTabId == id else { return }
    if index > 0 {
      selectedTabId = tabs[index - 1].id
    } else if !tabs.isEmpty {
      selectedTabId = tabs[0].id
    } else {
      selectedTabId = nil
    }
  }

  func closeAll() {
    tabs.removeAll()
    selectedTabId = nil
  }

  private func setVisibleTabs(_ visibleTabs: [TerminalTabItem]) {
    tabs = visibleTabs
    if tabs.contains(where: { $0.id == selectedTabId }) {
      return
    }
    selectedTabId = tabs.first?.id
  }

  private func moveTab(_ id: TerminalTabID, toPinned: Bool) {
    guard var tab = tabs.first(where: { $0.id == id }) else { return }

    var pinnedTabs = pinnedTabs
    var regularTabs = regularTabs

    if tab.isPinned {
      pinnedTabs.removeAll { $0.id == id }
    } else {
      regularTabs.removeAll { $0.id == id }
    }

    tab.isPinned = toPinned

    if toPinned {
      pinnedTabs.append(tab)
    } else {
      regularTabs.append(tab)
    }

    setVisibleTabs(pinnedTabs + regularTabs)
  }
}
