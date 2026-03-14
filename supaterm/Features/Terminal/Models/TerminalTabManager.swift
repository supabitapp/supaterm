import Observation

@MainActor
@Observable
final class TerminalTabManager {
  var tabs: [TerminalTabItem] = []
  var selectedTabId: TerminalTabID?

  func createTab(title: String, icon: String?, isTitleLocked: Bool = false) -> TerminalTabID {
    let tab = TerminalTabItem(title: title, icon: icon, isTitleLocked: isTitleLocked)
    if let selectedTabId,
      let selectedIndex = tabs.firstIndex(where: { $0.id == selectedTabId })
    {
      tabs.insert(tab, at: selectedIndex + 1)
    } else {
      tabs.append(tab)
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
}
