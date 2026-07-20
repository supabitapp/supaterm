import Foundation
import Observation

@MainActor
@Observable
final class TerminalTabManager {
  private(set) var rootItems: [TerminalTabRootItem] = []
  var selectedTabId: TerminalTabID?

  var tabs: [TerminalTabItem] {
    rootItems.flatMap(\.tabs)
  }

  var pinnedRootItems: [TerminalTabRootItem] {
    rootItems.filter(\.isPinned)
  }

  var regularRootItems: [TerminalTabRootItem] {
    rootItems.filter { !$0.isPinned }
  }

  var visibleTabs: [TerminalTabItem] {
    tabs
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false
  ) -> TerminalTabID {
    let placement = TerminalTabPlacement.root(
      TerminalRootPlacement(isPinned: false, index: regularRootItems.count)
    )
    return createTab(title: title, isTitleLocked: isTitleLocked, at: placement)!
  }

  func createTab(
    title: String,
    isTitleLocked: Bool = false,
    at placement: TerminalTabPlacement
  ) -> TerminalTabID? {
    let tab = TerminalTabItem(
      title: title,
      isTitleLocked: isTitleLocked
    )
    guard insertTab(tab, at: placement) else { return nil }
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
    updateTab(id) { tab in
      tab.isDirty = isDirty
    }
  }

