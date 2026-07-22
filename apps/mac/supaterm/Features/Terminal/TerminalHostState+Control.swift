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
    let previousSelectedSpaceID: TerminalSpaceID?
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

  func treeSnapshot() -> SupatermTreeSnapshot {
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: windowActivity.isKeyWindow,
      spaces: spaces.enumerated().map { spaceOffset, space in
        return SupatermTreeSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          isSelected: space.id == selectedSpaceID,
          rootItems: spaceManager.rootItems(in: space.id).map {
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
      spaces: spaces.enumerated().map { spaceOffset, space in
        return SupatermAppDebugSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          isSelected: space.id == selectedSpaceID,
          rootItems: spaceManager.rootItems(in: space.id).map {
            debugRootItemSnapshot($0, spaceID: space.id)
          }
        )
      }
    )
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
    let focusedSurfaceID = focusHistoryByTab[tab.id]?.current
    return SupatermTreeSnapshot.Tab(
      id: tab.id.rawValue,
      title: tab.title,
      isSelected: tab.id == spaceManager.selectedTabID(in: spaceID),
      panes: (trees[tab.id]?.leaves() ?? []).enumerated().map { paneOffset, pane in
        SupatermTreeSnapshot.Pane(
          index: paneOffset + 1,
          id: pane.id,
          isFocused: pane.id == focusedSurfaceID
        )
      }
    )
  }

  func treeGroupSnapshot(
    _ group: TerminalTabGroupItem,
    spaceID: TerminalSpaceID
  ) -> SupatermTreeSnapshot.Group {
    SupatermTreeSnapshot.Group(
      color: group.color.socketColor,
      id: group.id.rawValue,
      isCollapsed: collapsedTabGroupIDsBySpace[spaceID]?.contains(group.id) == true,
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
          isCollapsed: collapsedTabGroupIDsBySpace[spaceID]?.contains(group.id) == true,
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
    let focusedSurfaceID = focusHistoryByTab[tab.id]?.current
    let panes = (trees[tab.id]?.leaves() ?? []).enumerated().map { paneOffset, pane in
      debugPaneSnapshot(
        pane,
        index: paneOffset + 1,
        isFocused: pane.id == focusedSurfaceID
      )
    }
    return SupatermAppDebugSnapshot.Tab(
      id: tab.id.rawValue,
      title: tab.title,
      isSelected: tab.id == spaceManager.selectedTabID(in: spaceID),
      isDirty: tab.isDirty,
      isTitleLocked: tab.isTitleLocked,
      hasRunningActivity: panes.contains(where: \.isRunning),
      hasBell: panes.contains(where: { $0.bellCount > 0 }),
      hasReadOnly: panes.contains(where: \.isReadOnly),
      hasSecureInput: panes.contains(where: \.hasSecureInput),
      panes: panes
    )
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    let resolvedTarget = try resolveCreatePaneTarget(request.target)
    let newSurface = createSurface(
      tabID: resolvedTarget.tabID,
      startupCommand: request.startupCommand,
      inheritingFromSurfaceID: resolvedTarget.anchorSurface.id,
      workingDirectory: request.cwd.map { URL(fileURLWithPath: $0, isDirectory: true) },
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

      let nextSelectedTabID = Self.selectedTabID(
        afterCreatingPaneIn: resolvedTarget.tabID,
        focusRequested: request.focus,
        currentSelectedTabID: spaceManager.selectedTabID
      )
      if let nextSelectedTabID, nextSelectedTabID != spaceManager.selectedTabID {
        if let space = spaceManager.space(for: nextSelectedTabID) {
          _ = applySelectedSpace(space.id)
          applySelectedTab(nextSelectedTabID, in: space.id)
        }
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus(windowActivity)
      sessionDidChange()

      let paneLocation = try resolvedPaneLocation(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: newSurface.id,
        tree: finalTree
      )
      let selectionState = Self.newPaneSelectionState(
        selectedTabID: spaceManager.selectedTabID,
        targetTabID: resolvedTarget.tabID,
        windowActivity: windowActivity,
        focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
        surfaceID: newSurface.id
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
    let currentSelectedSpaceID = spaceManager.selectedSpaceID
    let currentSelectedTabID = spaceManager.selectedTabID
    let placement = resolvedTarget.placement
    var createdTabID: TerminalTabID?

    do {
      let tabID =
        createTab(
          in: resolvedTarget.space.id,
          focusing: false,
          startupCommand: request.startupCommand,
          workingDirectory: request.cwd.map { URL(fileURLWithPath: $0, isDirectory: true) },
          inheritingFromSurfaceID: resolvedTarget.inheritedSurfaceID,
          at: placement,
          sessionChangesEnabled: false,
          synchronizesFocus: Self.shouldSyncFocusDuringTabCreation(
            targetSpaceID: resolvedTarget.space.id,
            focusRequested: request.focus,
            currentSelectedSpaceID: currentSelectedSpaceID
          )
        )
      guard
        let tabID,
        let tree = trees[tabID],
        let surfaceID = tree.root?.leftmostLeaf().id
      else {
        throw TerminalCreateTabError.creationFailed
      }
      createdTabID = tabID

      applyTabCreationSelection(
        TabCreationSelectionInput(
          tabID: tabID,
          surfaceID: surfaceID,
          focusRequested: request.focus,
          targetSpaceID: resolvedTarget.space.id,
          previousSelectedSpaceID: currentSelectedSpaceID,
          previousSelectedTabID: currentSelectedTabID
        )
      )

      syncFocus(windowActivity)
      sessionDidChange()

      guard
        let spaceIndex = spaceManager.spaceIndex(for: resolvedTarget.space.id),
        let tabIndex = spaceManager.tabs(in: resolvedTarget.space.id)
          .firstIndex(where: { $0.id == tabID }),
        let paneIndex = tree.leaves().firstIndex(where: { $0.id == surfaceID })
      else {
        throw TerminalCreateTabError.creationFailed
      }

      let selectionState = Self.newTabSelectionState(
        NewTabSelectionInput(
          selectedSpaceID: spaceManager.selectedSpaceID,
          targetSpaceID: resolvedTarget.space.id,
          selectedTabID: spaceManager.selectedTabID,
          targetTabID: tabID,
          windowActivity: windowActivity,
          focusedSurfaceID: focusHistoryByTab[tabID]?.current,
          surfaceID: surfaceID
        )
      )

      return SupatermNewTabResult(
        isFocused: selectionState.isFocused,
        isSelectedSpace: selectionState.isSelectedSpace,
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
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw error
    } catch {
      if let createdTabID {
        removeTree(for: createdTabID, source: .controlCleanup)
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw TerminalCreateTabError.creationFailed
    }
  }

  private func applyTabCreationSelection(_ input: TabCreationSelectionInput) {
    let resolvedSelectedTabID = Self.selectedTabID(
      afterCreatingTabIn: input.targetSpaceID,
      targetTabID: input.tabID,
      focusRequested: input.focusRequested,
      currentSelectedSpaceID: input.previousSelectedSpaceID,
      currentSelectedTabID: input.previousSelectedTabID
    )
    if let tabManager = spaceManager.tabManager(for: input.targetSpaceID),
      resolvedSelectedTabID != tabManager.selectedTabId
    {
      if input.focusRequested {
        applySelectedTab(resolvedSelectedTabID, in: input.targetSpaceID)
      } else {
        tabManager.selectTab(resolvedSelectedTabID)
      }
    }

    guard input.focusRequested else { return }
    if input.previousSelectedSpaceID != input.targetSpaceID {
      selectSpace(input.targetSpaceID, persistDefaultSelection: true)
    }
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
    if selectedSpaceID != resolvedTarget.spaceID {
      selectSpace(resolvedTarget.spaceID, persistDefaultSelection: true)
    }
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(resolvedTarget.anchorSurface, in: resolvedTarget.tabID)
    syncFocus(windowActivity)
    sessionDidChange()
    return try focusPaneResult(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
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
    if selectedSpaceID != resolvedTarget.spaceID {
      selectSpace(resolvedTarget.spaceID, persistDefaultSelection: true)
    }
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(lastSurface, in: resolvedTarget.tabID)
    syncFocus(windowActivity)
    sessionDidChange()
    return try focusPaneResult(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: lastSurfaceID,
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
    if selectedSpaceID != resolvedTarget.spaceID {
      selectSpace(resolvedTarget.spaceID, persistDefaultSelection: true)
    }
    applySelectedTab(resolvedTarget.tabID, in: resolvedTarget.spaceID)
    focusSurface(in: resolvedTarget.tabID)
    syncFocus(windowActivity)
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
    TerminalControlTrace.write(
      event: "send_text",
      fields: [
        "mode": request.mode.rawValue,
        "space_id": resolvedTarget.spaceID.rawValue.uuidString.lowercased(),
        "tab_id": resolvedTarget.tabID.rawValue.uuidString.lowercased(),
        "surface_id": resolvedTarget.anchorSurface.id.uuidString.lowercased(),
        "text_length": String(request.text.count),
        "text_has_cr": request.text.contains("\r") ? "1" : "0",
        "text_has_lf": request.text.contains("\n") ? "1" : "0",
        "text_preview": TerminalControlTrace.preview(request.text),
      ]
    )
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
    TerminalControlTrace.write(
      event: "send_key",
      fields: [
        "key": request.key.rawValue,
        "space_id": resolvedTarget.spaceID.rawValue.uuidString.lowercased(),
        "tab_id": resolvedTarget.tabID.rawValue.uuidString.lowercased(),
        "surface_id": resolvedTarget.anchorSurface.id.uuidString.lowercased(),
      ]
    )
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
    let canCaptureText = surface.captureText(scope: .visible, lines: 1) != nil
    return SupatermPaneHealthResult(
      target: try paneTarget(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: surface.id,
        tree: resolvedTarget.tree
      ),
      isReady: hasSurface && hasBridgeSurface && isAttachedToWindow && isWindowVisible
        && canCaptureText,
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
    if let manager = spaceManager.tabManager(for: resolvedTarget.spaceID),
      manager.rootItemID(containing: resolvedTarget.tabID) == .tab(resolvedTarget.tabID)
    {
      _ = setTabPinned(resolvedTarget.tabID, isPinned: false)
    }
    return try pinTabResult(for: resolvedTarget.tabID)
  }

  func equalizePanes(_ request: TerminalEqualizePanesRequest) throws -> SupatermEqualizePanesResult {
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

  func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    guard tabID(containing: request.windowAnchorPaneID) != nil else {
      throw TerminalControlError.contextPaneNotFound
    }
    let spaceID = try createSpace(named: request.name, focus: request.focus)
    return try selectSpaceResult(for: spaceID)
  }

  func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    let resolvedTarget = try resolveSpaceTarget(target)
    selectSpace(resolvedTarget.space.id, persistDefaultSelection: true)
    return try selectSpaceResult(for: resolvedTarget.space.id)
  }

  func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    let resolvedTarget = try resolveSpaceTarget(target)
    let result = try spaceTarget(for: resolvedTarget.space.id)
    if spaces.count == 1 {
      throw TerminalControlError.onlyRemainingSpace
    }
    deleteSpace(resolvedTarget.space.id)
    return result
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    let resolvedTarget = try resolveSpaceTarget(request.target)
    try renameSpace(resolvedTarget.space.id, to: request.name)
    return try spaceTarget(for: resolvedTarget.space.id)
  }

  func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    let currentSpaceID = try resolvedNavigationSpaceID(request)
    let allSpaces = spaces
    guard
      let currentIndex = allSpaces.firstIndex(where: { $0.id == currentSpaceID }),
      !allSpaces.isEmpty
    else {
      throw TerminalControlError.lastSpaceNotFound
    }
    let nextIndex = (currentIndex + 1) % allSpaces.count
    selectSpace(allSpaces[nextIndex].id, persistDefaultSelection: true)
    return try selectSpaceResult(for: allSpaces[nextIndex].id)
  }

  func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    let currentSpaceID = try resolvedNavigationSpaceID(request)
    let allSpaces = spaces
    guard
      let currentIndex = allSpaces.firstIndex(where: { $0.id == currentSpaceID }),
      !allSpaces.isEmpty
    else {
      throw TerminalControlError.lastSpaceNotFound
    }
    let previousIndex = (currentIndex - 1 + allSpaces.count) % allSpaces.count
    selectSpace(allSpaces[previousIndex].id, persistDefaultSelection: true)
    return try selectSpaceResult(for: allSpaces[previousIndex].id)
  }

  func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    _ = try resolvedNavigationSpaceID(request)
    guard let previousSelectedSpaceID else {
      throw TerminalControlError.lastSpaceNotFound
    }
    selectSpace(previousSelectedSpaceID, persistDefaultSelection: true)
    return try selectSpaceResult(for: previousSelectedSpaceID)
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
    selectSpace(spaceID, persistDefaultSelection: true)
    applySelectedTab(tabs[nextIndex].id, in: spaceID)
    focusSurface(in: tabs[nextIndex].id)
    syncFocus(windowActivity)
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
    selectSpace(spaceID, persistDefaultSelection: true)
    applySelectedTab(tabs[previousIndex].id, in: spaceID)
    focusSurface(in: tabs[previousIndex].id)
    syncFocus(windowActivity)
    sessionDidChange()
    return try selectTabResult(for: tabs[previousIndex].id)
  }

  func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    let spaceID = try resolvedNavigationSpaceID(request)
    guard let tabID = previousSelectedTabIDBySpace[spaceID] else {
      throw TerminalControlError.lastTabNotFound
    }
    selectSpace(spaceID, persistDefaultSelection: true)
    applySelectedTab(tabID, in: spaceID)
    focusSurface(in: tabID)
    syncFocus(windowActivity)
    sessionDidChange()
    return try selectTabResult(for: tabID)
  }

  @discardableResult
  func clearRecentStructuredNotification(for surfaceID: UUID) -> Bool {
    notificationStore.clearRecentStructured(for: surfaceID)
  }

  func resolveSpaceTarget(_ target: TerminalSpaceTarget) throws -> ResolvedCreateTabTarget {
    let spaceID = TerminalSpaceID(rawValue: target.spaceID)
    guard let space = spaces.first(where: { $0.id == spaceID }) else {
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
    guard let space = spaceManager.space(for: tabID) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return ResolvedTabItemTarget(spaceID: space.id, tabID: tabID)
  }

  func resolvePaneTarget(_ target: TerminalPaneTarget) throws -> ResolvedCreatePaneTarget {
    do {
      return try resolveCreatePaneTarget(.pane(target.paneID))
    } catch TerminalCreatePaneError.contextPaneNotFound {
      throw TerminalControlError.contextPaneNotFound
    }
  }

  func resolvedNavigationSpaceID(_ request: TerminalSpaceNavigationRequest) throws
    -> TerminalSpaceID
  {
    let spaceID = TerminalSpaceID(rawValue: request.spaceID)
    guard spaces.contains(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return spaceID
  }

  func resolvedNavigationSpaceID(_ request: TerminalTabNavigationRequest) throws
    -> TerminalSpaceID
  {
    let spaceID = TerminalSpaceID(rawValue: request.spaceID)
    guard spaces.contains(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return spaceID
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
    let isPinned: Bool
    if let space = spaceManager.space(for: tabID),
      let manager = spaceManager.tabManager(for: space.id),
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
    let selectionState = Self.newPaneSelectionState(
      selectedTabID: spaceManager.selectedTabID,
      targetTabID: resolvedTarget.tabID,
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
      surfaceID: resolvedTarget.anchorSurface.id
    )
    let attentionState: SupatermNotificationAttentionState = .unread
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
        attentionState: attentionState,
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
