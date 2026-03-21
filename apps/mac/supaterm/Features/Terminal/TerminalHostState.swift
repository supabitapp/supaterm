import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
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
  private let runtime: GhosttyRuntime?
  @ObservationIgnored
  private let managesTerminalSurfaces: Bool
  @ObservationIgnored
  private var eventContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  @ObservationIgnored
  @Shared(.terminalWorkspaceCatalog)
  private var workspaceCatalog = TerminalWorkspaceCatalog.default
  @ObservationIgnored
  private var workspaceCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  private var lastAppliedWorkspaceCatalog = TerminalWorkspaceCatalog.default
  let workspaceManager = TerminalWorkspaceManager()

  private var pendingEvents: [TerminalClient.Event] = []
  private var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  private var surfaces: [UUID: GhosttySurfaceView] = [:]
  private var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var lastEmittedFocusSurfaceID: UUID?

  var windowActivity = WindowActivityState.inactive

  init(
    runtime: GhosttyRuntime? = nil,
    managesTerminalSurfaces: Bool = true
  ) {
    self.managesTerminalSurfaces = managesTerminalSurfaces
    self.runtime = managesTerminalSurfaces ? (runtime ?? GhosttyRuntime()) : runtime

    let initialWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    if initialWorkspaceCatalog != workspaceCatalog {
      replaceWorkspaceCatalog(initialWorkspaceCatalog)
    }
    lastAppliedWorkspaceCatalog = initialWorkspaceCatalog
    workspaceManager.bootstrap(
      from: initialWorkspaceCatalog,
      initialSelectedWorkspaceID: initialWorkspaceCatalog.defaultSelectedWorkspaceID
    )
    observeWorkspaceCatalog()
  }

  deinit {
    workspaceCatalogObservationTask?.cancel()
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
    case .createWorkspace:
      createWorkspace()
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
    case .requestCloseSurface(let surfaceID):
      requestCloseSurface(surfaceID)
    case .requestCloseTab(let tabID):
      requestCloseTab(tabID)
    case .renameWorkspace(let workspaceID, let name):
      renameWorkspace(workspaceID, to: name)
    case .selectLastTab,
      .selectTab,
      .selectTabSlot,
      .selectWorkspaceSlot,
      .selectWorkspace,
      .setPinnedTabOrder,
      .setRegularTabOrder,
      .togglePinned,
      .updateWindowActivity,
      .deleteWorkspace:
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
    case .selectWorkspaceSlot(let slot):
      selectWorkspace(slot: slot)
    case .selectWorkspace(let workspaceID):
      selectWorkspace(workspaceID)
    case .setPinnedTabOrder(let orderedIDs):
      setPinnedTabOrder(orderedIDs)
    case .setRegularTabOrder(let orderedIDs):
      setRegularTabOrder(orderedIDs)
    case .togglePinned(let tabID):
      togglePinned(tabID)
    case .deleteWorkspace(let workspaceID):
      deleteWorkspace(workspaceID)
    case .updateWindowActivity(let activity):
      updateWindowActivity(activity)
    default:
      return
    }
  }

  var workspaces: [TerminalWorkspaceItem] {
    workspaceManager.workspaces
  }

  var selectedWorkspaceID: TerminalWorkspaceID? {
    workspaceManager.selectedWorkspaceID
  }

  var tabs: [TerminalTabItem] {
    workspaceManager.tabs
  }

  var pinnedTabs: [TerminalTabItem] {
    workspaceManager.pinnedTabs
  }

  var regularTabs: [TerminalTabItem] {
    workspaceManager.regularTabs
  }

  var visibleTabs: [TerminalTabItem] {
    workspaceManager.visibleTabs
  }

  var selectedTabID: TerminalTabID? {
    workspaceManager.selectedTabID
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return workspaceManager.tab(for: selectedTabID)
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

  private func ensureInitialTab(focusing: Bool) {
    guard tabs.isEmpty else { return }
    _ = createTab(focusing: focusing)
  }

  @discardableResult
  private func createTab(
    focusing: Bool = true,
    initialInput: String? = nil,
    inheritingFromSurfaceID: UUID? = nil
  ) -> TerminalTabID? {
    guard let activeTabManager = workspaceManager.activeTabManager else { return nil }
    let context: ghostty_surface_context_e =
      activeTabManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let tabID = activeTabManager.createTab(
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

  private func selectTab(_ tabID: TerminalTabID) {
    guard let workspace = workspaceManager.workspace(for: tabID) else { return }
    let didChangeWorkspace = workspaceManager.selectedWorkspaceID != workspace.id
    guard workspaceManager.selectWorkspace(workspace.id) else { return }
    if didChangeWorkspace {
      persistDefaultSelectedWorkspaceID(workspace.id)
    }
    workspaceManager.tabManager(for: workspace.id)?.selectTab(tabID)
    focusSurface(in: tabID)
    syncFocus(windowActivity)
  }

  private func selectTab(slot: Int) {
    let index = slot - 1
    guard visibleTabs.indices.contains(index) else { return }
    selectTab(visibleTabs[index].id)
  }

  private func nextTab() {
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

  private func previousTab() {
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

  private func selectLastTab() {
    guard let lastTabID = visibleTabs.last?.id else { return }
    selectTab(lastTabID)
  }

  private func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    workspaceManager.activeTabManager?.setPinnedTabOrder(orderedIDs)
  }

  private func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    workspaceManager.activeTabManager?.setRegularTabOrder(orderedIDs)
  }

  private func togglePinned(_ tabID: TerminalTabID) {
    workspaceManager.workspace(for: tabID).flatMap { workspaceManager.tabManager(for: $0.id) }?.togglePinned(tabID)
  }

  private func createWorkspace() {
    let workspace = PersistedTerminalWorkspace(name: workspaceManager.nextDefaultWorkspaceName())
    var updatedWorkspaceCatalog = workspaceCatalog
    updatedWorkspaceCatalog.defaultSelectedWorkspaceID = workspace.id
    updatedWorkspaceCatalog = TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: updatedWorkspaceCatalog.defaultSelectedWorkspaceID,
      workspaces: updatedWorkspaceCatalog.workspaces + [workspace]
    )
    _ = writeWorkspaceCatalog(updatedWorkspaceCatalog)
    guard workspaceManager.selectWorkspace(workspace.id) else { return }
    finalizeWorkspaceSelectionChange()
  }

  private func selectWorkspace(_ workspaceID: TerminalWorkspaceID) {
    selectWorkspace(workspaceID, persistDefaultSelection: true)
  }

  private func selectWorkspace(
    _ workspaceID: TerminalWorkspaceID,
    persistDefaultSelection: Bool
  ) {
    guard workspaceManager.selectWorkspace(workspaceID) else { return }
    if persistDefaultSelection {
      persistDefaultSelectedWorkspaceID(workspaceID)
    }
    finalizeWorkspaceSelectionChange()
  }

  private func selectWorkspace(slot: Int) {
    let index = slot == 0 ? 9 : slot - 1
    guard workspaces.indices.contains(index) else { return }
    selectWorkspace(workspaces[index].id)
  }

  private func renameWorkspace(_ workspaceID: TerminalWorkspaceID, to name: String) {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedName.isEmpty else { return }
    guard workspaceManager.isNameAvailable(normalizedName, excluding: workspaceID) else { return }
    guard let index = workspaceCatalog.workspaces.firstIndex(where: { $0.id == workspaceID }) else { return }

    var updatedWorkspaceCatalog = workspaceCatalog
    updatedWorkspaceCatalog.workspaces[index].name = normalizedName
    _ = writeWorkspaceCatalog(updatedWorkspaceCatalog)
  }

  private func deleteWorkspace(_ workspaceID: TerminalWorkspaceID) {
    let remainingWorkspaces = workspaceCatalog.workspaces.filter { $0.id != workspaceID }
    guard !remainingWorkspaces.isEmpty else { return }
    guard remainingWorkspaces.count != workspaceCatalog.workspaces.count else { return }

    let nextSelectedWorkspaceID = nextSelectedWorkspaceID(afterDeleting: workspaceID)
    let updatedWorkspaceCatalog = TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: nextSelectedWorkspaceID,
      workspaces: remainingWorkspaces
    )
    _ = writeWorkspaceCatalog(updatedWorkspaceCatalog)
    finalizeWorkspaceSelectionChange()
  }

  func isWorkspaceNameAvailable(
    _ proposedName: String,
    excluding excludedWorkspaceID: TerminalWorkspaceID? = nil
  ) -> Bool {
    workspaceManager.isNameAvailable(proposedName, excluding: excludedWorkspaceID)
  }

  private func closeSurface(_ surfaceID: UUID) {
    performCloseSurface(surfaceID)
  }

  private func closeTab(_ tabID: TerminalTabID) {
    performCloseTab(tabID)
  }

  private func requestCloseSurface(_ surfaceID: UUID, needsConfirmation: Bool? = nil) {
    guard surfaces[surfaceID] != nil else { return }
    emit(
      .closeRequested(
        .init(
          target: .surface(surfaceID),
          needsConfirmation: needsConfirmation ?? surfaceNeedsCloseConfirmation(surfaceID)
        )
      )
    )
  }

  private func requestCloseTab(_ tabID: TerminalTabID) {
    guard trees[tabID] != nil else { return }
    emit(
      .closeRequested(
        .init(
          target: .tab(tabID),
          needsConfirmation: tabNeedsCloseConfirmation(tabID)
        )
      )
    )
  }

  @discardableResult
  private func navigateSearchOnFocusedSurface(_ direction: GhosttySearchDirection) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.navigateSearch(direction)
    return true
  }

  @discardableResult
  private func performBindingActionOnFocusedSurface(_ action: String) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.performBindingAction(action)
    return true
  }

  private func updateWindowActivity(_ activity: WindowActivityState) {
    windowActivity = activity
    syncFocus(activity)
  }

  private func syncFocus(_ activity: WindowActivityState) {
    let selectedTabID = workspaceManager.selectedTabID
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

  func treeSnapshot() -> SupatermTreeSnapshot {
    let window = SupatermTreeSnapshot.Window(
      index: 1,
      isKey: windowActivity.isKeyWindow,
      workspaces: workspaces.enumerated().map { workspaceOffset, workspace in
        let tabs = workspaceManager.tabs(in: workspace.id).enumerated().map { tabOffset, tab in
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
            isSelected: tab.id == workspaceManager.selectedTabID(in: workspace.id),
            panes: panes
          )
        }

        return SupatermTreeSnapshot.Workspace(
          index: workspaceOffset + 1,
          name: workspace.name,
          isSelected: workspace.id == selectedWorkspaceID,
          tabs: tabs
        )
      }
    )
    return SupatermTreeSnapshot(windows: [window])
  }

  func debugWindowSnapshot(index: Int) -> SupatermAppDebugSnapshot.Window {
    .init(
      index: index,
      isKey: windowActivity.isKeyWindow,
      isVisible: windowActivity.isVisible,
      workspaces: workspaces.enumerated().map { workspaceOffset, workspace in
        let tabs = workspaceManager.tabs(in: workspace.id).enumerated().map { tabOffset, tab in
          let focusedSurfaceID = focusedSurfaceIDByTab[tab.id]
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
            isSelected: tab.id == workspaceManager.selectedTabID(in: workspace.id),
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

        return SupatermAppDebugSnapshot.Workspace(
          index: workspaceOffset + 1,
          id: workspace.id.rawValue,
          name: workspace.name,
          isSelected: workspace.id == selectedWorkspaceID,
          tabs: tabs
        )
      }
    )
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
        currentSelectedTabID: workspaceManager.selectedTabID
      )
      if let nextSelectedTabID, nextSelectedTabID != workspaceManager.selectedTabID {
        if let workspace = workspaceManager.workspace(for: nextSelectedTabID) {
          _ = workspaceManager.selectWorkspace(workspace.id)
          workspaceManager.tabManager(for: workspace.id)?.selectTab(nextSelectedTabID)
        }
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus(windowActivity)

      guard
        let workspace = workspaceManager.workspace(for: resolvedTarget.tabID),
        let tabIndex = workspaceManager.tabs(in: workspace.id).firstIndex(where: { $0.id == resolvedTarget.tabID }),
        let paneIndex = newTree.leaves().firstIndex(where: { $0.id == newSurface.id })
      else {
        throw TerminalCreatePaneError.creationFailed
      }
      let selectionState = Self.newPaneSelectionState(
        selectedTabID: workspaceManager.selectedTabID,
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

  private func performSplitAction(_ action: GhosttySplitAction, for surfaceID: UUID) -> Bool {
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

  private func performSplitOperation(_ operation: TerminalSplitTreeView.Operation, in tabID: TerminalTabID) {
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

  private func performCloseTab(_ tabID: TerminalTabID) {
    guard let workspace = workspaceManager.workspace(for: tabID) else { return }
    guard let tabManager = workspaceManager.tabManager(for: workspace.id) else { return }

    let shouldCreateReplacement = tabManager.tabs.count == 1
    let inheritedSurfaceID = focusedSurfaceIDByTab[tabID]
    if shouldCreateReplacement {
      _ = workspaceManager.selectWorkspace(workspace.id)
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
      workspaceManager.workspace(for: tabID)
        .flatMap { workspaceManager.tabManager(for: $0.id) }?
        .closeTab(tabID)
      if tabs.isEmpty {
        _ = createTab(focusing: false)
      } else if let selectedTabID = selectedTabID {
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
    guard let runtime else {
      preconditionFailure("TerminalHostState cannot create surfaces without a GhosttyRuntime")
    }
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
      self.requestCloseTab(tabID)
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
      self.requestCloseSurface(view.id, needsConfirmation: processAlive)
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
    guard let selectedTabID = workspaceManager.selectedTabID else { return nil }
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
    guard tabs.indices.contains(tabOffset) else {
      throw TerminalCreatePaneError.tabNotFound(
        windowIndex: windowIndex,
        tabIndex: tabIndex
      )
    }

    let tabID = tabs[tabOffset].id
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
    workspaceManager.workspace(for: tabID)
      .flatMap { workspaceManager.tabManager(for: $0.id) }?
      .updateTitle(tabID, title: resolvedTitle)
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
    guard tabID == workspaceManager.selectedTabID else { return }
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
      Self.isRunning(progressState: surface.bridge.state.progressState)
    }
    workspaceManager.workspace(for: tabID)
      .flatMap { workspaceManager.tabManager(for: $0.id) }?
      .updateDirty(tabID, isDirty: isRunning)
  }

  private func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains(where: \.needsCloseConfirmation)
  }

  func windowNeedsCloseConfirmation() -> Bool {
    trees.values.contains { tree in
      tree.leaves().contains(where: \.needsCloseConfirmation)
    }
  }

  private func surfaceNeedsCloseConfirmation(_ surfaceID: UUID) -> Bool {
    surfaces[surfaceID]?.needsCloseConfirmation ?? false
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
    for tab in tabs {
      guard tab.title.hasPrefix("Terminal ") else { continue }
      let suffix = tab.title.dropFirst("Terminal ".count)
      guard let value = Int(suffix) else { continue }
      maxIndex = max(maxIndex, value)
    }
    return maxIndex + 1
  }

  private func fallbackTitle(for tabID: TerminalTabID) -> String {
    workspaceManager.tab(for: tabID)?.title ?? "Terminal"
  }

  private func observeWorkspaceCatalog() {
    workspaceCatalogObservationTask?.cancel()
    workspaceCatalogObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.workspaceCatalog ?? .default
      }
      for await workspaceCatalog in observations {
        guard let self else { return }
        self.applyObservedWorkspaceCatalog(workspaceCatalog)
      }
    }
  }

  private func applyObservedWorkspaceCatalog(_ workspaceCatalog: TerminalWorkspaceCatalog) {
    let resolvedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    guard resolvedWorkspaceCatalog != lastAppliedWorkspaceCatalog else { return }

    let previousSelectedWorkspaceID = selectedWorkspaceID
    lastAppliedWorkspaceCatalog = resolvedWorkspaceCatalog
    let diff = workspaceManager.applyCatalog(resolvedWorkspaceCatalog)
    removeTrees(for: diff.removedTabIDs)

    if previousSelectedWorkspaceID != selectedWorkspaceID {
      finalizeWorkspaceSelectionChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
    }
  }

  @discardableResult
  private func writeWorkspaceCatalog(
    _ workspaceCatalog: TerminalWorkspaceCatalog
  ) -> TerminalWorkspaceManager.WorkspaceCatalogDiff {
    let resolvedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    replaceWorkspaceCatalog(resolvedWorkspaceCatalog)
    lastAppliedWorkspaceCatalog = resolvedWorkspaceCatalog

    let diff = workspaceManager.applyCatalog(resolvedWorkspaceCatalog)
    removeTrees(for: diff.removedTabIDs)
    return diff
  }

  private func persistDefaultSelectedWorkspaceID(_ workspaceID: TerminalWorkspaceID) {
    guard workspaceCatalog.defaultSelectedWorkspaceID != workspaceID else { return }

    var updatedWorkspaceCatalog = workspaceCatalog
    updatedWorkspaceCatalog.defaultSelectedWorkspaceID = workspaceID
    replaceWorkspaceCatalog(updatedWorkspaceCatalog)
    lastAppliedWorkspaceCatalog = updatedWorkspaceCatalog
  }

  private func replaceWorkspaceCatalog(_ workspaceCatalog: TerminalWorkspaceCatalog) {
    $workspaceCatalog.withLock { $0 = workspaceCatalog }
  }

  private func nextSelectedWorkspaceID(afterDeleting workspaceID: TerminalWorkspaceID) -> TerminalWorkspaceID {
    let remainingWorkspaces = workspaces.filter { $0.id != workspaceID }
    precondition(!remainingWorkspaces.isEmpty)

    if let selectedWorkspaceID,
      selectedWorkspaceID != workspaceID,
      remainingWorkspaces.contains(where: { $0.id == selectedWorkspaceID })
    {
      return selectedWorkspaceID
    }

    if let deletedIndex = workspaces.firstIndex(where: { $0.id == workspaceID }) {
      for workspace in workspaces[..<deletedIndex].reversed()
      where remainingWorkspaces.contains(where: { $0.id == workspace.id }) {
        return workspace.id
      }
    }

    return remainingWorkspaces[0].id
  }

  private func finalizeWorkspaceSelectionChange() {
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

  private func removeTrees(for tabIDs: [TerminalTabID]) {
    for tabID in tabIDs {
      removeTree(for: tabID)
    }
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

  private func debugPaneSnapshot(
    _ surface: GhosttySurfaceView,
    index: Int,
    isFocused: Bool
  ) -> SupatermAppDebugSnapshot.Pane {
    let state = surface.bridge.state
    return .init(
      index: index,
      id: surface.id,
      isFocused: isFocused,
      displayTitle: surface.resolvedDisplayTitle(defaultValue: "Pane \(index)"),
      pwd: Self.trimmedNonEmpty(state.pwd),
      isReadOnly: state.readOnly == GHOSTTY_READONLY_ON,
      hasSecureInput: surface.passwordInput,
      bellCount: state.bellCount,
      isRunning: Self.isRunning(progressState: state.progressState),
      progressState: Self.progressStateDescription(state.progressState),
      progressValue: state.progressValue,
      needsCloseConfirmation: surface.needsCloseConfirmation,
      lastCommandExitCode: state.commandExitCode,
      lastCommandDurationMs: state.commandDuration,
      lastChildExitCode: state.childExitCode,
      lastChildExitTimeMs: state.childExitTimeMs
    )
  }

  private static func isRunning(
    progressState: ghostty_action_progress_report_state_e?
  ) -> Bool {
    switch progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET),
      .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE),
      .some(GHOSTTY_PROGRESS_STATE_PAUSE),
      .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return true
    default:
      return false
    }
  }

  private static func progressStateDescription(
    _ progressState: ghostty_action_progress_report_state_e?
  ) -> String? {
    switch progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET):
      return "set"
    case .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE):
      return "indeterminate"
    case .some(GHOSTTY_PROGRESS_STATE_PAUSE):
      return "pause"
    case .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return "error"
    case .some(GHOSTTY_PROGRESS_STATE_REMOVE):
      return "remove"
    default:
      return nil
    }
  }

  private static func trimmedNonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
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
