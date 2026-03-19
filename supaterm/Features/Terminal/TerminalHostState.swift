import AppKit
import Foundation
import GhosttyKit
import Observation
import SupatermCLIShared
import SwiftUI

@MainActor
@Observable
final class TerminalHostState {
  struct NewPaneSelectionState: Equatable {
    let isFocused: Bool
    let isSelectedTab: Bool
  }

  struct TabIndicators: Equatable {
    var isRunning = false
    var hasBell = false
    var isReadOnly = false
    var hasSecureInput = false
  }

  struct SurfaceActivity: Equatable {
    let isVisible: Bool
    let isFocused: Bool
  }

  @ObservationIgnored
  private let runtime: GhosttyRuntime
  @ObservationIgnored
  private var eventContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  let tabManager = TerminalTabManager()

  private var pendingEvents: [TerminalClient.Event] = []
  private var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  private var surfaces: [UUID: GhosttySurfaceView] = [:]
  private var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var lastEmittedFocusSurfaceID: UUID?

  var windowActivity = WindowActivityState.inactive

  init(runtime: GhosttyRuntime = GhosttyRuntime()) {
    self.runtime = runtime
  }

  func eventStream() -> AsyncStream<TerminalClient.Event> {
    eventContinuation?.finish()
    let (stream, continuation) = AsyncStream.makeStream(of: TerminalClient.Event.self)
    eventContinuation = continuation
    if !pendingEvents.isEmpty {
      let bufferedEvents = pendingEvents
      pendingEvents.removeAll()
      for event in bufferedEvents {
        continuation.yield(event)
      }
    }
    return stream
  }

  func handleCommand(_ command: TerminalClient.Command) {
    switch command {
    case .closeSurface(let surfaceID):
      closeSurface(surfaceID)
    case .closeTab(let tabID):
      closeTab(tabID)
    case .createTab(let inheritingFromSurfaceID):
      _ = createTab(inheritingFromSurfaceID: inheritingFromSurfaceID)
    case .ensureInitialTab(let focusing):
      ensureInitialTab(focusing: focusing)
    case .navigateSearch(let direction):
      _ = navigateSearchOnFocusedSurface(direction)
    case .nextTab:
      nextTab()
    case .performBindingActionOnFocusedSurface(let action):
      _ = performBindingActionOnFocusedSurface(action)
    case .performSplitOperation(let tabID, let operation):
      performSplitOperation(operation, in: tabID)
    case .previousTab:
      previousTab()
    case .selectLastTab,
      .selectTab,
      .selectTabSlot,
      .setPinnedTabOrder,
      .setRegularTabOrder,
      .togglePinned,
      .updateWindowActivity:
      handleSelectionCommand(command)
    }
  }

  private func handleSelectionCommand(_ command: TerminalClient.Command) {
    switch command {
    case .selectLastTab:
      selectLastTab()
    case .selectTab(let tabID):
      selectTab(tabID)
    case .selectTabSlot(let slot):
      selectTab(slot: slot)
    case .setPinnedTabOrder(let orderedIDs):
      setPinnedTabOrder(orderedIDs)
    case .setRegularTabOrder(let orderedIDs):
      setRegularTabOrder(orderedIDs)
    case .togglePinned(let tabID):
      togglePinned(tabID)
    case .updateWindowActivity(let activity):
      updateWindowActivity(activity)
    default:
      return
    }
  }

  var tabs: [TerminalTabItem] {
    tabManager.tabs
  }

  var pinnedTabs: [TerminalTabItem] {
    tabManager.pinnedTabs
  }

  var regularTabs: [TerminalTabItem] {
    tabManager.regularTabs
  }

  var visibleTabs: [TerminalTabItem] {
    tabManager.visibleTabs
  }

  var selectedTabID: TerminalTabID? {
    tabManager.selectedTabId
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return tabManager.tabs.first(where: { $0.id == selectedTabID })
  }