  @discardableResult
  func createGroup(
    title: String,
    color: TerminalTabGroupColor = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupID? {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty else { return nil }
    guard Set(tabIDs).count == tabIDs.count else { return nil }

    let selectedTabs = tabIDs.compactMap(tab(for:))
    guard selectedTabs.count == tabIDs.count else { return nil }

    let insertion = groupInsertion(containing: tabIDs)
    guard tabIDs.isEmpty || insertion != nil else { return nil }
    let resolvedInsertion =
      insertion
      ?? TerminalRootPlacement(isPinned: false, index: regularRootItems.count)

    for tabID in tabIDs {
      _ = removeTab(tabID)
    }

    let group = TerminalTabGroupItem(
      title: normalizedTitle,
      color: color,
      isPinned: resolvedInsertion.isPinned,
      tabs: selectedTabs
    )
    guard insertRootItem(.group(group), at: resolvedInsertion) else {
      preconditionFailure("Resolved group insertion must remain valid")
    }
    repairSelection()
    return group.id
  }

  @discardableResult
  func renameGroup(_ id: TerminalTabGroupID, title: String) -> Bool {
    let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedTitle.isEmpty else { return false }
    guard let index = groupRootIndex(id) else { return false }
    guard case .group(var group) = rootItems[index] else { return false }
    group.title = normalizedTitle
    rootItems[index] = .group(group)
    return true
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: TerminalTabGroupColor) -> Bool {
    guard let index = groupRootIndex(id) else { return false }
    guard case .group(var group) = rootItems[index] else { return false }
    group.color = color
    rootItems[index] = .group(group)
    return true
  }

  @discardableResult
  func moveTab(_ id: TerminalTabID, to placement: TerminalTabPlacement) -> Bool {
    guard let tab = tab(for: id) else { return false }
    guard isValid(placement, afterRemoving: id) else { return false }
    _ = removeTab(id)
    guard insertTab(tab, at: placement) else {
      preconditionFailure("Validated tab placement must remain valid")
    }
    repairSelection()
    return true
  }

  @discardableResult
  func moveGroup(_ id: TerminalTabGroupID, to placement: TerminalRootPlacement) -> Bool {
    guard let sourceIndex = groupRootIndex(id) else { return false }
    guard isValid(placement, afterRemovingRootItemAt: sourceIndex) else { return false }
    guard case .group(var group) = rootItems.remove(at: sourceIndex) else {
      preconditionFailure("Resolved group root must remain a group")
    }
    group.isPinned = placement.isPinned
    guard insertRootItem(.group(group), at: placement) else {
      preconditionFailure("Validated group placement must remain valid")
    }
    return true
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> Bool {
    guard let sourceIndex = rootItems.firstIndex(where: { $0.id == id }) else { return false }
    let item = rootItems[sourceIndex]
    return setPinned(id, isPinned: !item.isPinned)
  }

  @discardableResult
  func setPinned(_ id: TerminalTabRootItemID, isPinned: Bool) -> Bool {
    guard let sourceIndex = rootItems.firstIndex(where: { $0.id == id }) else { return false }
    let item = rootItems[sourceIndex]
    guard item.isPinned != isPinned else { return true }
    let placement = TerminalRootPlacement(
      isPinned: isPinned,
      index: isPinned ? pinnedRootItems.count : regularRootItems.count
    )
    rootItems.remove(at: sourceIndex)
    let movedItem: TerminalTabRootItem
    switch item {
    case .tab(var tab):
      tab.isPinned = placement.isPinned
      movedItem = .tab(tab)
    case .group(var group):
      group.isPinned = placement.isPinned
      movedItem = .group(group)
    }
    guard insertRootItem(movedItem, at: placement) else {
      preconditionFailure("Pin destination must remain valid")
    }
    return true
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabID) -> Bool {
    guard let location = tabLocation(id) else { return false }
    switch location {
    case .root:
      return togglePinned(.tab(id))
    case .group:
      return moveTab(
        id,
        to: .root(
          TerminalRootPlacement(isPinned: true, index: pinnedRootItems.count)
        )
      )
    }
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> Bool {
    guard let location = tabLocation(id) else { return false }
    switch location {
    case .root:
      return setPinned(.tab(id), isPinned: isPinned)
    case .group:
      guard isPinned else { return true }
      return moveTab(
        id,
        to: .root(
          TerminalRootPlacement(isPinned: true, index: pinnedRootItems.count)
        )
      )
    }
  }

  @discardableResult
  func removeTabFromGroup(_ id: TerminalTabID) -> Bool {
    guard case .group(let groupID, _) = tabLocation(id) else { return false }
    guard let groupIndex = groupRootIndex(groupID) else { return false }
    guard case .group(let group) = rootItems[groupIndex] else { return false }
    let laneIndex = rootItems[..<groupIndex].count(where: { $0.isPinned == group.isPinned }) + 1
    return moveTab(
      id,
      to: .root(TerminalRootPlacement(isPinned: group.isPinned, index: laneIndex))
    )
  }

  @discardableResult
  func ungroup(_ id: TerminalTabGroupID) -> Bool {
    guard let index = groupRootIndex(id) else { return false }
    guard case .group(let group) = rootItems.remove(at: index) else { return false }
    let tabs = group.tabs.map {
      TerminalTabRootItem.tab(TerminalUngroupedTabItem(tab: $0, isPinned: group.isPinned))
    }
    rootItems.insert(contentsOf: tabs, at: index)
    repairSelection()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard let index = groupRootIndex(id) else { return false }
    guard case .group(let group) = rootItems[index], group.tabs.isEmpty else { return false }
    rootItems.remove(at: index)
    return true
  }

  func closeTab(_ id: TerminalTabID) {
    let previousTabs = tabs
    guard let index = previousTabs.firstIndex(where: { $0.id == id }) else { return }
    let wasSelected = selectedTabId == id
    _ = removeTab(id)
    guard wasSelected else { return }
    let remainingTabs = tabs
    if remainingTabs.indices.contains(index) {
      selectedTabId = remainingTabs[index].id
    } else {
      selectedTabId = remainingTabs.last?.id
    }
  }

  func tabIDsBelow(_ id: TerminalTabID) -> [TerminalTabID] {
    let tabs = tabs
    guard let index = tabs.firstIndex(where: { $0.id == id }) else { return [] }
    let nextIndex = tabs.index(after: index)
    guard nextIndex < tabs.endIndex else { return [] }
    return tabs[nextIndex...].map(\.id)
  }

  func otherTabIDs(_ id: TerminalTabID) -> [TerminalTabID] {
    tabs.map(\.id).filter { $0 != id }
  }

  func groupID(containing tabID: TerminalTabID) -> TerminalTabGroupID? {
    guard case .group(let groupID, _) = tabLocation(tabID) else { return nil }
    return groupID
  }

  func tabIDs(in groupID: TerminalTabGroupID) -> [TerminalTabID] {
    group(for: groupID)?.tabs.map(\.id) ?? []
  }

  func group(for id: TerminalTabGroupID) -> TerminalTabGroupItem? {
    guard let index = groupRootIndex(id), case .group(let group) = rootItems[index] else {
      return nil
    }
    return group
  }

  func rootItemID(containing tabID: TerminalTabID) -> TerminalTabRootItemID? {
    guard let location = tabLocation(tabID) else { return nil }
    switch location {
    case .root:
      return .tab(tabID)
    case .group(let groupID, _):
      return .group(groupID)
    }
  }

  func isPinned(_ tabID: TerminalTabID) -> Bool? {
    guard let location = tabLocation(tabID) else { return nil }
    switch location {
    case .root(let index):
      return rootItems[index].isPinned
    case .group:
      return false
    }
  }

  func restoreRootItems(
    _ rootItems: [TerminalTabRootItem],
    selectedTabID: TerminalTabID?
  ) {
    self.rootItems = Self.sanitized(rootItems)
    self.selectedTabId =
      selectedTabID.flatMap { id in
        tabs.contains(where: { $0.id == id }) ? id : nil
      }
      ?? tabs.first?.id
  }

  private enum TabLocation {
    case root(index: Int)
    case group(TerminalTabGroupID, index: Int)
  }

  private func tab(for id: TerminalTabID) -> TerminalTabItem? {
    tabs.first(where: { $0.id == id })
  }

  private func tabLocation(_ id: TerminalTabID) -> TabLocation? {
    for (rootIndex, item) in rootItems.enumerated() {
      switch item {
      case .tab(let item) where item.tab.id == id:
        return .root(index: rootIndex)
      case .group(let group):
        if let index = group.tabs.firstIndex(where: { $0.id == id }) {
          return .group(group.id, index: index)
        }
      default:
        continue
      }
    }
    return nil
  }

  @discardableResult
  private func removeTab(_ id: TerminalTabID) -> TerminalTabItem? {
    guard let location = tabLocation(id) else { return nil }
    switch location {
    case .root(let index):
      guard case .tab(let item) = rootItems.remove(at: index) else { return nil }
      return item.tab
    case .group(let groupID, let index):
      guard let rootIndex = groupRootIndex(groupID) else { return nil }
      guard case .group(var group) = rootItems[rootIndex] else { return nil }
      let tab = group.tabs.remove(at: index)
      rootItems[rootIndex] = .group(group)
      return tab
    }
  }

  @discardableResult
  private func insertTab(_ tab: TerminalTabItem, at placement: TerminalTabPlacement) -> Bool {
    switch placement {
    case .root(let placement):
      return insertRootItem(
        .tab(TerminalUngroupedTabItem(tab: tab, isPinned: placement.isPinned)),
        at: placement
      )
    case .group(let groupID, let index):
      guard let rootIndex = groupRootIndex(groupID) else { return false }
      guard case .group(var group) = rootItems[rootIndex] else { return false }
      guard (0...group.tabs.count).contains(index) else { return false }
      group.tabs.insert(tab, at: index)
      rootItems[rootIndex] = .group(group)
      return true
    }
  }

  private func updateTab(_ id: TerminalTabID, update: (inout TerminalTabItem) -> Void) {
    guard let location = tabLocation(id) else { return }
    switch location {
    case .root(let index):
      guard case .tab(var item) = rootItems[index] else { return }
      update(&item.tab)
      rootItems[index] = .tab(item)
    case .group(let groupID, let index):
      guard let rootIndex = groupRootIndex(groupID) else { return }
      guard case .group(var group) = rootItems[rootIndex] else { return }
      update(&group.tabs[index])
      rootItems[rootIndex] = .group(group)
    }
  }

  private func groupRootIndex(_ id: TerminalTabGroupID) -> Int? {
    rootItems.firstIndex(where: { $0.id == .group(id) })
  }

  private func groupInsertion(containing tabIDs: [TerminalTabID]) -> TerminalRootPlacement? {
    guard let firstTabID = tabIDs.first else { return nil }
    guard let location = tabLocation(firstTabID) else { return nil }
    let rootIndex: Int
    let followsSourceRoot: Bool
    switch location {
    case .root(let index):
      rootIndex = index
      followsSourceRoot = false
    case .group(let groupID, _):
      guard let index = groupRootIndex(groupID) else { return nil }
      rootIndex = index
      followsSourceRoot = true
    }
    let item = rootItems[rootIndex]
    let selectedRootIDs = Set(tabIDs.map(TerminalTabRootItemID.tab))
    let laneIndex =
      rootItems[..<rootIndex].count {
        $0.isPinned == item.isPinned && !selectedRootIDs.contains($0.id)
      } + (followsSourceRoot ? 1 : 0)
    return TerminalRootPlacement(isPinned: item.isPinned, index: laneIndex)
  }

  private func isValid(
    _ placement: TerminalTabPlacement,
    afterRemoving tabID: TerminalTabID
  ) -> Bool {
    var items = rootItems
    guard let location = tabLocation(tabID) else { return false }
    switch location {
    case .root(let index):
      items.remove(at: index)
    case .group(let groupID, let index):
      guard let rootIndex = groupRootIndex(groupID) else { return false }
      guard case .group(var group) = items[rootIndex] else { return false }
      group.tabs.remove(at: index)
      items[rootIndex] = .group(group)
    }

    switch placement {
    case .root(let placement):
      return (0...items.count(where: { $0.isPinned == placement.isPinned })).contains(
        placement.index
      )
    case .group(let groupID, let index):
      guard
        let group = items.compactMap({ item -> TerminalTabGroupItem? in
          guard case .group(let group) = item, group.id == groupID else { return nil }
          return group
        }).first
      else {
        return false
      }
      return (0...group.tabs.count).contains(index)
    }
  }

  private func isValid(
    _ placement: TerminalRootPlacement,
    afterRemovingRootItemAt index: Int
  ) -> Bool {
    var items = rootItems
    items.remove(at: index)
    return (0...items.count(where: { $0.isPinned == placement.isPinned })).contains(
      placement.index
    )
  }

  @discardableResult
  private func insertRootItem(
    _ item: TerminalTabRootItem,
    at placement: TerminalRootPlacement
  ) -> Bool {
    let laneIndices = rootItems.indices.filter { rootItems[$0].isPinned == placement.isPinned }
    guard (0...laneIndices.count).contains(placement.index) else { return false }
    let insertionIndex: Int
    if laneIndices.indices.contains(placement.index) {
      insertionIndex = laneIndices[placement.index]
    } else if placement.isPinned {
      insertionIndex = regularRootItems.isEmpty ? rootItems.endIndex : rootItems.firstIndex { !$0.isPinned }!
    } else {
      insertionIndex = rootItems.endIndex
    }
    rootItems.insert(item, at: insertionIndex)
    return true
  }

  private func repairSelection() {
    guard !tabs.contains(where: { $0.id == selectedTabId }) else { return }
    selectedTabId = tabs.first?.id
  }

  private static func sanitized(_ rootItems: [TerminalTabRootItem]) -> [TerminalTabRootItem] {
    var seenTabIDs: Set<TerminalTabID> = []
    var seenGroupIDs: Set<TerminalTabGroupID> = []
    var items: [TerminalTabRootItem] = []
    for item in rootItems {
      switch item {
      case .tab(let item):
        guard seenTabIDs.insert(item.tab.id).inserted else { continue }
        items.append(.tab(item))
      case .group(var group):
        guard seenGroupIDs.insert(group.id).inserted else { continue }
        group.tabs = group.tabs.filter { seenTabIDs.insert($0.id).inserted }
        items.append(.group(group))
      }
    }
    return items.filter(\.isPinned) + items.filter { !$0.isPinned }
  }
}
