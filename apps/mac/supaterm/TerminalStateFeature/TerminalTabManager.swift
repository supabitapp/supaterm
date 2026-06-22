import Observation
import SupatermTerminalModels

@MainActor
@Observable
public final class TerminalTabManager {
  public var tabs: [TerminalTabItem] = []
  public var selectedTabId: TerminalTabID?

  public init() {}

  public var pinnedTabs: [TerminalTabItem] {
    tabs.filter(\.isPinned)
  }

  public var regularTabs: [TerminalTabItem] {
    tabs.filter { !$0.isPinned }
  }

  public var visibleTabs: [TerminalTabItem] {
    tabs
  }

  public func createTab(
    title: String,
    isPinned: Bool = false,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    let tab = TerminalTabItem(
      title: title,
      isPinned: isPinned,
      isTitleLocked: isTitleLocked
    )
    if isPinned {
      tabs = pinnedTabs + [tab] + regularTabs
    } else {
      tabs.append(tab)
    }
    selectedTabId = tab.id
    return tab.id
  }

  public func selectTab(_ id: TerminalTabID) {
    guard tabs.contains(where: { $0.id == id }) else { return }
    selectedTabId = id
  }

  public func clearSelection() {
    selectedTabId = nil
  }

  public func updateTitle(_ id: TerminalTabID, title: String) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    guard !tabs[index].isTitleLocked else { return }
    tabs[index].title = title
  }

  public func setLockedTitle(_ id: TerminalTabID, title: String?) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs[index].isTitleLocked = title != nil
    if let title {
      tabs[index].title = title
    }
  }

  public func updateDirty(_ id: TerminalTabID, isDirty: Bool) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    tabs[index].isDirty = isDirty
  }

  public func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    let pinnedByID = Dictionary(uniqueKeysWithValues: pinnedTabs.map { ($0.id, $0) })
    let orderedPinnedTabs = orderedIDs.compactMap { pinnedByID[$0] }
    guard orderedPinnedTabs.count == pinnedTabs.count else { return }
    setVisibleTabs(orderedPinnedTabs + regularTabs)
  }

  public func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    let regularByID = Dictionary(uniqueKeysWithValues: regularTabs.map { ($0.id, $0) })
    let orderedRegularTabs = orderedIDs.compactMap { regularByID[$0] }
    guard orderedRegularTabs.count == regularTabs.count else { return }
    setVisibleTabs(pinnedTabs + orderedRegularTabs)
  }

  public func moveTab(
    _ id: TerminalTabID,
    pinnedOrder: [TerminalTabID],
    regularOrder: [TerminalTabID]
  ) {
    guard var tab = tabs.first(where: { $0.id == id }) else { return }

    let isPinnedDestination = pinnedOrder.contains(id)
    let isRegularDestination = regularOrder.contains(id)
    guard isPinnedDestination != isRegularDestination else { return }

    var pinnedTabs = pinnedTabs
    var regularTabs = regularTabs

    if tab.isPinned {
      pinnedTabs.removeAll { $0.id == id }
    } else {
      regularTabs.removeAll { $0.id == id }
    }

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

    setVisibleTabs(orderedPinnedTabs + orderedRegularTabs)
  }

  public func togglePinned(_ id: TerminalTabID) {
    guard let tab = tabs.first(where: { $0.id == id }) else { return }
    moveTab(id, toPinned: !tab.isPinned)
  }

  public func closeTab(_ id: TerminalTabID) {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return }
    let wasSelected = selectedTabId == id
    tabs.remove(at: index)
    guard wasSelected else { return }
    if tabs.indices.contains(index) {
      selectedTabId = tabs[index].id
    } else if let lastTab = tabs.last {
      selectedTabId = lastTab.id
    } else {
      selectedTabId = nil
    }
  }

  public func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return [] }
    let nextIndex = tabs.index(after: index)
    guard nextIndex < tabs.endIndex else { return [] }
    return tabs[nextIndex...].map(\.id)
  }

  public func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    tabs.map(\.id).filter { $0 != id }
  }

  public func restoreTabs(
    _ tabs: [TerminalTabItem],
    selectedTabID: TerminalTabID?
  ) {
    self.tabs = tabs
    self.selectedTabId =
      selectedTabID.flatMap { id in
        tabs.contains(where: { $0.id == id }) ? id : nil
      }
      ?? tabs.first?.id
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
