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

  func persistPinnedTabCatalog() {
    writePinnedTabCatalog(pinnedTabCatalogSnapshot())
  }

  func persistPinnedTabCatalogIfNeeded(for tabID: TerminalTabID) {
    guard spaceManager.tab(for: tabID)?.isPinned == true else { return }
    persistPinnedTabCatalog()
  }

  func pinnedTabCatalogSnapshot() -> TerminalPinnedTabCatalog {
    let spaces = spaces.compactMap { space -> PersistedPinnedTerminalTabsForSpace? in
      let tabs = spaceManager.tabs(in: space.id).compactMap { tab -> PersistedPinnedTerminalTab? in
        guard tab.isPinned else { return nil }
        guard let session = restorationTabSession(for: tab) else { return nil }
        return PersistedPinnedTerminalTab(id: tab.id, session: session)
      }
      guard !tabs.isEmpty else { return nil }
      return PersistedPinnedTerminalTabsForSpace(id: space.id, tabs: tabs)
    }
    return sanitizedPinnedTabCatalog(TerminalPinnedTabCatalog(spaces: spaces))
  }

  func reconcilePinnedTabs(with pinnedTabCatalog: TerminalPinnedTabCatalog) {
    var didChange = false

    for space in spaces {
      let desiredTabs = pinnedTabCatalog.tabs(in: space.id)
      let currentTabs = spaceManager.tabs(in: space.id)
      let currentPinnedTabs = currentTabs.filter(\.isPinned)
      let currentRegularTabs = currentTabs.filter { !$0.isPinned }
      let currentPinnedTabsByID = Dictionary(
        uniqueKeysWithValues: currentPinnedTabs.map { ($0.id, $0) }
      )
      let desiredIDs = Set(desiredTabs.map(\.id))

      var desiredPinnedTabs: [TerminalTabItem] = []
      var tabsToRestore: [PersistedPinnedTerminalTab] = []
      var titlesToRefresh: [TerminalTabID] = []

      for (index, desiredTab) in desiredTabs.enumerated() {
        if managesTerminalSurfaces,
          let preservedPinnedTab = preservedPinnedTabItem(
            for: desiredTab,
            currentPinnedTabsByID: currentPinnedTabsByID,
            titlesToRefresh: &titlesToRefresh
          )
        {
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
        removeTree(for: currentPinnedTab.id)
      }
      for restoredTab in tabsToRestore where currentPinnedTabsByID[restoredTab.id] != nil {
        removeTree(for: restoredTab.id)
      }

      let updatedTabs = desiredPinnedTabs + currentRegularTabs
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
    currentPinnedTabsByID: [TerminalTabID: TerminalTabItem],
    titlesToRefresh: inout [TerminalTabID]
  ) -> TerminalTabItem? {
    guard let currentPinnedTab = currentPinnedTabsByID[desiredTab.id] else { return nil }
    guard trees[desiredTab.id] != nil else { return nil }

    var preservedPinnedTab = currentPinnedTab
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
}
