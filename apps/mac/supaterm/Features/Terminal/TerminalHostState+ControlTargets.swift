import Foundation
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalCore
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature

extension TerminalHostState {
  func resolveSpaceTarget(_ target: TerminalSpaceTarget) throws -> ResolvedCreateTabTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreateTabTarget(.contextPane(contextPaneID))
      } catch TerminalCreateTabError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreateTabError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreateTabError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .space(let windowIndex, let spaceIndex):
      do {
        return try resolveCreateTabTarget(.space(windowIndex: windowIndex, spaceIndex: spaceIndex))
      } catch TerminalCreateTabError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreateTabError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      }
    }
  }

  func resolveTabTarget(_ target: TerminalTabTarget) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreatePaneTarget(.contextPane(contextPaneID))
      } catch TerminalCreatePaneError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreatePaneError.tabNotFound(let windowIndex, let spaceIndex, let tabIndex) {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      do {
        return try resolveCreatePaneTarget(
          .tab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
        )
      } catch TerminalCreatePaneError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreatePaneError.tabNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex
      ) {
        throw TerminalControlError.tabNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      }
    }
  }

  func resolveTabItemTarget(_ target: TerminalTabTarget) throws -> ResolvedTabItemTarget {
    switch target {
    case .contextPane(let contextPaneID):
      guard
        let tabID = tabID(containing: contextPaneID),
        let space = spaceManager.space(for: tabID)
      else {
        throw TerminalControlError.contextPaneNotFound
      }
      return ResolvedTabItemTarget(spaceID: space.id, tabID: tabID)

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      guard windowIndex == 1 else {
        throw TerminalControlError.windowNotFound(windowIndex)
      }
      guard let space = spaceManager.space(at: spaceIndex) else {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      }
      let tabs = spaceManager.tabs(in: space.id)
      let tabOffset = tabIndex - 1
      guard tabs.indices.contains(tabOffset) else {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      }
      return ResolvedTabItemTarget(spaceID: space.id, tabID: tabs[tabOffset].id)
    }
  }

  func resolvePaneTarget(_ target: TerminalPaneTarget) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreatePaneTarget(.contextPane(contextPaneID))
      } catch TerminalCreatePaneError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreatePaneError.tabNotFound(let windowIndex, let spaceIndex, let tabIndex) {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      } catch TerminalCreatePaneError.paneNotFound(
        let windowIndex, let spaceIndex, let tabIndex, let paneIndex
      ) {
        throw TerminalControlError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      do {
        return try resolveCreatePaneTarget(
          .pane(
            windowIndex: windowIndex,
            spaceIndex: spaceIndex,
            tabIndex: tabIndex,
            paneIndex: paneIndex
          )
        )
      } catch TerminalCreatePaneError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreatePaneError.tabNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex
      ) {
        throw TerminalControlError.tabNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex
        )
      } catch TerminalCreatePaneError.paneNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex,
        let resolvedPaneIndex
      ) {
        throw TerminalControlError.paneNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex,
          paneIndex: resolvedPaneIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }
    }
  }

  func resolvedNavigationSpaceID(_ request: TerminalSpaceNavigationRequest) throws
    -> TerminalSpaceID
  {
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    if let contextPaneID = request.contextPaneID {
      guard let tabID = tabID(containing: contextPaneID), let space = spaceManager.space(for: tabID)
      else {
        throw TerminalControlError.contextPaneNotFound
      }
      return space.id
    }
    guard let selectedSpaceID else {
      throw TerminalControlError.lastSpaceNotFound
    }
    return selectedSpaceID
  }

  func resolvedNavigationSpaceID(_ request: TerminalTabNavigationRequest) throws
    -> TerminalSpaceID
  {
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    if let contextPaneID = request.contextPaneID {
      guard let tabID = tabID(containing: contextPaneID), let space = spaceManager.space(for: tabID)
      else {
        throw TerminalControlError.contextPaneNotFound
      }
      return space.id
    }
    if let spaceIndex = request.spaceIndex {
      do {
        return try resolveSpace(windowIndex: request.windowIndex ?? 1, spaceIndex: spaceIndex).id
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: windowIndex, spaceIndex: resolvedSpaceIndex)
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.spaceNotFound(
          windowIndex: request.windowIndex ?? 1, spaceIndex: spaceIndex)
      }
    }
    guard let selectedSpaceID else {
      throw TerminalControlError.lastTabNotFound
    }
    return selectedSpaceID
  }

  func spaceTarget(for spaceID: TerminalSpaceID) throws -> SupatermSpaceTarget {
    guard let space = spaces.first(where: { $0.id == spaceID }) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    guard let spaceIndex = spaceManager.spaceIndex(for: spaceID) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    return SupatermSpaceTarget(
      windowIndex: 1,
      spaceIndex: spaceIndex,
      spaceID: spaceID.rawValue,
      name: space.name
    )
  }

  func tabTarget(for tabID: TerminalTabID) throws -> SupatermTabTarget {
    guard let space = spaceManager.space(for: tabID) else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    guard let spaceIndex = spaceManager.spaceIndex(for: space.id) else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    let tabs = spaceManager.tabs(in: space.id)
    guard let tabIndex = tabs.firstIndex(where: { $0.id == tabID }) else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: 1)
    }
    let tab = tabs[tabIndex]
    return SupatermTabTarget(
      windowIndex: 1,
      spaceIndex: spaceIndex,
      spaceID: space.id.rawValue,
      tabIndex: tabIndex + 1,
      tabID: tabID.rawValue,
      title: tab.title
    )
  }

  func paneTarget(
    spaceID: TerminalSpaceID,
    tabID: TerminalTabID,
    surfaceID: UUID,
    tree: SplitTree<GhosttySurfaceView>
  ) throws -> SupatermPaneTarget {
    let location = try resolvedPaneLocation(
      spaceID: spaceID,
      tabID: tabID,
      surfaceID: surfaceID,
      tree: tree
    )
    return SupatermPaneTarget(
      windowIndex: 1,
      spaceIndex: location.spaceIndex,
      spaceID: spaceID.rawValue,
      tabIndex: location.tabIndex,
      tabID: tabID.rawValue,
      paneIndex: location.paneIndex,
      paneID: surfaceID
    )
  }

  func resolvedFocusedSurface(
    in tabID: TerminalTabID
  ) -> (tree: SplitTree<GhosttySurfaceView>, surface: GhosttySurfaceView)? {
    guard let tree = trees[tabID] else { return nil }
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current, let surface = surfaces[focusedSurfaceID] {
      return (tree, surface)
    }
    guard let surface = tree.root?.leftmostLeaf() else { return nil }
    return (tree, surface)
  }

  func focusPaneResult(
    spaceID: TerminalSpaceID,
    tabID: TerminalTabID,
    surfaceID: UUID,
    tree: SplitTree<GhosttySurfaceView>
  ) throws -> SupatermFocusPaneResult {
    let target = try paneTarget(
      spaceID: spaceID,
      tabID: tabID,
      surfaceID: surfaceID,
      tree: tree
    )
    let activity = Self.surfaceActivity(
      isSelectedTab: selectedTabID == tabID,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surfaceID: surfaceID
    )
    return SupatermFocusPaneResult(
      isFocused: activity.isFocused,
      isSelectedTab: selectedTabID == tabID,
      target: target
    )
  }

  func selectTabResult(for tabID: TerminalTabID) throws -> SupatermSelectTabResult {
    guard let space = spaceManager.space(for: tabID) else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    guard let resolvedSurface = resolvedFocusedSurface(in: tabID) else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    let target = try tabTarget(for: tabID)
    let paneTarget = try paneTarget(
      spaceID: space.id,
      tabID: tabID,
      surfaceID: resolvedSurface.surface.id,
      tree: resolvedSurface.tree
    )
    let activity = Self.surfaceActivity(
      isSelectedTab: selectedTabID == tabID,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surfaceID: resolvedSurface.surface.id
    )
    return SupatermSelectTabResult(
      isFocused: activity.isFocused,
      isSelectedSpace: selectedSpaceID == space.id,
      isSelectedTab: selectedTabID == tabID,
      isTitleLocked: spaceManager.tab(for: tabID)?.isTitleLocked == true,
      paneIndex: paneTarget.paneIndex,
      paneID: paneTarget.paneID,
      target: target
    )
  }

  func pinTabResult(for tabID: TerminalTabID) throws -> SupatermPinTabResult {
    SupatermPinTabResult(
      isPinned: spaceManager.tab(for: tabID)?.isPinned == true,
      target: try tabTarget(for: tabID)
    )
  }

  func selectSpaceResult(for spaceID: TerminalSpaceID) throws -> SupatermSelectSpaceResult {
    guard
      let tabID = spaceManager.selectedTabID(in: spaceID)
        ?? spaceManager.tabs(in: spaceID).first?.id
    else {
      throw TerminalControlError.lastSpaceNotFound
    }
    let target = try spaceTarget(for: spaceID)
    let tabTarget = try self.tabTarget(for: tabID)
    guard let resolvedSurface = resolvedFocusedSurface(in: tabID) else {
      throw TerminalControlError.lastSpaceNotFound
    }
    let paneTarget = try paneTarget(
      spaceID: spaceID,
      tabID: tabID,
      surfaceID: resolvedSurface.surface.id,
      tree: resolvedSurface.tree
    )
    let activity = Self.surfaceActivity(
      isSelectedTab: selectedTabID == tabID,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surfaceID: resolvedSurface.surface.id
    )
    return SupatermSelectSpaceResult(
      isFocused: activity.isFocused,
      isSelectedSpace: selectedSpaceID == spaceID,
      isSelectedTab: selectedTabID == tabID,
      paneIndex: paneTarget.paneIndex,
      paneID: paneTarget.paneID,
      tabIndex: tabTarget.tabIndex,
      tabID: tabTarget.tabID,
      target: target
    )
  }
}
