import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SwiftUI

extension TerminalHostState {
  func applySelectedTab(
    _ tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    guard let instance = spaceManager.instance(for: spaceID) else { return }
    let currentSelectedTabID = instance.selectedTabID
    if currentSelectedTabID != tabID, let currentSelectedTabID {
      instance.previousSelectedTabID = currentSelectedTabID
    }
    instance.tabCollection.selectTab(tabID)
  }

  func selectTab(_ tabID: TerminalTabID) {
    guard let instance = spaceManager.instance(for: tabID) else { return }
    applySelectedTab(tabID, in: instance.spaceID)
    focusSurfaceIfNeeded(in: tabID)
    syncFocus()
    sessionDidChange()
  }

  func selectTab(slot: Int) {
    let index = slot - 1
    guard tabs.indices.contains(index) else { return }
    selectTab(tabs[index].id)
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

  func selectLastTab() {
    guard let lastTabID = spaceManager.displayedInstance.previousSelectedTabID else { return }
    selectTab(lastTabID)
  }

  func updateSelectionAfterClosingTab(
    in spaceID: TerminalSpaceID,
    didCloseSelectedTab: Bool
  ) {
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

    spaceManager.instance(for: spaceID)?.tabCollection.clearSelection()

  }

  func replacementLiveTabID(
    in spaceID: TerminalSpaceID,
    excluding excludedTabID: TerminalTabID? = nil
  ) -> TerminalTabID? {
    let tabs = spaceManager.tabs(in: spaceID)
    if let previousTabID = spaceManager.instance(for: spaceID)?.previousSelectedTabID,
      previousTabID != excludedTabID,
      tabs.contains(where: { $0.id == previousTabID }),
      isSelectableTab(previousTabID)
    {
      return previousTabID
    }
    return tabs.reversed().first {
      $0.id != excludedTabID && isSelectableTab($0.id)
    }?.id
  }

  func isSelectableTab(_ tabID: TerminalTabID) -> Bool {
    !managesTerminalSurfaces || trees[tabID] != nil
  }

  func focusSurfaceIfNeeded(in tabID: TerminalTabID) {
    guard managesTerminalSurfaces else { return }
    focusSurface(in: tabID)
  }

}
