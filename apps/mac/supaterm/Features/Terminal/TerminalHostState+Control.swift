import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermTerminalCore
import SwiftUI

extension TerminalHostState {
  private struct TabCreationSelectionInput {
    let tabID: TerminalTabID
    let surfaceID: UUID
    let focusRequested: Bool
    let targetSpaceID: TerminalSpaceID
    let previousSelectedTabID: TerminalTabID?
  }

  struct ResolvedPaneClose {
    let result: SupatermClosePaneResult
    let shouldCloseWindow: Bool
    let surfaceID: UUID
  }

  struct ResolvedTabClose {
    let result: SupatermCloseTabResult
    let shouldCloseWindow: Bool
    let tabID: TerminalTabID
  }

  private static func requestedWorkingDirectoryURL(for path: String?) -> URL? {
    guard let path else { return nil }
    return URL(
      fileURLWithPath: SupatermWorkingDirectory.normalizedPath(path),
      isDirectory: true
    )
  }

  func treeSnapshot() -> SupatermTreeSnapshot {
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: windowActivity.isKeyWindow,
      displayedSpaceID: displayedSpaceID.rawValue,
      spaces: spaces.enumerated().map { spaceOffset, space in
        return SupatermTreeSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          color: space.color.socketColor,
          isWarm: isSpaceWarm(space.id),
          rootItems: rootItemSnapshot(in: space.id).map {
            treeRootItemSnapshot($0, spaceID: space.id)
          }
        )
      }
    )
    return SupatermTreeSnapshot(windows: [window])
  }

  func debugWindowSnapshot(index: Int) -> SupatermAppDebugSnapshot.Window {
    SupatermAppDebugSnapshot.Window(
      index: index,
      isKey: windowActivity.isKeyWindow,
      isVisible: windowActivity.isVisible,
      displayedSpaceID: displayedSpaceID.rawValue,
      spaces: spaces.enumerated().map { spaceOffset, space in
        return SupatermAppDebugSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          color: space.color.socketColor,
          isWarm: isSpaceWarm(space.id),
          rootItems: rootItemSnapshot(in: space.id).map {
            debugRootItemSnapshot($0, spaceID: space.id)
          }
        )
      }
    )
  }

  func isSpaceWarm(_ spaceID: TerminalSpaceID) -> Bool {
    guard let instance = spaceManager.instance(for: spaceID) else { return false }
    return instance.pendingSession == nil
  }

  private func rootItemSnapshot(in spaceID: TerminalSpaceID) -> [TerminalTabRootItem] {
    guard let pendingSession = spaceManager.instance(for: spaceID)?.pendingSession else {
      return spaceManager.rootItems(in: spaceID)
    }
    return restoredSpace(for: pendingSession).rootItems
  }

  private func paneSnapshotIDs(in tabID: TerminalTabID) -> [UUID] {
    if let tree = trees[tabID] {
      return tree.leaves().map(\.id)
    }
    return pendingTabSession(for: tabID)?.root.orderedSurfaceIDs ?? []
  }

  private func selectedPaneSnapshotID(in tabID: TerminalTabID) -> UUID? {
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current {
      return focusedSurfaceID
    }
    guard let session = pendingTabSession(for: tabID) else { return nil }
    let surfaceIDs = session.root.orderedSurfaceIDs
    guard surfaceIDs.indices.contains(session.focusedPaneIndex) else { return nil }
    return surfaceIDs[session.focusedPaneIndex]
  }

  private func pendingTabSession(for tabID: TerminalTabID) -> TerminalTabSession? {
    for instance in spaceManager.instances {
      if let session = instance.pendingSession?.tabs.first(where: { $0.id == tabID }) {
        return session
      }
    }
    return nil
  }

  private func treeRootItemSnapshot(
    _ item: TerminalTabRootItem,
    spaceID: TerminalSpaceID
  ) -> SupatermTreeSnapshot.RootItem {
    switch item {
    case .tab(let item):
      return .tab(
        SupatermTreeSnapshot.RootTab(
          isPinned: item.isPinned,
          tab: treeTabSnapshot(item.tab, spaceID: spaceID)
        )
      )
    case .group(let group):
      return .group(treeGroupSnapshot(group, spaceID: spaceID))
    }
  }

  private func treeTabSnapshot(
    _ tab: TerminalTabItem,
    spaceID: TerminalSpaceID
  ) -> SupatermTreeSnapshot.Tab {
    let selectedPaneID = selectedPaneSnapshotID(in: tab.id)
    return SupatermTreeSnapshot.Tab(
      id: tab.id.rawValue,
      title: tab.title,
      isSelected: tab.id == selectedTabSnapshotID(in: spaceID),
      panes: paneSnapshotIDs(in: tab.id).enumerated().map { paneOffset, paneID in
        SupatermTreeSnapshot.Pane(
          index: paneOffset + 1,
          id: paneID,
          isFocused: paneID == selectedPaneID
        )
      }
    )
  }

  private func selectedTabSnapshotID(in spaceID: TerminalSpaceID) -> TerminalTabID? {
    guard let instance = spaceManager.instance(for: spaceID) else { return nil }
    return instance.pendingSession?.selectedTabID ?? instance.selectedTabID
  }

  func treeGroupSnapshot(
    _ group: TerminalTabGroupItem,
    spaceID: TerminalSpaceID
  ) -> SupatermTreeSnapshot.Group {
    SupatermTreeSnapshot.Group(
      color: group.color.socketColor,
      id: group.id.rawValue,
      isCollapsed: isGroupCollapsed(group.id, in: spaceID),
      isPinned: group.isPinned,
      title: group.title,
      tabs: group.tabs.map { treeTabSnapshot($0, spaceID: spaceID) }
    )
  }

  private func debugRootItemSnapshot(
    _ item: TerminalTabRootItem,
    spaceID: TerminalSpaceID
  ) -> SupatermAppDebugSnapshot.RootItem {
    switch item {
    case .tab(let item):
      return .tab(
        SupatermAppDebugSnapshot.RootTab(
          isPinned: item.isPinned,
          tab: debugTabSnapshot(item.tab, spaceID: spaceID)
        )
      )
    case .group(let group):
      return .group(
        SupatermAppDebugSnapshot.Group(
          color: group.color.socketColor,
          id: group.id.rawValue,
          isCollapsed: isGroupCollapsed(group.id, in: spaceID),
          isPinned: group.isPinned,
          title: group.title,
          tabs: group.tabs.map { debugTabSnapshot($0, spaceID: spaceID) }
        )
      )
    }
  }

  private func debugTabSnapshot(
    _ tab: TerminalTabItem,
    spaceID: TerminalSpaceID
  ) -> SupatermAppDebugSnapshot.Tab {
    let pendingTab = pendingTabSession(for: tab.id)
    let selectedPaneID = selectedPaneSnapshotID(in: tab.id)
    let panes = paneSnapshotIDs(in: tab.id).enumerated().map { paneOffset, paneID in
      debugPaneSnapshot(
        surfaces[paneID],
        pendingPane: pendingTab?.root.leaf(id: paneID),
        id: paneID,
        index: paneOffset + 1,
        isFocused: paneID == selectedPaneID
      )
    }
    return SupatermAppDebugSnapshot.Tab(
      id: tab.id.rawValue,
      title: tab.title,
      isSelected: tab.id == selectedTabSnapshotID(in: spaceID),
      isDirty: tab.isDirty,
      isTitleLocked: tab.isTitleLocked,
      hasRunningActivity: panes.contains(where: \.isRunning),
      hasBell: panes.contains(where: { $0.bellCount > 0 }),
      hasReadOnly: panes.contains(where: \.isReadOnly),
      hasSecureInput: panes.contains(where: \.hasSecureInput),
      latestNotificationText: latestNotificationText(for: tab.id),
      unreadNotificationCount: unreadNotificationCount(for: tab.id),
      panes: panes
    )
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    let resolvedTarget = try resolveCreatePaneTarget(request.target)
    let newSurface = createSurface(
      tabID: resolvedTarget.tabID,
      startupCommand: request.startupCommand,
      inheritingFromSurfaceID: resolvedTarget.anchorSurface.id,
      workingDirectory: Self.requestedWorkingDirectoryURL(for: request.cwd),
      context: GHOSTTY_SURFACE_CONTEXT_SPLIT
    )

    do {
      let newTree = try resolvedTarget.tree.inserting(
        view: newSurface,
        at: resolvedTarget.anchorSurface,
        direction: mapPaneDirection(request.direction)
      )
      let finalTree = request.equalize ? newTree.equalized() : newTree
      trees[resolvedTarget.tabID] = finalTree
      updateRunningState(for: resolvedTarget.tabID)

      let currentSelectedTabID = spaceManager.selectedTabID(in: resolvedTarget.spaceID)
      let nextSelectedTabID = Self.selectedTabID(
        afterCreatingPaneIn: resolvedTarget.tabID,
        focusRequested: request.focus,
        currentSelectedTabID: currentSelectedTabID
      )
      if let nextSelectedTabID, nextSelectedTabID != currentSelectedTabID {
        applySelectedTab(nextSelectedTabID, in: resolvedTarget.spaceID)
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus()
      sessionDidChange()

      let paneLocation = try resolvedPaneLocation(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: newSurface.id,
        tree: finalTree
      )
      let selectionState = Self.newPaneSelectionState(
        isSelectedTab: selectedTabID == resolvedTarget.tabID,
        isPaneVisible: visiblePaneIDs.contains(newSurface.id),
        windowActivity: windowActivity,
        focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
        surface: newSurface
      )

      return SupatermNewPaneResult(
        direction: request.direction,
        isFocused: selectionState.isFocused,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: paneLocation.spaceIndex,
        spaceID: resolvedTarget.spaceID.rawValue,
        tabIndex: paneLocation.tabIndex,
        tabID: resolvedTarget.tabID.rawValue,
        paneIndex: paneLocation.paneIndex,
        paneID: newSurface.id
      )
    } catch let error as TerminalCreatePaneError {
      killZmxSession(for: newSurface.id)
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw error
    } catch {
      killZmxSession(for: newSurface.id)
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw TerminalCreatePaneError.creationFailed
    }
  }

  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    let resolvedTarget = try resolveCreateTabTarget(request.target)
    let currentSelectedTabID = spaceManager.selectedTabID(in: resolvedTarget.space.id)
    let placement = resolvedTarget.placement
    var createdTabID: TerminalTabID?

    do {
      let tabID =
        try createTab(
          in: resolvedTarget.space.id,
          reason: .socket,
          focusing: false,
          startupCommand: request.startupCommand,
          workingDirectory: Self.requestedWorkingDirectoryURL(for: request.cwd),
          inheritingFromSurfaceID: resolvedTarget.inheritedSurfaceID,
          at: placement,
          sessionChangesEnabled: false,
          synchronizesFocus: request.focus
        )
      guard
        let tabID,
        let tree = trees[tabID],
        let surface = tree.root?.leftmostLeaf()
      else {
        throw TerminalCreateTabError.creationFailed
      }
      let surfaceID = surface.id
      createdTabID = tabID

      if request.focus {
        displaySpace(resolvedTarget.space.id)
      }
      applyTabCreationSelection(
        TabCreationSelectionInput(
          tabID: tabID,
          surfaceID: surfaceID,
          focusRequested: request.focus,
          targetSpaceID: resolvedTarget.space.id,
          previousSelectedTabID: currentSelectedTabID
        )
      )

      syncFocus()
      sessionDidChange()

      guard
        let spaceIndex = spaceManager.spaceIndex(for: resolvedTarget.space.id),
        let tabIndex = spaceManager.tabs(in: resolvedTarget.space.id)
          .firstIndex(where: { $0.id == tabID }),
        let paneIndex = tree.leaves().firstIndex(where: { $0.id == surfaceID })
      else {
        throw TerminalCreateTabError.creationFailed
      }

      let selectionState = Self.newPaneSelectionState(
        isSelectedTab: selectedTabID == tabID,
        isPaneVisible: visiblePaneIDs.contains(surface.id),
        windowActivity: windowActivity,
        focusedSurfaceID: focusHistoryByTab[tabID]?.current,
        surface: surface
      )

      return SupatermNewTabResult(
        isFocused: selectionState.isFocused,
        isSelectedSpace: resolvedTarget.space.id == displayedSpaceID,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: spaceIndex,
        spaceID: resolvedTarget.space.id.rawValue,
        tabIndex: tabIndex + 1,
        tabID: tabID.rawValue,
        paneIndex: paneIndex + 1,
        paneID: surfaceID
      )
    } catch let error as TerminalCreateTabError {
      if let createdTabID {
        removeTree(for: createdTabID, source: .controlCleanup)
        spaceManager.tabCollection(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw error
    } catch {
      if let createdTabID {
        removeTree(for: createdTabID, source: .controlCleanup)
        spaceManager.tabCollection(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw TerminalCreateTabError.creationFailed
    }
  }

  private func applyTabCreationSelection(_ input: TabCreationSelectionInput) {
    let resolvedSelectedTabID = Self.selectedTabID(
      afterCreatingTab: input.tabID,
      focusRequested: input.focusRequested,
      currentSelectedTabID: input.previousSelectedTabID
    )
    if let tabCollection = spaceManager.tabCollection(for: input.targetSpaceID),
      resolvedSelectedTabID != tabCollection.selectedTabID
    {
      if input.focusRequested {
        applySelectedTab(resolvedSelectedTabID, in: input.targetSpaceID)
      } else {
        tabCollection.selectTab(resolvedSelectedTabID)
      }
    }

    guard input.focusRequested else { return }
    applySelectedTab(input.tabID, in: input.targetSpaceID)
    if let surface = surfaces[input.surfaceID] {
      focusSurface(surface, in: input.tabID)
    }
  }

  func notify(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    try notify(request, origin: .generic)
  }

  func notifyStructuredAgent(
    _ request: TerminalNotifyRequest,
    semantic: NotificationSemantic
  ) throws -> SupatermNotifyResult {
    try notify(request, origin: .structuredAgent(semantic))
  }

  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    let resolvedTarget = try resolvePaneTarget(target)
    switchSpace(to: resolvedTarget.spaceID)
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(resolvedTarget.anchorSurface, in: resolvedTarget.tabID)
    syncFocus()
    sessionDidChange()
    return try focusPaneResult(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surface: resolvedTarget.anchorSurface,
      tree: resolvedTarget.tree
    )
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    let resolvedTarget = try resolvePaneTarget(target)
    guard let lastSurfaceID = focusHistoryByTab[resolvedTarget.tabID]?.previous else {
      throw TerminalControlError.lastPaneNotFound
    }
    guard let lastSurface = surfaces[lastSurfaceID] else {
      throw TerminalControlError.lastPaneNotFound
    }
    switchSpace(to: resolvedTarget.spaceID)
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(lastSurface, in: resolvedTarget.tabID)
    syncFocus()
    sessionDidChange()
    return try focusPaneResult(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surface: lastSurface,
      tree: trees[resolvedTarget.tabID] ?? resolvedTarget.tree
    )
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    let resolvedClose = try resolveClose(target)
    performCloseSurface(resolvedClose.surfaceID, source: .controlClosePane)
    return resolvedClose.result
  }

  func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
    let resolvedTarget = try resolveTabItemTarget(target)
    switchSpace(to: resolvedTarget.spaceID)
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(in: resolvedTarget.tabID)
    syncFocus()
    sessionDidChange()
    return try selectTabResult(for: resolvedTarget.tabID)
  }

  func closeTab(_ target: TerminalTabTarget) throws -> SupatermCloseTabResult {
    let resolvedClose = try resolveClose(target)
    performCloseTab(resolvedClose.tabID)
    return resolvedClose.result
  }

  func resolveClose(_ target: TerminalPaneTarget) throws -> ResolvedPaneClose {
    let resolvedTarget = try resolvePaneTarget(target)
    let closeRequest = resolvedCloseRequest(
      for: .surface(resolvedTarget.anchorSurface.id),
      needsConfirmationOverride: false
    )
    return ResolvedPaneClose(
      result: try paneTarget(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: resolvedTarget.anchorSurface.id,
        tree: resolvedTarget.tree
      ),
      shouldCloseWindow: closeRequest?.closesWindow == true,
      surfaceID: resolvedTarget.anchorSurface.id
    )
  }

  func resolveClose(_ target: TerminalTabTarget) throws -> ResolvedTabClose {
    let resolvedTarget = try resolveTabItemTarget(target)
    let closeRequest = resolvedCloseRequest(
      for: .tab(resolvedTarget.tabID),
      needsConfirmationOverride: false
    )
    return ResolvedTabClose(
      result: try tabTarget(for: resolvedTarget.tabID),
      shouldCloseWindow: closeRequest?.closesWindow == true,
      tabID: resolvedTarget.tabID
    )
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    switch request.mode {
    case .submit:
      resolvedTarget.anchorSurface.bridge.submitText(request.text)
    case .type:
      resolvedTarget.anchorSurface.bridge.sendText(request.text)
    }
    return try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
  }

  func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    resolvedTarget.anchorSurface.bridge.sendKey(request.key)
    return try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    guard
      let text = resolvedTarget.anchorSurface.captureText(
        scope: request.scope,
        lines: request.lines
      )
    else {
      throw TerminalControlError.captureFailed
    }
    return SupatermCapturePaneResult(
      target: try paneTarget(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: resolvedTarget.anchorSurface.id,
        tree: resolvedTarget.tree
      ),
      text: text
    )
  }

  func paneHealth(_ request: TerminalPaneHealthRequest) throws -> SupatermPaneHealthResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    let surface = resolvedTarget.anchorSurface
    let hasSurface = surface.surface != nil
    let hasBridgeSurface = surface.bridge.surface != nil
    let isAttachedToWindow = surface.window != nil
    let isWindowVisible = surface.window?.isVisible == true
    let canCaptureText =
      surface.captureText(
        scope: .visible,
        lines: TerminalCapturePaneRequest.LineCount(exactly: 1)
      ) != nil
    return SupatermPaneHealthResult(
      target: try paneTarget(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: surface.id,
        tree: resolvedTarget.tree
      ),
      isReady: hasSurface && hasBridgeSurface && canCaptureText,
      hasSurface: hasSurface,
      hasBridgeSurface: hasBridgeSurface,
      isAttachedToWindow: isAttachedToWindow,
      isWindowVisible: isWindowVisible,
      canCaptureText: canCaptureText
    )
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    guard let node = resolvedTarget.tree.find(id: resolvedTarget.anchorSurface.id) else {
      throw TerminalControlError.resizeFailed
    }
    let newTree = try resolvedTarget.tree.resizing(
      node: node,
      by: request.amount,
      in: mapResizeDirection(request.direction),
      with: CGRect(origin: .zero, size: resolvedTarget.tree.viewBounds())
    )
    trees[resolvedTarget.tabID] = newTree
    sessionDidChange()
    return try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: newTree
    )
  }

  func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    guard let node = resolvedTarget.tree.find(id: resolvedTarget.anchorSurface.id) else {
      throw TerminalControlError.resizeFailed
    }
    let newTree = try resolvedTarget.tree.sizing(
      node: node,
      to: request.amount,
      along: mapPaneAxis(request.axis),
      unit: mapPaneSizeUnit(request.unit),
      with: CGRect(origin: .zero, size: resolvedTarget.tree.viewBounds())
    )
    trees[resolvedTarget.tabID] = newTree
    sessionDidChange()
    return try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: newTree
    )
  }

  func renameTab(_ request: TerminalRenameTabRequest) throws -> SupatermRenameTabResult {
    let resolvedTarget = try resolveTabItemTarget(request.target)
    let title = Self.trimmedNonEmpty(request.title)
    setLockedTabTitle(title, for: resolvedTarget.tabID)
    return SupatermRenameTabResult(
      isTitleLocked: title != nil,
      target: try tabTarget(for: resolvedTarget.tabID)
    )
  }

  func pinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    let resolvedTarget = try resolveTabItemTarget(target)
    _ = setTabPinned(resolvedTarget.tabID, isPinned: true)
    return try pinTabResult(for: resolvedTarget.tabID)
  }

  func unpinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    let resolvedTarget = try resolveTabItemTarget(target)
    if let manager = spaceManager.tabCollection(for: resolvedTarget.spaceID),
      manager.rootItemID(containing: resolvedTarget.tabID) == .tab(resolvedTarget.tabID)
    {
      _ = setTabPinned(resolvedTarget.tabID, isPinned: false)
    }
    return try pinTabResult(for: resolvedTarget.tabID)
  }

  func equalizePanes(
    _ request: TerminalEqualizePanesRequest
  ) throws -> SupatermEqualizePanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.equalized()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  func tilePanes(_ request: TerminalTilePanesRequest) throws -> SupatermTilePanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.tiled()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  func mainVerticalPanes(
    _ request: TerminalMainVerticalPanesRequest
  ) throws -> SupatermMainVerticalPanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.mainVertical()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  func nextTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    let spaceID = try resolvedNavigationSpaceID(request)
    let tabs = spaceManager.tabs(in: spaceID)
    guard !tabs.isEmpty else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    let currentTabID = spaceManager.selectedTabID(in: spaceID) ?? tabs[0].id
    guard let currentIndex = tabs.firstIndex(where: { $0.id == currentTabID }) else {
      throw TerminalControlError.lastTabNotFound
    }
    let nextIndex = (currentIndex + 1) % tabs.count
    applySelectedTab(tabs[nextIndex].id, in: spaceID)
    focusSurface(in: tabs[nextIndex].id)
    syncFocus()
    sessionDidChange()
    return try selectTabResult(for: tabs[nextIndex].id)
  }

  func previousTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    let spaceID = try resolvedNavigationSpaceID(request)
    let tabs = spaceManager.tabs(in: spaceID)
    guard !tabs.isEmpty else {
      throw TerminalControlError.tabNotFound(windowIndex: 1, spaceIndex: 1, tabIndex: 1)
    }
    let currentTabID = spaceManager.selectedTabID(in: spaceID) ?? tabs[0].id
    guard let currentIndex = tabs.firstIndex(where: { $0.id == currentTabID }) else {
      throw TerminalControlError.lastTabNotFound
    }
    let previousIndex = (currentIndex - 1 + tabs.count) % tabs.count
    applySelectedTab(tabs[previousIndex].id, in: spaceID)
    focusSurface(in: tabs[previousIndex].id)
    syncFocus()
    sessionDidChange()
    return try selectTabResult(for: tabs[previousIndex].id)
  }

  func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    let spaceID = try resolvedNavigationSpaceID(request)
    guard let tabID = spaceManager.instance(for: spaceID)?.previousSelectedTabID else {
      throw TerminalControlError.lastTabNotFound
    }
    applySelectedTab(tabID, in: spaceID)
    focusSurface(in: tabID)
    syncFocus()
    sessionDidChange()
    return try selectTabResult(for: tabID)
  }

  @discardableResult
  func clearRecentStructuredNotification(for surfaceID: UUID) -> Bool {
    notificationStore.clearRecentStructured(for: surfaceID)
  }

  func resolveSpaceTarget(_ target: TerminalSpaceTarget) throws -> ResolvedCreateTabTarget {
    let spaceID = TerminalSpaceID(rawValue: target.spaceID)
    guard let space = space(warming: spaceID) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return ResolvedCreateTabTarget(
      inheritedSurfaceID: inheritedSurfaceID(in: spaceID),
      placement: nil,
      space: space
    )
  }

  func resolveTabTarget(_ target: TerminalTabTarget) throws -> ResolvedCreatePaneTarget {
    do {
      return try resolveCreatePaneTarget(.tab(target.tabID))
    } catch TerminalCreatePaneError.contextPaneNotFound {
      throw TerminalControlError.contextPaneNotFound
    }
  }

  func resolveTabItemTarget(_ target: TerminalTabTarget) throws -> ResolvedTabItemTarget {
    let tabID = TerminalTabID(rawValue: target.tabID)
    warmInstance(containingTab: tabID)
    guard let instance = spaceManager.instance(for: tabID) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return ResolvedTabItemTarget(spaceID: instance.spaceID, tabID: tabID)
  }

  func resolvePaneTarget(_ target: TerminalPaneTarget) throws -> ResolvedCreatePaneTarget {
    do {
      return try resolveCreatePaneTarget(.pane(target.paneID))
    } catch TerminalCreatePaneError.contextPaneNotFound {
      throw TerminalControlError.contextPaneNotFound
    }
  }

  func resolvedNavigationSpaceID(_ request: TerminalTabNavigationRequest) throws
    -> TerminalSpaceID
  {
    let spaceID = TerminalSpaceID(rawValue: request.spaceID)
    guard spaceManager.space(for: spaceID) != nil else {
      throw TerminalControlError.contextPaneNotFound
    }
    return spaceID
  }

  func spaceTarget(for spaceID: TerminalSpaceID) throws -> SupatermSpaceTarget {
    guard
      let space = spaceManager.space(for: spaceID),
      let spaceIndex = spaceManager.spaceIndex(for: spaceID)
    else {
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
    guard
      let space = spaceManager.space(for: tabID),
      let spaceIndex = spaceManager.spaceIndex(for: space.id)
    else {
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
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current,
      let surface = surfaces[focusedSurfaceID]
    {
      return (tree, surface)
    }
    guard let surface = tree.root?.leftmostLeaf() else { return nil }
    return (tree, surface)
  }

  func focusPaneResult(
    spaceID: TerminalSpaceID,
    tabID: TerminalTabID,
    surface: GhosttySurfaceView,
    tree: SplitTree<GhosttySurfaceView>
  ) throws -> SupatermFocusPaneResult {
    let target = try paneTarget(
      spaceID: spaceID,
      tabID: tabID,
      surfaceID: surface.id,
      tree: tree
    )
    let activity = Self.surfaceActivity(
      isSelectedTab: selectedTabID == tabID,
      isPaneVisible: visiblePaneIDs.contains(surface.id),
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surface: surface
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
      isPaneVisible: visiblePaneIDs.contains(resolvedSurface.surface.id),
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surface: resolvedSurface.surface
    )
    return SupatermSelectTabResult(
      isFocused: activity.isFocused,
      isSelectedSpace: displayedSpaceID == space.id,
      isSelectedTab: selectedTabID == tabID,
      isTitleLocked: spaceManager.tab(for: tabID)?.isTitleLocked == true,
      paneIndex: paneTarget.paneIndex,
      paneID: paneTarget.paneID,
      target: target
    )
  }

  func pinTabResult(for tabID: TerminalTabID) throws -> SupatermPinTabResult {
    let isPinned: Bool
    if let space = spaceManager.space(for: tabID),
      let manager = spaceManager.tabCollection(for: space.id),
      manager.rootItemID(containing: tabID) == .tab(tabID)
    {
      isPinned = manager.isPinned(tabID) == true
    } else {
      isPinned = false
    }
    return SupatermPinTabResult(
      isPinned: isPinned,
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
      isPaneVisible: visiblePaneIDs.contains(resolvedSurface.surface.id),
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surface: resolvedSurface.surface
    )
    return SupatermSelectSpaceResult(
      isFocused: activity.isFocused,
      isSelectedSpace: displayedSpaceID == spaceID,
      isSelectedTab: selectedTabID == tabID,
      paneIndex: paneTarget.paneIndex,
      paneID: paneTarget.paneID,
      tabIndex: tabTarget.tabIndex,
      tabID: tabTarget.tabID,
      target: target
    )
  }

  func notify(
    _ request: TerminalNotifyRequest,
    origin: NotificationOrigin
  ) throws -> SupatermNotifyResult {
    let resolvedTarget = try resolveNotifyTarget(request.target)
    let paneLocation = try resolvedPaneLocation(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
    let isPaneVisible = visiblePaneIDs.contains(resolvedTarget.anchorSurface.id)
    let selectionState = Self.newPaneSelectionState(
      isSelectedTab: selectedTabID == resolvedTarget.tabID,
      isPaneVisible: isPaneVisible,
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
      surface: resolvedTarget.anchorSurface
    )
    let attentionState: SupatermNotificationAttentionState = .unread
    let storedAttentionState: SupatermNotificationAttentionState? =
      if origin == .structuredAgent(.completion),
        selectionState.isSelectedTab,
        isPaneVisible,
        windowActivity.isVisible,
        windowActivity.isKeyWindow
      {
        nil
      } else {
        attentionState
      }
    let desktopNotificationDisposition = resolvedDesktopNotificationDisposition(
      allowDesktopNotificationWhenAgentActive: request.allowDesktopNotificationWhenAgentActive,
      isFocused: selectionState.isFocused,
      tabID: resolvedTarget.tabID
    )
    let resolvedTitle = resolvedNotificationTitle(
      request.title,
      for: resolvedTarget.tabID
    )
    let createdAt = Date()
    coalesceStructuredNotificationIfNeeded(
      body: request.body,
      origin: origin,
      surfaceID: resolvedTarget.anchorSurface.id,
      title: resolvedTitle
    )
    notificationStore.append(
      PaneNotification(
        attentionState: storedAttentionState,
        body: request.body,
        createdAt: createdAt,
        title: resolvedTitle,
        origin: origin
      ),
      for: resolvedTarget.anchorSurface.id
    )
    updateRecentStructuredNotificationIfNeeded(
      body: request.body,
      createdAt: createdAt,
      origin: origin,
      surfaceID: resolvedTarget.anchorSurface.id,
      title: resolvedTitle
    )

    return SupatermNotifyResult(
      attentionState: attentionState,
      desktopNotificationDisposition: desktopNotificationDisposition,
      resolvedTitle: resolvedTitle,
      windowIndex: 1,
      spaceIndex: paneLocation.spaceIndex,
      spaceID: resolvedTarget.spaceID.rawValue,
      tabIndex: paneLocation.tabIndex,
      tabID: resolvedTarget.tabID.rawValue,
      paneIndex: paneLocation.paneIndex,
      paneID: resolvedTarget.anchorSurface.id
    )
  }

  func handleDesktopNotification(
    body: String,
    surfaceID: UUID,
    title: String
  ) {
    let subtitle = ""
    guard !shouldSuppressDesktopNotification(body: body, surfaceID: surfaceID, title: title) else {
      return
    }
    guard
      let result = try? notify(
        TerminalNotifyRequest(
          body: body,
          target: .pane(surfaceID),
          title: Self.trimmedNonEmpty(title)
        ),
        origin: .terminalDesktop
      )
    else {
      return
    }
    emit(
      .notificationReceived(
        TerminalNotificationEvent(
          attentionState: result.attentionState,
          body: body,
          desktopNotificationDisposition: result.desktopNotificationDisposition,
          resolvedTitle: result.resolvedTitle,
          sourceSurfaceID: surfaceID,
          subtitle: subtitle
        )
      )
    )
  }

  func handleDirectInteraction(on surfaceID: UUID) {
    clearNotificationAttention(for: surfaceID)
  }

}
