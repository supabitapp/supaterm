import AppKit
import Foundation
import GhosttyKit
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalCore
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature

extension TerminalHostState {
  public struct ResolvedPaneClose {
    public let result: SupatermClosePaneResult
    public let shouldCloseWindow: Bool
    public let surfaceID: UUID
  }

  public struct ResolvedTabClose {
    public let result: SupatermCloseTabResult
    public let shouldCloseWindow: Bool
    public let tabID: TerminalTabID
  }

  public func treeSnapshot() -> SupatermTreeSnapshot {
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: windowActivity.isKeyWindow,
      spaces: spaces.enumerated().map { spaceOffset, space in
        let tabs = spaceManager.tabs(in: space.id).enumerated().map { tabOffset, tab in
          let focusedSurfaceID = focusHistoryByTab[tab.id]?.current
          let panes = (trees[tab.id]?.leaves() ?? []).enumerated().map { paneOffset, pane in
            SupatermTreeSnapshot.Pane(
              index: paneOffset + 1,
              id: pane.id,
              isFocused: pane.id == focusedSurfaceID
            )
          }

          return SupatermTreeSnapshot.Tab(
            index: tabOffset + 1,
            id: tab.id.rawValue,
            title: tab.title,
            isSelected: tab.id == spaceManager.selectedTabID(in: space.id),
            panes: panes
          )
        }

        return SupatermTreeSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          isSelected: space.id == selectedSpaceID,
          tabs: tabs
        )
      }
    )
    return SupatermTreeSnapshot(windows: [window])
  }

  public func debugWindowSnapshot(index: Int) -> SupatermAppDebugSnapshot.Window {
    SupatermAppDebugSnapshot.Window(
      index: index,
      isKey: windowActivity.isKeyWindow,
      isVisible: windowActivity.isVisible,
      spaces: spaces.enumerated().map { spaceOffset, space in
        let tabs = spaceManager.tabs(in: space.id).enumerated().map { tabOffset, tab in
          let focusedSurfaceID = focusHistoryByTab[tab.id]?.current
          let panes = (trees[tab.id]?.leaves() ?? []).enumerated().map { paneOffset, pane in
            debugPaneSnapshot(
              pane,
              index: paneOffset + 1,
              isFocused: pane.id == focusedSurfaceID
            )
          }

          return SupatermAppDebugSnapshot.Tab(
            index: tabOffset + 1,
            id: tab.id.rawValue,
            title: tab.title,
            isSelected: tab.id == spaceManager.selectedTabID(in: space.id),
            isPinned: tab.isPinned,
            isDirty: tab.isDirty,
            isTitleLocked: tab.isTitleLocked,
            hasRunningActivity: panes.contains(where: \.isRunning),
            hasBell: panes.contains(where: { $0.bellCount > 0 }),
            hasReadOnly: panes.contains(where: \.isReadOnly),
            hasSecureInput: panes.contains(where: \.hasSecureInput),
            panes: panes
          )
        }

        return SupatermAppDebugSnapshot.Space(
          index: spaceOffset + 1,
          id: space.id.rawValue,
          name: space.name,
          isSelected: space.id == selectedSpaceID,
          tabs: tabs
        )
      }
    )
  }

  public func notify(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    try notify(request, origin: .generic)
  }

  public func notifyStructuredAgent(
    _ request: TerminalNotifyRequest,
    semantic: NotificationSemantic
  ) throws -> SupatermNotifyResult {
    try notify(request, origin: .structuredAgent(semantic))
  }

  public func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
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

  public func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
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

  public func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    let resolvedClose = try resolveClose(target)
    performCloseSurface(resolvedClose.surfaceID, source: .controlClosePane)
    return resolvedClose.result
  }

  public func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
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

  public func closeTab(_ target: TerminalTabTarget) throws -> SupatermCloseTabResult {
    let resolvedClose = try resolveClose(target)
    performCloseTab(resolvedClose.tabID)
    return resolvedClose.result
  }

  public func resolveClose(_ target: TerminalPaneTarget) throws -> ResolvedPaneClose {
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

  public func resolveClose(_ target: TerminalTabTarget) throws -> ResolvedTabClose {
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

  public func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    let resolvedTarget = try resolvePaneTarget(request.target)
    TerminalControlTrace.write(
      event: "send_text",
      fields: [
        "space_id": resolvedTarget.spaceID.rawValue.uuidString.lowercased(),
        "tab_id": resolvedTarget.tabID.rawValue.uuidString.lowercased(),
        "surface_id": resolvedTarget.anchorSurface.id.uuidString.lowercased(),
        "text_length": String(request.text.count),
        "text_has_cr": request.text.contains("\r") ? "1" : "0",
        "text_has_lf": request.text.contains("\n") ? "1" : "0",
        "text_preview": TerminalControlTrace.preview(request.text),
      ]
    )
    resolvedTarget.anchorSurface.bridge.sendText(request.text)
    return try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
  }

  public func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
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

  public func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
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

  public func paneHealth(_ request: TerminalPaneHealthRequest) throws -> SupatermPaneHealthResult {
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

  public func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
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

  public func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
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

  public func renameTab(_ request: TerminalRenameTabRequest) throws -> SupatermRenameTabResult {
    let resolvedTarget = try resolveTabItemTarget(request.target)
    let title = Self.trimmedNonEmpty(request.title)
    setLockedTabTitle(title, for: resolvedTarget.tabID)
    return SupatermRenameTabResult(
      isTitleLocked: title != nil,
      target: try tabTarget(for: resolvedTarget.tabID)
    )
  }

  public func pinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    let resolvedTarget = try resolveTabItemTarget(target)
    if spaceManager.tab(for: resolvedTarget.tabID)?.isPinned != true {
      togglePinned(resolvedTarget.tabID)
    }
    return try pinTabResult(for: resolvedTarget.tabID)
  }

  public func unpinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    let resolvedTarget = try resolveTabItemTarget(target)
    if spaceManager.tab(for: resolvedTarget.tabID)?.isPinned == true {
      togglePinned(resolvedTarget.tabID)
    }
    return try pinTabResult(for: resolvedTarget.tabID)
  }

  public func equalizePanes(_ request: TerminalEqualizePanesRequest) throws -> SupatermEqualizePanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.equalized()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  public func tilePanes(_ request: TerminalTilePanesRequest) throws -> SupatermTilePanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.tiled()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  public func mainVerticalPanes(
    _ request: TerminalMainVerticalPanesRequest
  ) throws -> SupatermMainVerticalPanesResult {
    let resolvedTarget = try resolveTabTarget(request.target)
    trees[resolvedTarget.tabID] = resolvedTarget.tree.mainVertical()
    sessionDidChange()
    return try tabTarget(for: resolvedTarget.tabID)
  }

  public func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    if let windowIndex = request.target.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    let spaceID = try createSpace(named: request.name)
    return try selectSpaceResult(for: spaceID)
  }

  public func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    let resolvedTarget = try resolveSpaceTarget(target)
    selectSpace(resolvedTarget.space.id, persistDefaultSelection: true)
    return try selectSpaceResult(for: resolvedTarget.space.id)
  }

  public func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    let resolvedTarget = try resolveSpaceTarget(target)
    let result = try spaceTarget(for: resolvedTarget.space.id)
    if spaces.count == 1 {
      throw TerminalControlError.onlyRemainingSpace
    }
    deleteSpace(resolvedTarget.space.id)
    return result
  }

  public func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    let resolvedTarget = try resolveSpaceTarget(request.target)
    renameSpace(resolvedTarget.space.id, to: request.name)
    return try spaceTarget(for: resolvedTarget.space.id)
  }

  public func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
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

  public func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
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

  public func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    guard let previousSelectedSpaceID else {
      throw TerminalControlError.lastSpaceNotFound
    }
    selectSpace(previousSelectedSpaceID, persistDefaultSelection: true)
    return try selectSpaceResult(for: previousSelectedSpaceID)
  }

  public func nextTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
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

  public func previousTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
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

  public func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
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
}
