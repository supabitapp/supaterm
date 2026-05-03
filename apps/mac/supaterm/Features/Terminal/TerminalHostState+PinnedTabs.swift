import Foundation
import Sharing

extension TerminalHostState {
  func observePinnedTabCatalog() {
    pinnedTabCatalogObservationTask?.cancel()
    pinnedTabCatalogObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.pinnedTabCatalog ?? .default
      }
      for await pinnedTabCatalog in observations {
        guard let self else { return }
        self.applyObservedPinnedTabCatalog(pinnedTabCatalog)
      }
    }
  }

  func applyObservedPinnedTabCatalog(_ pinnedTabCatalog: TerminalPinnedTabCatalog) {
    let resolvedPinnedTabCatalog = sanitizedPinnedTabCatalog(pinnedTabCatalog)
    if resolvedPinnedTabCatalog != pinnedTabCatalog {
      replacePinnedTabCatalog(resolvedPinnedTabCatalog)
    }
    guard resolvedPinnedTabCatalog != lastAppliedPinnedTabCatalog else { return }
    lastAppliedPinnedTabCatalog = resolvedPinnedTabCatalog
    reconcilePinnedTabs(with: resolvedPinnedTabCatalog)
  }

  func sanitizedPinnedTabCatalog(
    _ pinnedTabCatalog: TerminalPinnedTabCatalog?
  ) -> TerminalPinnedTabCatalog {
    TerminalPinnedTabCatalog.sanitized(
      pinnedTabCatalog,
      validSpaceIDs: Set(spaces.map(\.id))
    )
  }

  func synchronizePinnedTabCatalogWithSpaces() {
    let resolvedPinnedTabCatalog = sanitizedPinnedTabCatalog(pinnedTabCatalog)
    guard resolvedPinnedTabCatalog != pinnedTabCatalog else { return }
    replacePinnedTabCatalog(resolvedPinnedTabCatalog)
    lastAppliedPinnedTabCatalog = resolvedPinnedTabCatalog
  }

  func replacePinnedTabCatalog(_ pinnedTabCatalog: TerminalPinnedTabCatalog) {
    $pinnedTabCatalog.withLock { $0 = pinnedTabCatalog }
  }

  func writePinnedTabCatalog(_ pinnedTabCatalog: TerminalPinnedTabCatalog) {
    let resolvedPinnedTabCatalog = sanitizedPinnedTabCatalog(pinnedTabCatalog)
    replacePinnedTabCatalog(resolvedPinnedTabCatalog)
    lastAppliedPinnedTabCatalog = resolvedPinnedTabCatalog
  }

  func updatePinnedTabCatalog(
    _ update: (TerminalPinnedTabCatalog) -> TerminalPinnedTabCatalog
  ) {
    writePinnedTabCatalog(update(pinnedTabCatalog))
  }

  func syncPinnedTabMembership(in spaceID: TerminalSpaceID) {
    updatePinnedTabCatalog { pinnedTabCatalog in
      pinnedTabCatalog.updatingTabs(
        synchronizedPinnedTabs(in: spaceID),
        in: spaceID
      )
    }
  }

  func persistPinnedTabLayoutIfNeeded(for tabID: TerminalTabID) {
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      let tab = spaceManager.tab(for: tabID),
      tab.isPinned,
      let session = restorationTabSession(for: tab)
    else {
      return
    }

    let tabs = synchronizedPinnedTabs(in: spaceID, snapshotting: [tabID]).map { entry in
      guard entry.id == tabID else { return entry }
      return PersistedPinnedTerminalTab(id: tabID, session: session)
    }
    updatePinnedTabCatalog { pinnedTabCatalog in
      pinnedTabCatalog.updatingTabs(tabs, in: spaceID)
    }
  }

  func persistPinnedTabTitleIfNeeded(for tabID: TerminalTabID) {
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tab(for: tabID)?.isPinned == true
    else {
      return
    }

    let lockedTitle = lockedTabTitle(for: tabID)
    let tabs = synchronizedPinnedTabs(in: spaceID).map { entry in
      guard entry.id == tabID else { return entry }
      var entry = entry
      entry.session.lockedTitle = lockedTitle
      return entry
    }
    updatePinnedTabCatalog { pinnedTabCatalog in
      pinnedTabCatalog.updatingTabs(tabs, in: spaceID)
    }
  }

  func synchronizedPinnedTabs(
    in spaceID: TerminalSpaceID,
    snapshotting snapshotTabIDs: Set<TerminalTabID> = []
  ) -> [PersistedPinnedTerminalTab] {
    let existingTabsByID = Dictionary(
      uniqueKeysWithValues: pinnedTabCatalog.tabs(in: spaceID).map { ($0.id, $0) }
    )
    return spaceManager.tabs(in: spaceID).compactMap { tab in
      guard tab.isPinned else { return nil }
      if let existingTab = existingTabsByID[tab.id], !snapshotTabIDs.contains(tab.id) {
        return existingTab
      }
      guard let session = restorationTabSession(for: tab) else { return nil }
      return PersistedPinnedTerminalTab(id: tab.id, session: session)
    }
  }

  func reconcilePinnedTabs(with pinnedTabCatalog: TerminalPinnedTabCatalog) {
    var didChange = false

    for space in spaces {
      let desiredTabs = pinnedTabCatalog.tabs(in: space.id)
      let currentTabs = spaceManager.tabs(in: space.id)
      let desiredIDs = Set(desiredTabs.map(\.id))
      let currentPinnedTabs = currentTabs.filter(\.isPinned)
      let currentRegularTabs = currentTabs.filter { !$0.isPinned && !desiredIDs.contains($0.id) }
      let currentTabsByID = Dictionary(
        uniqueKeysWithValues: currentTabs.map { ($0.id, $0) }
      )

      var desiredPinnedTabs: [TerminalTabItem] = []
      var convertedRegularTabs: [TerminalTabItem] = []
      var tabsToRestore: [PersistedPinnedTerminalTab] = []
      var titlesToRefresh: [TerminalTabID] = []

      for (index, desiredTab) in desiredTabs.enumerated() {
        if let preservedPinnedTab = preservedPinnedTabItem(
          for: desiredTab,
          currentTabsByID: currentTabsByID,
          titlesToRefresh: &titlesToRefresh
        ) {
          desiredPinnedTabs.append(preservedPinnedTab)
        } else {
          desiredPinnedTabs.append(
            TerminalTabItem(
              id: desiredTab.id,
              title: desiredTab.session.lockedTitle ?? restoredTabTitle(at: index),
              icon: "terminal",
              isPinned: true,
              isTitleLocked: desiredTab.session.lockedTitle != nil
            )
          )
          tabsToRestore.append(desiredTab)
        }
      }

      for currentPinnedTab in currentPinnedTabs where !desiredIDs.contains(currentPinnedTab.id) {
        convertedRegularTabs.append(
          regularTabItem(from: currentPinnedTab)
        )
      }
      for restoredTab in tabsToRestore where currentTabsByID[restoredTab.id] != nil {
        removeTree(for: restoredTab.id)
      }

      let updatedTabs = desiredPinnedTabs + convertedRegularTabs + currentRegularTabs
      let currentSelectedTabID = spaceManager.selectedTabID(in: space.id)
      let updatedSelectedTabID =
        currentSelectedTabID.flatMap { selectedTabID in
          updatedTabs.contains(where: { $0.id == selectedTabID }) ? selectedTabID : nil
        }
        ?? updatedTabs.first?.id

      if currentTabs != updatedTabs || currentSelectedTabID != updatedSelectedTabID {
        didChange = true
      }

      _ = spaceManager.restoreTabs(
        updatedTabs,
        selectedTabID: updatedSelectedTabID,
        in: space.id
      )

      if managesTerminalSurfaces {
        for tabID in titlesToRefresh {
          updateTabTitle(for: tabID)
        }
      }

      guard managesTerminalSurfaces else { continue }
      for restoredTab in tabsToRestore {
        restoreTabSession(
          restoredTab.session,
          tabID: restoredTab.id,
          in: space.id
        )
      }
    }

    guard didChange else { return }

    if managesTerminalSurfaces {
      if let selectedTabID, trees[selectedTabID] != nil {
        focusSurface(in: selectedTabID)
      } else {
        lastEmittedFocusSurfaceID = nil
      }
      syncFocus(windowActivity)
    } else if selectedTabID == nil {
      lastEmittedFocusSurfaceID = nil
    }

    sessionDidChange()
  }

  func preservedPinnedTabItem(
    for desiredTab: PersistedPinnedTerminalTab,
    currentTabsByID: [TerminalTabID: TerminalTabItem],
    titlesToRefresh: inout [TerminalTabID]
  ) -> TerminalTabItem? {
    guard var preservedPinnedTab = currentTabsByID[desiredTab.id] else { return nil }

    preservedPinnedTab.isPinned = true
    if let lockedTitle = desiredTab.session.lockedTitle {
      preservedPinnedTab.title = lockedTitle
      preservedPinnedTab.isTitleLocked = true
    } else {
      if preservedPinnedTab.isTitleLocked {
        titlesToRefresh.append(preservedPinnedTab.id)
      }
      preservedPinnedTab.isTitleLocked = false
    }
    return preservedPinnedTab
  }

  func regularTabItem(from tab: TerminalTabItem) -> TerminalTabItem {
    var regularTab = tab
    regularTab.isPinned = false
    return regularTab
  }
}
