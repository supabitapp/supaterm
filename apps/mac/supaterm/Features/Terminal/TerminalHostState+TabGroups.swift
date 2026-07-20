import Foundation

extension TerminalHostState {
  @discardableResult
  func createGroup(
    title: String,
    color: TerminalTabGroupColor = .neutral,
    containing tabIDs: [TerminalTabID]
  ) -> TerminalTabGroupID? {
    let spaceID: TerminalSpaceID?
    if tabIDs.isEmpty {
      spaceID = selectedSpaceID
    } else {
      let spaceIDs = Set(tabIDs.compactMap { spaceManager.space(for: $0)?.id })
      guard spaceIDs.count == 1, tabIDs.allSatisfy({ spaceManager.tab(for: $0) != nil }) else {
        return nil
      }
      spaceID = spaceIDs.first
    }
    guard let spaceID, let manager = spaceManager.tabManager(for: spaceID) else { return nil }
    guard let groupID = manager.createGroup(title: title, color: color, containing: tabIDs) else {
      return nil
    }
    sessionDidChange()
    return groupID
  }

  @discardableResult
  func renameGroup(_ id: TerminalTabGroupID, title: String) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.renameGroup(id, title: title) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setGroupColor(_ id: TerminalTabGroupID, color: TerminalTabGroupColor) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.setGroupColor(id, color: color) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setGroupCollapsed(_ id: TerminalTabGroupID, isCollapsed: Bool) -> Bool {
    guard let space = spaceManager.space(for: id) else { return false }
    var collapsedGroupIDs = collapsedTabGroupIDsBySpace[space.id] ?? []
    let changed: Bool
    if isCollapsed {
      changed = collapsedGroupIDs.insert(id).inserted
    } else {
      changed = collapsedGroupIDs.remove(id) != nil
    }
    guard changed else { return false }
    collapsedTabGroupIDsBySpace[space.id] = collapsedGroupIDs
    sessionDidChange()
    return true
  }

  @discardableResult
  func toggleGroupCollapsed(_ id: TerminalTabGroupID) -> Bool {
    guard let space = spaceManager.space(for: id) else { return false }
    let isCollapsed = collapsedTabGroupIDsBySpace[space.id]?.contains(id) == true
    return setGroupCollapsed(id, isCollapsed: !isCollapsed)
  }

  @discardableResult
  func moveTab(_ id: TerminalTabID, to placement: TerminalTabPlacement) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      let manager = spaceManager.tabManager(for: space.id)
    else {
      return false
    }
    let revealsGroup = manager.selectedTabId == id
    guard manager.moveTab(id, to: placement) else { return false }
    if revealsGroup, case .group(let groupID, _) = placement {
      collapsedTabGroupIDsBySpace[space.id]?.remove(groupID)
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func moveGroup(_ id: TerminalTabGroupID, to placement: TerminalRootPlacement) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.moveGroup(id, to: placement) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func togglePinned(_ id: TerminalTabRootItemID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.togglePinned(id) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setPinned(_ id: TerminalTabRootItemID, isPinned: Bool) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.setPinned(id, isPinned: isPinned) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func setTabPinned(_ id: TerminalTabID, isPinned: Bool) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.setTabPinned(id, isPinned: isPinned) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func removeTabFromGroup(_ id: TerminalTabID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.removeTabFromGroup(id) == true
    else {
      return false
    }
    sessionDidChange()
    return true
  }

  @discardableResult
  func ungroup(_ id: TerminalTabGroupID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.ungroup(id) == true
    else {
      return false
    }
    collapsedTabGroupIDsBySpace[space.id]?.remove(id)
    sessionDidChange()
    return true
  }

  @discardableResult
  func deleteEmptyGroup(_ id: TerminalTabGroupID) -> Bool {
    guard
      let space = spaceManager.space(for: id),
      spaceManager.tabManager(for: space.id)?.deleteEmptyGroup(id) == true
    else {
      return false
    }
    collapsedTabGroupIDsBySpace[space.id]?.remove(id)
    sessionDidChange()
    return true
  }
}