  var selectedTree: SplitTree<GhosttySurfaceView>? {
    guard let selectedTabID else { return nil }
    return splitTree(for: selectedTabID)
  }

  var selectedSurfaceView: GhosttySurfaceView? {
    guard
      let selectedTabID,
      let focusedSurfaceID = focusedSurfaceIDByTab[selectedTabID]
    else {
      return nil
    }
    return surfaces[focusedSurfaceID]
  }

  var selectedSurfaceState: GhosttySurfaceState? {
    selectedSurfaceView?.bridge.state
  }

  func ensureInitialTab(focusing: Bool) {
    guard tabManager.tabs.isEmpty else { return }
    _ = createTab(focusing: focusing)
  }

  func setColorScheme(_ scheme: ColorScheme) {
    runtime.setColorScheme(scheme)
  }

  @discardableResult
  func createTab(
    focusing: Bool = true,
    initialInput: String? = nil,
    inheritingFromSurfaceID: UUID? = nil
  ) -> TerminalTabID? {
    let context: ghostty_surface_context_e =
      tabManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let tabID = tabManager.createTab(
      title: "Terminal \(nextTabIndex())",
      icon: "terminal"
    )
    let tree = splitTree(
      for: tabID,
      inheritingFromSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      initialInput: initialInput,
      context: context
    )
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusing, let surface = tree.root?.leftmostLeaf() {
      focusSurface(surface, in: tabID)
    }
    syncFocus(windowActivity)
    return tabID
  }

  func selectTab(_ tabID: TerminalTabID) {
    tabManager.selectTab(tabID)
    focusSurface(in: tabID)
    syncFocus(windowActivity)
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
    guard let lastTabID = visibleTabs.last?.id else { return }
    selectTab(lastTabID)
  }

