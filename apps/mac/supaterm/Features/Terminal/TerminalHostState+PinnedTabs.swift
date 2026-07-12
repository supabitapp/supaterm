import Foundation
import Observation
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
      validProjectIDsBySpaceID: Dictionary(
        uniqueKeysWithValues: spaceCatalog.spaces.map { space in
          (space.id, Set(space.projects.map(\.id)))
        }
      )
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
      pinnedTabCatalog.updatingProjects(
        synchronizedPinnedProjects(in: spaceID),
        in: spaceID
      )
    }
  }

  func removePinnedTabFromCatalog(_ tabID: TerminalTabID, in spaceID: TerminalSpaceID) {
    updatePinnedTabCatalog { pinnedTabCatalog in
      let projects = pinnedTabCatalog.projects(in: spaceID).compactMap {
        project -> PersistedPinnedTerminalTabsForProject? in
        let tabs = project.tabs.filter { $0.id != tabID }
        guard !tabs.isEmpty else { return nil }
        return PersistedPinnedTerminalTabsForProject(id: project.id, tabs: tabs)
      }
      return pinnedTabCatalog.updatingProjects(projects, in: spaceID)
    }
  }

  func persistLivePinnedTabLayouts() {
    var updatedCatalog = pinnedTabCatalog
    for space in spaces {
      let livePinnedTabIDs = Set(
        spaceManager.tabs(in: space.id).compactMap { tab in
          tab.isPinned && trees[tab.id] != nil ? tab.id : nil
        }
      )
      guard !livePinnedTabIDs.isEmpty else { continue }
      updatedCatalog = updatedCatalog.updatingProjects(
        synchronizedPinnedProjects(in: space.id, snapshotting: livePinnedTabIDs),
        in: space.id
      )
    }
    guard updatedCatalog != pinnedTabCatalog else { return }
    writePinnedTabCatalog(updatedCatalog)
  }

  func persistPinnedTabWorkingDirectoriesIfNeeded(for tabID: TerminalTabID) {
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tab(for: tabID)?.isPinned == true,
      let tree = trees[tabID]
    else {
      return
    }

    let leaves = tree.leaves()
    let workingDirectoryPaths = leaves.map(workingDirectoryPath(for:))
    let focusedPaneIndex =
      focusHistoryByTab[tabID].map(\.current).flatMap { focusedSurfaceID in
        leaves.firstIndex(where: { $0.id == focusedSurfaceID })
      } ?? 0
    let projects = synchronizedPinnedProjects(in: spaceID).map { project in
      var project = project
      project.tabs = project.tabs.map { entry in
        guard entry.id == tabID else { return entry }
        var entry = entry
        entry.session = entry.session.updatingWorkingDirectoryPaths(
          workingDirectoryPaths,
          focusedPaneIndex: focusedPaneIndex
        )
        return entry
      }
      return project
    }
    updatePinnedTabCatalog { $0.updatingProjects(projects, in: spaceID) }
  }

  func persistPinnedTabTitleIfNeeded(for tabID: TerminalTabID) {
    guard
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tab(for: tabID)?.isPinned == true
    else {
      return
    }

    let lockedTitle = lockedTabTitle(for: tabID)
    let projects = synchronizedPinnedProjects(in: spaceID).map { project in
      var project = project
      project.tabs = project.tabs.map { entry in
        guard entry.id == tabID else { return entry }
        var entry = entry
        entry.session.lockedTitle = lockedTitle
        return entry
      }
      return project
    }
    updatePinnedTabCatalog { $0.updatingProjects(projects, in: spaceID) }
  }

  func synchronizedPinnedProjects(
    in spaceID: TerminalSpaceID,
    snapshotting snapshotTabIDs: Set<TerminalTabID> = []
  ) -> [PersistedPinnedTerminalTabsForProject] {
    let existingTabsByID = Dictionary(
      uniqueKeysWithValues: pinnedTabCatalog.tabs(in: spaceID).map { ($0.id, $0) }
    )
    return spaceManager.projectGroups(in: spaceID).compactMap { group in
      let tabs = group.tabs.compactMap { tab -> PersistedTerminalTab? in
        guard tab.isPinned else { return nil }
        if let existingTab = existingTabsByID[tab.id], !snapshotTabIDs.contains(tab.id) {
          return existingTab
        }
        guard let session = restorationTabSession(for: tab) else { return nil }
        return PersistedTerminalTab(id: tab.id, session: session)
      }
      guard !tabs.isEmpty else { return nil }
      return PersistedPinnedTerminalTabsForProject(id: group.projectID, tabs: tabs)
    }
  }

  func reconcilePinnedTabs(
    with pinnedTabCatalog: TerminalPinnedTabCatalog,
    selectedTabIDsBySpaceID: [TerminalSpaceID: TerminalTabID] = [:]
  ) {
    var didChange = false

    for space in spaces {
      let desiredProjects = pinnedTabCatalog.projects(in: space.id)
      let desiredIDs = Set(desiredProjects.flatMap { $0.tabs.map(\.id) })
      let currentGroups = spaceManager.projectGroups(in: space.id)
      let currentTabs = currentGroups.flatMap(\.tabs)
      let currentTabsByID = Dictionary(uniqueKeysWithValues: currentTabs.map { ($0.id, $0) })
      var tabsToRestore: [PersistedTerminalTab] = []
      var titlesToRefresh: [TerminalTabID] = []

      let updatedGroups = spaceManager.projects(in: space.id).map { project in
        let desiredTabs = desiredProjects.first(where: { $0.id == project.id })?.tabs ?? []
        let currentProjectTabs = currentGroups.first(where: { $0.projectID == project.id })?.tabs ?? []
        var desiredPinnedTabs: [TerminalTabItem] = []

        for (index, desiredTab) in desiredTabs.enumerated() {
          if let preservedTab = preservedPinnedTabItem(
            for: desiredTab,
            currentTabsByID: currentTabsByID,
            titlesToRefresh: &titlesToRefresh
          ) {
            desiredPinnedTabs.append(preservedTab)
          } else {
            desiredPinnedTabs.append(
              TerminalTabItem(
                id: desiredTab.id,
                title: desiredTab.session.lockedTitle ?? restoredTabTitle(at: index),
                isPinned: true,
                isTitleLocked: desiredTab.session.lockedTitle != nil
              )
            )
            tabsToRestore.append(desiredTab)
          }
        }

        let convertedPinnedTabs = currentProjectTabs.compactMap { tab -> TerminalTabItem? in
          guard tab.isPinned, !desiredIDs.contains(tab.id) else { return nil }
          return regularTabItem(from: tab)
        }
        let regularTabs = currentProjectTabs.filter { !$0.isPinned && !desiredIDs.contains($0.id) }
        return TerminalProjectTabs(
          projectID: project.id,
          tabs: desiredPinnedTabs + convertedPinnedTabs + regularTabs
        )
      }

      let currentSelectedTabID = spaceManager.selectedTabID(in: space.id)
      let updatedTabIDs = Set(updatedGroups.flatMap { $0.tabs.map(\.id) })
      let updatedSelectedTabID =
        selectedTabIDsBySpaceID[space.id].flatMap { updatedTabIDs.contains($0) ? $0 : nil }
        ?? currentSelectedTabID.flatMap { updatedTabIDs.contains($0) ? $0 : nil }
        ?? updatedGroups.flatMap(\.tabs).first?.id

      if currentGroups != updatedGroups || currentSelectedTabID != updatedSelectedTabID {
        didChange = true
      }

      _ = spaceManager.restoreTabs(
        updatedGroups,
        selectedTabID: updatedSelectedTabID,
        in: space.id
      )

      if managesTerminalSurfaces {
        for tabID in titlesToRefresh {
          updateTabTitle(for: tabID)
        }
        for restoredTab in tabsToRestore {
          if currentTabsByID[restoredTab.id] != nil {
            removeTree(for: restoredTab.id, terminateSessions: false, source: .pinnedReconcile)
          }
          restoreTabSession(restoredTab.session, tabID: restoredTab.id, in: space.id)
        }
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
    for desiredTab: PersistedTerminalTab,
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

  func restorePinnedTabSessionIfNeeded(for tabID: TerminalTabID) {
    guard
      managesTerminalSurfaces,
      trees[tabID] == nil,
      let spaceID = spaceManager.space(for: tabID)?.id,
      spaceManager.tab(for: tabID)?.isPinned == true,
      let pinnedTab = pinnedTabCatalog.tabs(in: spaceID).first(where: { $0.id == tabID })
    else {
      return
    }

    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.pinned.restore",
      fields: [
        "tabID=\(SupatermLog.uuid(tabID.rawValue))",
        "spaceID=\(SupatermLog.uuid(spaceID.rawValue))",
        "surfaceIDs=\(Self.logSurfaceIDs(pinnedTab.session.surfaceIDs))",
      ]
    )
    restoreTabSession(pinnedTab.session, tabID: tabID, in: spaceID)
  }
}
