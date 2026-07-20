import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SwiftUI

extension TerminalHostState {
  @discardableResult
  func applySelectedSpace(_ spaceID: TerminalSpaceID) -> Bool {
    let currentSelectedSpaceID = selectedSpaceID
    guard spaceManager.selectSpace(spaceID) else { return false }
    if currentSelectedSpaceID != spaceID, let currentSelectedSpaceID {
      previousSelectedSpaceID = currentSelectedSpaceID
    }
    return true
  }

  func applySelectedTab(
    _ tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    let currentSelectedTabID = spaceManager.selectedTabID(in: spaceID)
    if currentSelectedTabID != tabID, let currentSelectedTabID {
      previousSelectedTabIDBySpace[spaceID] = currentSelectedTabID
    }
    spaceManager.tabManager(for: spaceID)?.selectTab(tabID)
    if let groupID = spaceManager.tabManager(for: spaceID)?.groupID(containing: tabID) {
      collapsedTabGroupIDsBySpace[spaceID]?.remove(groupID)
    }
  }

  func selectTab(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    let didChangeSpace = spaceManager.selectedSpaceID != space.id
    guard applySelectedSpace(space.id) else { return }
    if didChangeSpace {
      persistDefaultSelectedSpaceID(space.id)
    }
    applySelectedTab(tabID, in: space.id)
    focusSurfaceIfNeeded(in: tabID)
    syncFocus(windowActivity)
    sessionDidChange()
  }

  func selectTab(slot: Int) {
    let index = slot - 1
    guard visibleTabs.indices.contains(index) else { return }
    selectTab(visibleTabs[index].id)
  }

  func nextTab() {
    guard
      let selectedTabID,
      let selectedIndex = tabs.firstIndex(where: { $0.id == selectedTabID }),
      !tabs.isEmpty
    else {
      return
    }
    let nextIndex = (selectedIndex + 1) % tabs.count
    selectTab(tabs[nextIndex].id)
  }

  func nextSpace() {
    selectAdjacentSpace(step: 1)
  }

  func previousTab() {
    guard
      let selectedTabID,
      let selectedIndex = tabs.firstIndex(where: { $0.id == selectedTabID }),
      !tabs.isEmpty
    else {
      return
    }
    let previousIndex = (selectedIndex - 1 + tabs.count) % tabs.count
    selectTab(tabs[previousIndex].id)
  }

  func previousSpace() {
    selectAdjacentSpace(step: -1)
  }

  func selectLastTab() {
    guard let selectedSpaceID else { return }
    guard let lastTabID = previousSelectedTabIDBySpace[selectedSpaceID] else { return }
    selectTab(lastTabID)
  }

  func selectSpace(_ spaceID: TerminalSpaceID) {
    selectSpace(spaceID, persistDefaultSelection: true)
  }

  func selectSpace(
    _ spaceID: TerminalSpaceID,
    persistDefaultSelection: Bool
  ) {
    guard applySelectedSpace(spaceID) else { return }
    if persistDefaultSelection {
      persistDefaultSelectedSpaceID(spaceID)
    }
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  func selectSpace(slot: Int) {
    let index = slot == 0 ? 9 : slot - 1
    guard spaces.indices.contains(index) else { return }
    selectSpace(spaces[index].id)
  }

  func selectAdjacentSpace(step: Int) {
    guard
      spaces.count > 1,
      let selectedSpaceID,
      let currentIndex = spaces.firstIndex(where: { $0.id == selectedSpaceID })
    else { return }

    let targetIndex = (currentIndex + step + spaces.count) % spaces.count
    selectSpace(spaces[targetIndex].id)
  }

  func updateSelectionAfterClosingTab(
    in spaceID: TerminalSpaceID,
    wasSelectedSpace: Bool,
    didCloseSelectedTab: Bool
  ) {
    guard wasSelectedSpace else { return }

    if let selectedTabID = spaceManager.selectedTabID(in: spaceID) {
      if isSelectableTab(selectedTabID) {
        if didCloseSelectedTab {
          applySelectedTab(selectedTabID, in: spaceID)
        }
        focusSurfaceIfNeeded(in: selectedTabID)
        return
      }
    }

    if let tabID = replacementLiveTabID(in: spaceID) {
      applySelectedTab(tabID, in: spaceID)
      focusSurfaceIfNeeded(in: tabID)
      return
    }

    spaceManager.tabManager(for: spaceID)?.clearSelection()

    if let previousSelectedSpaceID,
      previousSelectedSpaceID != spaceID,
      let tabID = replacementLiveTabID(in: previousSelectedSpaceID)
    {
      _ = applySelectedSpace(previousSelectedSpaceID)
      applySelectedTab(tabID, in: previousSelectedSpaceID)
      focusSurfaceIfNeeded(in: tabID)
      return
    }

    if let fallback = firstLiveTabLocation() {
      _ = applySelectedSpace(fallback.spaceID)
      applySelectedTab(fallback.tabID, in: fallback.spaceID)
      focusSurfaceIfNeeded(in: fallback.tabID)
      return
    }

    lastEmittedFocusSurfaceID = nil
  }

  func replacementLiveTabID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    let tabs = spaceManager.tabs(in: spaceID)
    if let previousTabID = previousSelectedTabIDBySpace[spaceID],
      tabs.contains(where: { $0.id == previousTabID }),
      isSelectableTab(previousTabID)
    {
      return previousTabID
    }
    return tabs.reversed().first { isSelectableTab($0.id) }?.id
  }

  func firstLiveTabLocation() -> (spaceID: TerminalSpaceID, tabID: TerminalTabID)? {
    for space in spaces {
      if let tabID = spaceManager.tabs(in: space.id).first(where: { isSelectableTab($0.id) })?.id {
        return (space.id, tabID)
      }
    }
    return nil
  }

  func isSelectableTab(_ tabID: TerminalTabID) -> Bool {
    !managesTerminalSurfaces || trees[tabID] != nil
  }

  func focusSurfaceIfNeeded(in tabID: TerminalTabID) {
    guard managesTerminalSurfaces else {
      lastEmittedFocusSurfaceID = nil
      return
    }
    focusSurface(in: tabID)
  }

  func nextSelectedSpaceID(afterDeleting spaceID: TerminalSpaceID) -> TerminalSpaceID {
    let remainingSpaces = spaces.filter { $0.id != spaceID }
    precondition(!remainingSpaces.isEmpty)

    if let selectedSpaceID,
      selectedSpaceID != spaceID,
      remainingSpaces.contains(where: { $0.id == selectedSpaceID })
    {
      return selectedSpaceID
    }

    if let deletedIndex = spaces.firstIndex(where: { $0.id == spaceID }) {
      for space in spaces[..<deletedIndex].reversed()
      where remainingSpaces.contains(where: { $0.id == space.id }) {
        return space.id
      }
    }

    return remainingSpaces[0].id
  }

  func finalizeSpaceSelectionChange() {
    guard managesTerminalSurfaces else {
      lastEmittedFocusSurfaceID = nil
      return
    }
    ensureInitialTab(focusing: false)
    if let selectedTabID {
      focusSurface(in: selectedTabID)
    } else {
      lastEmittedFocusSurfaceID = nil
    }
    syncFocus(windowActivity)
  }
}