  func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    tabManager.setPinnedTabOrder(orderedIDs)
  }

  func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    tabManager.setRegularTabOrder(orderedIDs)
  }

  func togglePinned(_ tabID: TerminalTabID) {
    tabManager.togglePinned(tabID)
  }

  func closeSurface(_ surfaceID: UUID) {
    performCloseSurface(surfaceID)
  }

  func closeTab(_ tabID: TerminalTabID) {
    performCloseTab(tabID)
  }

  @discardableResult
  func closeFocusedSurface() -> Bool {
    performBindingActionOnFocusedSurface("close_surface")
  }

  @discardableResult
  func splitBelow() -> Bool {
    performBindingActionOnFocusedSurface("new_split:down")
  }

  @discardableResult
  func splitRight() -> Bool {
    performBindingActionOnFocusedSurface("new_split:right")
  }

  @discardableResult
  func equalizePanes() -> Bool {
    performBindingActionOnFocusedSurface("equalize_splits")
  }

  @discardableResult
  func togglePaneZoom() -> Bool {
    performBindingActionOnFocusedSurface("toggle_split_zoom")
  }

  @discardableResult
  func startSearch() -> Bool {
    performBindingActionOnFocusedSurface("start_search")
  }

  @discardableResult
  func endSearch() -> Bool {
    performBindingActionOnFocusedSurface("end_search")
  }

  @discardableResult
  func searchSelection() -> Bool {
    performBindingActionOnFocusedSurface("search_selection")
  }

  @discardableResult
  func navigateSearchOnFocusedSurface(_ direction: GhosttySearchDirection) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.navigateSearch(direction)
    return true
  }

  @discardableResult
  func navigateSearchNext() -> Bool {
    navigateSearchOnFocusedSurface(.next)
  }

  @discardableResult
  func navigateSearchPrevious() -> Bool {
    navigateSearchOnFocusedSurface(.previous)
  }

  @discardableResult
  func performBindingActionOnFocusedSurface(_ action: String) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.performBindingAction(action)
    return true
  }

  func updateWindowActivity(_ activity: WindowActivityState) {
    windowActivity = activity
    syncFocus(activity)
  }

  func syncFocus(_ activity: WindowActivityState) {
    let selectedTabID = tabManager.selectedTabId
    var surfaceToFocus: GhosttySurfaceView?

    for (tabID, tree) in trees {
      let focusedSurfaceID = focusedSurfaceIDByTab[tabID]
      let isSelectedTab = tabID == selectedTabID
      for surface in tree.leaves() {
        let activity = Self.surfaceActivity(
          isSelectedTab: isSelectedTab,
          windowIsVisible: activity.isVisible,
          windowIsKey: activity.isKeyWindow,
          focusedSurfaceID: focusedSurfaceID,
          surfaceID: surface.id
        )
        surface.setOcclusion(activity.isVisible)
        surface.focusDidChange(activity.isFocused)
        if activity.isFocused {
          surfaceToFocus = surface
        }
      }
    }

    if let surfaceToFocus, surfaceToFocus.window?.firstResponder is GhosttySurfaceView {
      surfaceToFocus.window?.makeFirstResponder(surfaceToFocus)
    }
  }

  func syncFocus(windowIsKey: Bool, windowIsVisible: Bool) {
    syncFocus(.init(isKeyWindow: windowIsKey, isVisible: windowIsVisible))
  }

  func treeSnapshot() -> SupatermTreeSnapshot {
    let tabs = tabManager.tabs.enumerated().map { tabOffset, tab in
      let focusedSurfaceID = focusedSurfaceIDByTab[tab.id]
      let panes = (trees[tab.id]?.leaves() ?? []).enumerated().map { paneOffset, pane in
        SupatermTreeSnapshot.Pane(
          index: paneOffset + 1,
          isFocused: pane.id == focusedSurfaceID
        )
      }

      return SupatermTreeSnapshot.Tab(
        index: tabOffset + 1,
        title: tab.title,
        isSelected: tab.id == tabManager.selectedTabId,
        panes: panes
      )
    }

    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: windowActivity.isKeyWindow,
      tabs: tabs
    )
    return SupatermTreeSnapshot(windows: [window])
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    let resolvedTarget = try resolveCreatePaneTarget(request.target)
    let newSurface = createSurface(
      tabID: resolvedTarget.tabID,
      initialInput: request.command.map { "\($0)\n" },
      inheritingFromSurfaceID: resolvedTarget.anchorSurface.id,
      context: GHOSTTY_SURFACE_CONTEXT_SPLIT
    )

    do {
      let newTree = try resolvedTarget.tree.inserting(
        view: newSurface,
        at: resolvedTarget.anchorSurface,
        direction: mapPaneDirection(request.direction)
      )
      trees[resolvedTarget.tabID] = newTree
      updateRunningState(for: resolvedTarget.tabID)

      let nextSelectedTabID = Self.selectedTabID(
        afterCreatingPaneIn: resolvedTarget.tabID,
        focusRequested: request.focus,
        currentSelectedTabID: tabManager.selectedTabId
      )
      if let nextSelectedTabID, nextSelectedTabID != tabManager.selectedTabId {
        tabManager.selectTab(nextSelectedTabID)
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus(windowActivity)

      guard
        let tabIndex = tabManager.tabs.firstIndex(where: { $0.id == resolvedTarget.tabID }),
        let paneIndex = newTree.leaves().firstIndex(where: { $0.id == newSurface.id })
      else {
        throw TerminalCreatePaneError.creationFailed
      }
      let selectionState = Self.newPaneSelectionState(
        selectedTabID: tabManager.selectedTabId,
        targetTabID: resolvedTarget.tabID,
        windowActivity: windowActivity,
        focusedSurfaceID: focusedSurfaceIDByTab[resolvedTarget.tabID],
        surfaceID: newSurface.id
      )

      return SupatermNewPaneResult(
        direction: request.direction,
        isFocused: selectionState.isFocused,
        isSelectedTab: selectionState.isSelectedTab,
        paneIndex: paneIndex + 1,
        tabIndex: tabIndex + 1,
        windowIndex: 1
      )
    } catch let error as TerminalCreatePaneError {
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw error
    } catch {
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      throw TerminalCreatePaneError.creationFailed
    }
  }

  func splitTree(
    for tabID: TerminalTabID,
    inheritingFromSurfaceID: UUID? = nil,
    initialInput: String? = nil,
    context: ghostty_surface_context_e = GHOSTTY_SURFACE_CONTEXT_TAB
  ) -> SplitTree<GhosttySurfaceView> {
    if let existing = trees[tabID] {
      return existing
    }
    let surface = createSurface(
      tabID: tabID,
      initialInput: initialInput,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      context: context
    )
    let tree = SplitTree(view: surface)
    trees[tabID] = tree
    focusedSurfaceIDByTab[tabID] = surface.id
    return tree
  }

  func performSplitAction(_ action: GhosttySplitAction, for surfaceID: UUID) -> Bool {
    guard let tabID = tabID(containing: surfaceID), var tree = trees[tabID] else {
      return false
    }
    guard let targetNode = tree.find(id: surfaceID) else { return false }
    guard let targetSurface = surfaces[surfaceID] else { return false }

    switch action {
    case .newSplit(let direction):
      let newSurface = createSurface(
        tabID: tabID,
        initialInput: nil,
        inheritingFromSurfaceID: surfaceID,
        context: GHOSTTY_SURFACE_CONTEXT_SPLIT
      )
      do {
        let newTree = try tree.inserting(
          view: newSurface,
          at: targetSurface,
          direction: mapSplitDirection(direction)
        )
        trees[tabID] = newTree
        focusSurface(newSurface, in: tabID)
        return true
      } catch {
        newSurface.closeSurface()
        surfaces.removeValue(forKey: newSurface.id)
        return false
      }

    case .gotoSplit(let direction):
      let focusDirection = mapFocusDirection(direction)
      guard let nextSurface = tree.focusTarget(for: focusDirection, from: targetNode) else {
        return false
      }
      if tree.zoomed != nil {
        tree = tree.settingZoomed(nil)
        trees[tabID] = tree
      }
      focusSurface(nextSurface, in: tabID)
      return true

    case .resizeSplit(let direction, let amount):
      let spatialDirection = mapResizeDirection(direction)
      do {
        let newTree = try tree.resizing(
          node: targetNode,
          by: amount,
          in: spatialDirection,
          with: CGRect(origin: .zero, size: tree.viewBounds())
        )
        trees[tabID] = newTree
        return true
      } catch {
        return false
      }

    case .equalizeSplits:
      trees[tabID] = tree.equalized()
      return true

    case .toggleSplitZoom:
      guard tree.isSplit else { return false }
      let newZoomed = tree.zoomed == targetNode ? nil : targetNode
      trees[tabID] = tree.settingZoomed(newZoomed)
      return true
    }
  }

  func performSplitOperation(_ operation: TerminalSplitTreeView.Operation, in tabID: TerminalTabID) {
    guard var tree = trees[tabID] else { return }

    switch operation {
    case .resize(let node, let ratio):
      let resizedNode = node.resizing(to: ratio)
      do {
        tree = try tree.replacing(node: node, with: resizedNode)
        trees[tabID] = tree
      } catch {
        return
      }

    case .drop(let payloadID, let destinationID, let zone):
      guard let payload = surfaces[payloadID] else { return }
      guard let destination = surfaces[destinationID] else { return }
      if payload === destination { return }
      guard let sourceNode = tree.root?.node(view: payload) else { return }
      let treeWithoutSource = tree.removing(sourceNode)
      if treeWithoutSource.isEmpty { return }
      do {
        let newTree = try treeWithoutSource.inserting(
          view: payload,
          at: destination,
          direction: mapDropZone(zone)
        )
        trees[tabID] = newTree
        focusSurface(payload, in: tabID)
      } catch {
        return
      }

    case .equalize:
      trees[tabID] = tree.equalized()
    }
  }

  func focusedSurfaceState(for tabID: TerminalTabID) -> GhosttySurfaceState? {
    guard
      let focusedSurfaceID = focusedSurfaceIDByTab[tabID],
      let surface = surfaces[focusedSurfaceID]
    else {
      return nil
    }
    return surface.bridge.state
  }

  func closeAllSurfaces() {
    for surface in surfaces.values {
      surface.closeSurface()
    }
    surfaces.removeAll()
    trees.removeAll()
    focusedSurfaceIDByTab.removeAll()
    tabManager.closeAll()
  }

  static func surfaceActivity(
    isSelectedTab: Bool,
    windowIsVisible: Bool,
    windowIsKey: Bool,
    focusedSurfaceID: UUID?,
    surfaceID: UUID
  ) -> SurfaceActivity {
    let isVisible = isSelectedTab && windowIsVisible
    let isFocused = isVisible && windowIsKey && focusedSurfaceID == surfaceID
    return SurfaceActivity(isVisible: isVisible, isFocused: isFocused)
  }

  func indicators(for tabID: TerminalTabID) -> TabIndicators {
    guard
      let focusedSurfaceID = focusedSurfaceIDByTab[tabID],
      let surface = surfaces[focusedSurfaceID]
    else {
      return TabIndicators(
        isRunning: tabManager.tabs.first(where: { $0.id == tabID })?.isDirty ?? false
      )
    }

    return TabIndicators(
      isRunning: tabManager.tabs.first(where: { $0.id == tabID })?.isDirty ?? false,
      hasBell: surface.bridge.state.bellCount > 0,
      isReadOnly: surface.bridge.state.readOnly == GHOSTTY_READONLY_ON,
      hasSecureInput: surface.bridge.state.secureInput == GHOSTTY_SECURE_INPUT_ON
    )
  }

  private func performCloseTab(_ tabID: TerminalTabID) {
    guard tabManager.tabs.contains(where: { $0.id == tabID }) else { return }

    let shouldCreateReplacement = tabManager.tabs.count == 1
    let inheritedSurfaceID = focusedSurfaceIDByTab[tabID]
    if shouldCreateReplacement {
      _ = createTab(
        focusing: false,
        inheritingFromSurfaceID: inheritedSurfaceID
      )
    }

    removeTree(for: tabID)
    tabManager.closeTab(tabID)

    if let selectedTabID = tabManager.selectedTabId {
      focusSurface(in: selectedTabID)
    } else {
      lastEmittedFocusSurfaceID = nil
    }

    syncFocus(windowActivity)
  }

  private func performCloseSurface(_ surfaceID: UUID) {
    guard let tabID = tabID(containing: surfaceID), let tree = trees[tabID] else { return }
    guard let node = tree.find(id: surfaceID), let surface = surfaces[surfaceID] else { return }

    let nextSurface =
      focusedSurfaceIDByTab[tabID] == surfaceID
      ? tree.focusTargetAfterClosing(node)
      : nil
    let newTree = tree.removing(node)
    surface.closeSurface()
    surfaces.removeValue(forKey: surfaceID)

    if newTree.isEmpty {
      trees.removeValue(forKey: tabID)
      focusedSurfaceIDByTab.removeValue(forKey: tabID)
      tabManager.closeTab(tabID)
      if tabManager.tabs.isEmpty {
        _ = createTab(focusing: false)
      } else if let selectedTabID = tabManager.selectedTabId {
        focusSurface(in: selectedTabID)
      }
      syncFocus(windowActivity)
      return
    }

    trees[tabID] = newTree
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusedSurfaceIDByTab[tabID] == surfaceID {
      if let nextSurface {
        focusSurface(nextSurface, in: tabID)
      } else {
        focusedSurfaceIDByTab.removeValue(forKey: tabID)
      }
    }
    syncFocus(windowActivity)
  }

  private func createSurface(
    tabID: TerminalTabID,
    initialInput: String?,
    inheritingFromSurfaceID: UUID?,
    context: ghostty_surface_context_e
  ) -> GhosttySurfaceView {
    let inherited = inheritedSurfaceConfig(fromSurfaceID: inheritingFromSurfaceID, context: context)
    let view = GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: inherited.workingDirectory,
      initialInput: initialInput,
      fontSize: inherited.fontSize,
      context: context,
      managesWindowAppearance: false
    )
    view.bridge.onTitleChange = { [weak self] _ in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
    }
    view.bridge.onPathChange = { [weak self] in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
    }
    view.bridge.onSplitAction = { [weak self, weak view] action in
      guard let self, let view else { return false }
      return self.performSplitAction(action, for: view.id)
    }
    view.bridge.onNewTab = { [weak self, weak view] in
      guard let self else { return false }
      self.emit(.newTabRequested(inheritingFromSurfaceID: view?.id))
      return true
    }
    view.bridge.onCloseTab = { [weak self] _ in
      guard let self else { return false }
      self.emit(.closeTabRequested(tabID))
      return true
    }
    view.bridge.onGotoTab = { [weak self] target in
      guard let self else { return false }
      guard let mappedTarget = self.mapGotoTabTarget(target) else { return false }
      self.emit(.gotoTabRequested(mappedTarget))
      return true
    }
    view.bridge.onProgressReport = { [weak self] _ in
      guard let self else { return }
      self.updateRunningState(for: tabID)
    }
    view.bridge.onCloseRequest = { [weak self, weak view] processAlive in
      guard let self, let view else { return }
      self.emit(.closeSurfaceRequested(surfaceID: view.id, processAlive: processAlive))
    }
    view.onFocusChange = { [weak self, weak view] focused in
      guard let self, let view, focused else { return }
      self.focusedSurfaceIDByTab[tabID] = view.id
      self.updateTabTitle(for: tabID)
      self.updateRunningState(for: tabID)
      self.emitFocusChangedIfNeeded(view.id)
    }
    surfaces[view.id] = view
    return view
  }

  private struct InheritedSurfaceConfig: Equatable {
    let workingDirectory: URL?
    let fontSize: Float32?
  }

  private func inheritedSurfaceConfig(
    fromSurfaceID surfaceID: UUID?,
    context: ghostty_surface_context_e
  ) -> InheritedSurfaceConfig {
    guard let surfaceID, let view = surfaces[surfaceID], let sourceSurface = view.surface else {
      return InheritedSurfaceConfig(workingDirectory: nil, fontSize: nil)
    }

    let inherited = ghostty_surface_inherited_config(sourceSurface, context)
    let fontSize = inherited.font_size == 0 ? nil : inherited.font_size
    let workingDirectory = inherited.working_directory.flatMap { ptr -> URL? in
      let path = String(cString: ptr)
      guard !path.isEmpty else { return nil }
      return URL(fileURLWithPath: path, isDirectory: true)
    }

    return InheritedSurfaceConfig(
      workingDirectory: workingDirectory,
      fontSize: fontSize
    )
  }

  private func currentFocusedSurfaceID() -> UUID? {
    guard let selectedTabID = tabManager.selectedTabId else { return nil }
    return focusedSurfaceIDByTab[selectedTabID]
  }

  private struct ResolvedCreatePaneTarget {
    let anchorSurface: GhosttySurfaceView
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  private func resolveCreatePaneTarget(
    _ target: TerminalCreatePaneRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let paneID):
      guard
        let tabID = tabID(containing: paneID),
        let tree = trees[tabID],
        let anchorSurface = surfaces[paneID]
      else {
        throw TerminalCreatePaneError.contextPaneNotFound
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        tabID: tabID,
        tree: tree
      )

    case .pane(let windowIndex, let tabIndex, let paneIndex):
      let resolvedTab = try resolveTab(windowIndex: windowIndex, tabIndex: tabIndex)
      let panes = resolvedTab.tree.leaves()
      let paneOffset = paneIndex - 1
      guard panes.indices.contains(paneOffset) else {
        throw TerminalCreatePaneError.paneNotFound(
          windowIndex: windowIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: panes[paneOffset],
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
      )

    case .tab(let windowIndex, let tabIndex):
      let resolvedTab = try resolveTab(windowIndex: windowIndex, tabIndex: tabIndex)
      let anchorSurface =
        focusedSurfaceIDByTab[resolvedTab.tabID].flatMap { surfaces[$0] }
        ?? resolvedTab.tree.root?.leftmostLeaf()
      guard let anchorSurface else {
        throw TerminalCreatePaneError.creationFailed
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
      )
    }
  }

  private func resolveTab(
    windowIndex: Int,
    tabIndex: Int
  ) throws -> (tabID: TerminalTabID, tree: SplitTree<GhosttySurfaceView>) {
    guard windowIndex == 1 else {
      throw TerminalCreatePaneError.windowNotFound(windowIndex)
    }

    let tabOffset = tabIndex - 1
    guard tabManager.tabs.indices.contains(tabOffset) else {
      throw TerminalCreatePaneError.tabNotFound(
        windowIndex: windowIndex,
        tabIndex: tabIndex
      )
    }

    let tabID = tabManager.tabs[tabOffset].id
    guard let tree = trees[tabID] else {
      throw TerminalCreatePaneError.creationFailed
    }

    return (tabID, tree)
  }

  private func updateTabTitle(for tabID: TerminalTabID) {
    guard
      let focusedSurfaceID = focusedSurfaceIDByTab[tabID],
      let surface = surfaces[focusedSurfaceID]
    else {
      return
    }

    let resolvedTitle = surface.resolvedDisplayTitle(defaultValue: fallbackTitle(for: tabID))
    tabManager.updateTitle(tabID, title: resolvedTitle)
  }

  private func focusSurface(in tabID: TerminalTabID) {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID], let surface = surfaces[focusedSurfaceID] {
      focusSurface(surface, in: tabID)
      return
    }
    let tree = splitTree(for: tabID)
    if let surface = tree.root?.leftmostLeaf() {
      focusSurface(surface, in: tabID)
    }
  }

  private func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
    let previousSurface = focusedSurfaceIDByTab[tabID].flatMap { surfaces[$0] }
    focusedSurfaceIDByTab[tabID] = surface.id
    updateTabTitle(for: tabID)
    guard tabID == tabManager.selectedTabId else { return }
    let fromSurface = previousSurface === surface ? nil : previousSurface
    GhosttySurfaceView.moveFocus(to: surface, from: fromSurface)
    emitFocusChangedIfNeeded(surface.id)
  }

  static func selectedTabID(
    afterCreatingPaneIn targetTabID: TerminalTabID,
    focusRequested: Bool,
    currentSelectedTabID: TerminalTabID?
  ) -> TerminalTabID? {
    guard focusRequested else { return currentSelectedTabID }
    return targetTabID
  }

  static func newPaneSelectionState(
    selectedTabID: TerminalTabID?,
    targetTabID: TerminalTabID,
    windowActivity: WindowActivityState,
    focusedSurfaceID: UUID?,
    surfaceID: UUID
  ) -> NewPaneSelectionState {
    let isSelectedTab = targetTabID == selectedTabID
    let activity = surfaceActivity(
      isSelectedTab: isSelectedTab,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusedSurfaceID,
      surfaceID: surfaceID
    )
    return NewPaneSelectionState(isFocused: activity.isFocused, isSelectedTab: isSelectedTab)
  }

  private func removeTree(for tabID: TerminalTabID) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    for surface in tree.leaves() {
      surface.closeSurface()
      surfaces.removeValue(forKey: surface.id)
    }
    focusedSurfaceIDByTab.removeValue(forKey: tabID)
  }

  private func updateRunningState(for tabID: TerminalTabID) {
    guard let tree = trees[tabID] else { return }
    let isRunning = tree.leaves().contains { surface in
      switch surface.bridge.state.progressState {
      case .some(GHOSTTY_PROGRESS_STATE_SET),
        .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE),
        .some(GHOSTTY_PROGRESS_STATE_PAUSE),
        .some(GHOSTTY_PROGRESS_STATE_ERROR):
        return true
      default:
        return false
      }
    }
    tabManager.updateDirty(tabID, isDirty: isRunning)
  }

  func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains(where: \.needsCloseConfirmation)
  }

  private func tabID(containing surfaceID: UUID) -> TerminalTabID? {
    for (tabID, tree) in trees where tree.find(id: surfaceID) != nil {
      return tabID
    }
    return nil
  }

  private func emitFocusChangedIfNeeded(_ surfaceID: UUID) {
    guard surfaceID != lastEmittedFocusSurfaceID else { return }
    lastEmittedFocusSurfaceID = surfaceID
  }

  private func emit(_ event: TerminalClient.Event) {
    guard let eventContinuation else {
      pendingEvents.append(event)
      return
    }
    eventContinuation.yield(event)
  }

  private func mapGotoTabTarget(_ target: ghostty_action_goto_tab_e) -> TerminalGotoTabTarget? {
    let raw = Int(target.rawValue)
    if raw <= 0 {
      switch raw {
      case Int(GHOSTTY_GOTO_TAB_PREVIOUS.rawValue):
        return .previous
      case Int(GHOSTTY_GOTO_TAB_NEXT.rawValue):
        return .next
      case Int(GHOSTTY_GOTO_TAB_LAST.rawValue):
        return .last
      default:
        return nil
      }
    }
    return .index(raw)
  }

  private func nextTabIndex() -> Int {
    var maxIndex = 0
    for tab in tabManager.tabs {
      guard tab.title.hasPrefix("Terminal ") else { continue }
      let suffix = tab.title.dropFirst("Terminal ".count)
      guard let value = Int(suffix) else { continue }
      maxIndex = max(maxIndex, value)
    }
    return maxIndex + 1
  }

  private func fallbackTitle(for tabID: TerminalTabID) -> String {
    tabManager.tabs.first(where: { $0.id == tabID })?.title ?? "Terminal"
  }

  private func mapSplitDirection(_ direction: GhosttySplitAction.NewDirection)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .top:
      return .top
    case .down:
      return .down
    }
  }

  private func mapPaneDirection(_ direction: SupatermPaneDirection)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch direction {
    case .down:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .top
    }
  }

  private func mapFocusDirection(_ direction: GhosttySplitAction.FocusDirection)
    -> SplitTree<GhosttySurfaceView>.FocusDirection
  {
    switch direction {
    case .previous:
      return .previous
    case .next:
      return .next
    case .left:
      return .spatial(.left)
    case .right:
      return .spatial(.right)
    case .top:
      return .spatial(.top)
    case .down:
      return .spatial(.down)
    }
  }

  private func mapResizeDirection(_ direction: GhosttySplitAction.ResizeDirection)
    -> SplitTree<GhosttySurfaceView>.SpatialDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .top:
      return .top
    case .down:
      return .down
    }
  }

  private func mapDropZone(_ zone: TerminalSplitTreeView.DropZone)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch zone {
    case .top:
      return .top
    case .bottom:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    }
  }
}

extension GhosttySurfaceView {
  fileprivate var needsCloseConfirmation: Bool {
    guard let surface else { return false }
    return ghostty_surface_needs_confirm_quit(surface)
  }

  fileprivate func resolvedDisplayTitle(defaultValue: String) -> String {
    let title = bridge.state.title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !title.isEmpty {
      return title
    }
    let pwd = bridge.state.pwd?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    if !pwd.isEmpty {
      return pwd
    }
    return defaultValue
  }
}
