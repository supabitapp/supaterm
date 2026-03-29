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
  enum SessionDisposal {
    case detach
    case kill
  }

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
  private let zmxClient: ZMXClient
  @ObservationIgnored
  private var eventContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  @ObservationIgnored
  @Shared(.terminalWorkspaceCatalog)
  private var workspaceCatalog = TerminalWorkspaceCatalog.default
  @ObservationIgnored
  @Shared(.terminalSessionCatalog)
  private var sessionCatalog = PersistedTerminalSessionCatalog.default
  @ObservationIgnored
  private var workspaceCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  private var sessionCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  private var lastAppliedWorkspaceCatalog = TerminalWorkspaceCatalog.default
  let workspaceManager = TerminalWorkspaceManager()

  private var pendingEvents: [TerminalClient.Event] = []
  private var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  private var surfaces: [UUID: GhosttySurfaceView] = [:]
  private var paneSessionNames: [UUID: String] = [:]
  private var closeRequestedSurfaceIDs: Set<UUID> = []
  private var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var lastEmittedFocusSurfaceID: UUID?

  var windowActivity = WindowActivityState.inactive

  init(
    runtime: GhosttyRuntime? = nil,
    managesTerminalSurfaces: Bool = true,
    zmxClient: ZMXClient = .live
  ) {
    self.managesTerminalSurfaces = managesTerminalSurfaces
    self.runtime = managesTerminalSurfaces ? (runtime ?? GhosttyRuntime()) : runtime
    self.zmxClient = zmxClient

    let persistedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    let initialWorkspaceCatalog = persistedWorkspaceCatalog
    if initialWorkspaceCatalog != workspaceCatalog {
      replaceWorkspaceCatalog(initialWorkspaceCatalog)
    }
    let effectiveSessionCatalog = Self.sessionCatalog(from: initialWorkspaceCatalog)
    if effectiveSessionCatalog != sessionCatalog {
      replaceSessionCatalog(effectiveSessionCatalog)
    }
    lastAppliedWorkspaceCatalog = initialWorkspaceCatalog
    workspaceManager.bootstrap(
      from: initialWorkspaceCatalog,
      initialSelectedWorkspaceID: initialWorkspaceCatalog.defaultSelectedWorkspaceID
    )
    restoreSessionState(from: effectiveSessionCatalog)
    observeWorkspaceCatalog()
    observeSessionCatalog()
  }

  deinit {
    workspaceCatalogObservationTask?.cancel()
    sessionCatalogObservationTask?.cancel()
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
    persistSessionCatalogSnapshot()
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
    persistSessionCatalogSnapshot()
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
    _ = writeWorkspaceCatalog(
      updatedWorkspaceCatalog,
      removedTabSessionDisposal: .kill
    )
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
    persistSessionCatalogSnapshot()
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
    persistSessionCatalogSnapshot()
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
    let resolvedNeedsConfirmation = needsConfirmation ?? surfaceNeedsCloseConfirmation(surfaceID)
    if !resolvedNeedsConfirmation {
      guard closeRequestedSurfaceIDs.insert(surfaceID).inserted else { return }
    }
    emit(
      .closeRequested(
        .init(
          target: .surface(surfaceID),
          needsConfirmation: resolvedNeedsConfirmation
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

  func shareWorkspaceStateSnapshot() -> ShareWorkspaceState {
    guard let sharedWorkspaceID = resolvedSharedWorkspaceID() else {
      return ShareWorkspaceState(
        workspaces: [],
        selectedWorkspaceId: nil,
        tabs: [],
        selectedTabId: nil,
        trees: [:],
        focusedPaneByTab: [:],
        panes: [:]
      )
    }

    guard let workspace = workspaceManager.workspaces.first(where: { $0.id == sharedWorkspaceID }) else {
      return ShareWorkspaceState(
        workspaces: [],
        selectedWorkspaceId: nil,
        tabs: [],
        selectedTabId: nil,
        trees: [:],
        focusedPaneByTab: [:],
        panes: [:]
      )
    }

    let sharedTabs = workspaceManager.tabs(in: sharedWorkspaceID)
    var treesByTabID: [String: ShareWorkspaceState.SplitTree] = [:]
    var focusedPaneByTab: [String: String] = [:]
    var panes: [String: ShareWorkspaceState.Pane] = [:]
    let shareTabs = sharedTabs.map { tab in
      let shareTab = ShareWorkspaceState.Tab(
        id: tab.id.rawValue.uuidString,
        workspaceId: sharedWorkspaceID.rawValue.uuidString,
        title: tab.title,
        icon: tab.icon,
        isDirty: tab.isDirty,
        isPinned: tab.isPinned,
        isTitleLocked: tab.isTitleLocked,
        tone: tab.tone.shareValue
      )

      if let tree = trees[tab.id] {
        treesByTabID[shareTab.id] = Self.shareSplitTree(from: tree)
        for surface in tree.leaves() {
          let paneID = surface.id
          let gridSize = surface.currentGridSize()
          panes[paneID.uuidString] = ShareWorkspaceState.Pane(
            id: paneID.uuidString,
            tabId: shareTab.id,
            sessionName: paneSessionNames[paneID] ?? Self.paneSessionName(tabID: tab.id, paneID: paneID),
            title: surface.bridge.state.title ?? fallbackTitle(for: tab.id),
            pwd: surface.bridge.state.pwd,
            isRunning: surface.bridge.state.progressState != nil,
            cols: gridSize?.cols ?? 80,
            rows: gridSize?.rows ?? 24
          )
        }
      }

      if let focusedSurfaceID = focusedSurfaceIDByTab[tab.id] {
        focusedPaneByTab[shareTab.id] = focusedSurfaceID.uuidString
      }

      return shareTab
    }

    return ShareWorkspaceState(
      workspaces: [
        .init(
          id: sharedWorkspaceID.rawValue.uuidString,
          name: workspace.name
        )
      ],
      selectedWorkspaceId: sharedWorkspaceID.rawValue.uuidString,
      tabs: shareTabs,
      selectedTabId: workspaceManager.selectedTabID(in: sharedWorkspaceID)?.rawValue.uuidString,
      trees: treesByTabID,
      focusedPaneByTab: focusedPaneByTab,
      panes: panes
    )
  }

  func sharePaneRuntime(for paneId: UUID) -> SharePaneRuntime? {
    guard let sharedWorkspaceID = resolvedSharedWorkspaceID() else { return nil }
    guard paneIsWithinSharedWorkspace(paneId, sharedWorkspaceID: sharedWorkspaceID) else { return nil }
    guard let tabID = tabID(containing: paneId) else { return nil }
    guard let surface = surfaces[paneId] else { return nil }
    let gridSize = surface.currentGridSize()
    return SharePaneRuntime(
      paneId: paneId,
      sessionName: paneSessionNames[paneId] ?? Self.paneSessionName(tabID: tabID, paneID: paneId),
      cols: gridSize?.cols ?? 80,
      rows: gridSize?.rows ?? 24
    )
  }

  func prepareShareSessions() -> [String] {
    guard let sharedWorkspaceID = resolvedSharedWorkspaceID() else {
      return []
    }

    let sessionNames = workspaceManager.tabs(in: sharedWorkspaceID).flatMap { tab in
      (trees[tab.id]?.leaves() ?? []).map { surface in
        paneSessionNames[surface.id] ?? Self.paneSessionName(tabID: tab.id, paneID: surface.id)
      }
    }

    return Array(Set(sessionNames)).sorted()
  }

  func handleShareMessage(_ message: ShareClientMessage) throws {
    let sharedWorkspaceID = resolvedSharedWorkspaceID()

    switch message {
    case .sync, .resume, .resizePane:
      return

    case .createWorkspace,
      .deleteWorkspace,
      .renameWorkspace,
      .selectWorkspace,
      .setTabOrder,
      .togglePinned:
      return

    case .createTab(let inheritFromPaneId):
      if let inheritFromPaneId {
        guard paneIsWithinSharedWorkspace(inheritFromPaneId, sharedWorkspaceID: sharedWorkspaceID) else { return }
      }
      _ = createTab(inheritingFromSurfaceID: inheritFromPaneId)

    case .closeTab(let tabId):
      let tabID = TerminalTabID(rawValue: tabId)
      guard tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID) else { return }
      closeTab(tabID)

    case .selectTab(let tabId):
      let tabID = TerminalTabID(rawValue: tabId)
      guard tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID) else { return }
      selectTab(tabID)

    case .selectTabSlot(let slot):
      guard sharedWorkspaceID != nil else { return }
      selectTab(slot: slot)

    case .nextTab:
      guard sharedWorkspaceID != nil else { return }
      nextTab()

    case .previousTab:
      guard sharedWorkspaceID != nil else { return }
      previousTab()

    case .createPane(let tabId, let direction, let targetPaneId, let command, let focus):
      let tabID = TerminalTabID(rawValue: tabId)
      guard tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID) else { return }
      try shareCreatePane(
        tabID: tabID,
        direction: direction,
        targetPaneID: targetPaneId.flatMap {
          paneIsWithinSharedWorkspace($0, sharedWorkspaceID: sharedWorkspaceID) ? $0 : nil
        },
        command: command,
        focus: focus
      )

    case .closePane(let paneId):
      guard paneIsWithinSharedWorkspace(paneId, sharedWorkspaceID: sharedWorkspaceID) else { return }
      closeSurface(paneId)

    case .focusPane(let paneId):
      guard paneIsWithinSharedWorkspace(paneId, sharedWorkspaceID: sharedWorkspaceID) else { return }
      try focusPaneForShare(paneId)

    case .splitResize(let paneId, let delta, let axis):
      guard paneIsWithinSharedWorkspace(paneId, sharedWorkspaceID: sharedWorkspaceID) else { return }
      try resizeSplitForShare(paneId: paneId, delta: delta, axis: axis)

    case .equalizePanes(let tabId):
      let tabID = TerminalTabID(rawValue: tabId)
      guard tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID) else { return }
      performSplitOperation(.equalize, in: tabID)

    case .toggleZoom(let tabId):
      let tabID = TerminalTabID(rawValue: tabId)
      guard tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID) else { return }
      try toggleZoomForShare(tabId: tabID)
    }
  }

  private func resolvedSharedWorkspaceID() -> TerminalWorkspaceID? {
    if let selectedWorkspaceID,
      workspaceManager.tabs(in: selectedWorkspaceID).contains(where: { trees[$0.id] != nil })
    {
      return selectedWorkspaceID
    }
    if let selectedTabID,
      let workspaceID = workspaceManager.workspace(for: selectedTabID)?.id
    {
      return workspaceID
    }
    return workspaces.first(where: { workspace in
      workspaceManager.tabs(in: workspace.id).contains(where: { trees[$0.id] != nil })
    })?.id
  }

  private func tabIsWithinSharedWorkspace(
    _ tabID: TerminalTabID,
    sharedWorkspaceID: TerminalWorkspaceID?
  ) -> Bool {
    guard let sharedWorkspaceID else { return false }
    return workspaceManager.workspace(for: tabID)?.id == sharedWorkspaceID
  }

  private func paneIsWithinSharedWorkspace(
    _ paneID: UUID,
    sharedWorkspaceID: TerminalWorkspaceID?
  ) -> Bool {
    guard let tabID = tabID(containing: paneID) else { return false }
    return tabIsWithinSharedWorkspace(tabID, sharedWorkspaceID: sharedWorkspaceID)
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
      persistSessionCatalogSnapshot()

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
      paneSessionNames.removeValue(forKey: newSurface.id)
      throw error
    } catch {
      newSurface.closeSurface()
      surfaces.removeValue(forKey: newSurface.id)
      paneSessionNames.removeValue(forKey: newSurface.id)
      throw TerminalCreatePaneError.creationFailed
    }
  }

  private func shareCreatePane(
    tabID: TerminalTabID,
    direction: SupatermPaneDirection,
    targetPaneID: UUID?,
    command: String?,
    focus: Bool
  ) throws {
    let target: TerminalCreatePaneRequest.Target
    if let targetPaneID {
      target = .contextPane(targetPaneID)
    } else {
      guard let workspace = workspaceManager.workspace(for: tabID),
        let tabIndex = workspaceManager.tabs(in: workspace.id).firstIndex(where: { $0.id == tabID })
      else {
        throw TerminalCreatePaneError.tabNotFound(windowIndex: 1, tabIndex: 1)
      }
      target = .tab(windowIndex: 1, tabIndex: tabIndex + 1)
    }

    _ = try createPane(
      .init(
        command: command,
        direction: direction,
        focus: focus,
        target: target
      )
    )
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
        persistSessionCatalogSnapshot()
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
        persistSessionCatalogSnapshot()
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
        persistSessionCatalogSnapshot()
        return true
      } catch {
        return false
      }

    case .equalizeSplits:
      trees[tabID] = tree.equalized()
      persistSessionCatalogSnapshot()
      return true

    case .toggleSplitZoom:
      guard tree.isSplit else { return false }
      let newZoomed = tree.zoomed == targetNode ? nil : targetNode
      trees[tabID] = tree.settingZoomed(newZoomed)
      persistSessionCatalogSnapshot()
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
        persistSessionCatalogSnapshot()
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
        persistSessionCatalogSnapshot()
        focusSurface(payload, in: tabID)
      } catch {
        return
      }

    case .equalize:
      trees[tabID] = tree.equalized()
      persistSessionCatalogSnapshot()
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

    removeTree(for: tabID, sessionDisposal: .kill)
    tabManager.closeTab(tabID)
    persistSessionCatalogSnapshot()

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
    if let sessionName = paneSessionNames[surfaceID] {
      zmxClient.killSession(sessionName)
    }
    surface.closeSurface()
    closeRequestedSurfaceIDs.remove(surfaceID)
    surfaces.removeValue(forKey: surfaceID)
    paneSessionNames.removeValue(forKey: surfaceID)

    if newTree.isEmpty {
      trees.removeValue(forKey: tabID)
      focusedSurfaceIDByTab.removeValue(forKey: tabID)
      workspaceManager.workspace(for: tabID)
        .flatMap { workspaceManager.tabManager(for: $0.id) }?
        .closeTab(tabID)
      persistSessionCatalogSnapshot()
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
    persistSessionCatalogSnapshot()
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
    context: ghostty_surface_context_e,
    persistedPane: PersistedTerminalPane? = nil
  ) -> GhosttySurfaceView {
    guard let runtime else {
      preconditionFailure("TerminalHostState cannot create surfaces without a GhosttyRuntime")
    }
    let inherited = inheritedSurfaceConfig(fromSurfaceID: inheritingFromSurfaceID, context: context)
    let paneID = persistedPane?.id ?? UUID()
    let sessionName = persistedPane?.sessionName ?? Self.paneSessionName(tabID: tabID, paneID: paneID)
    let workingDirectory =
      persistedPane?.workingDirectoryPath.map { URL(fileURLWithPath: $0, isDirectory: true) }
      ?? inherited.workingDirectory
    let view = GhosttySurfaceView(
      runtime: runtime,
      surfaceID: paneID,
      tabID: tabID.rawValue,
      workingDirectory: workingDirectory,
      command: nil,
      initialInput: Self.zmxBootstrapInput(sessionName: sessionName, trailingInput: initialInput),
      additionalEnvironmentVariables: Self.zmxEnvironmentVariables(sessionName: sessionName),
      fontSize: inherited.fontSize,
      context: context,
      managesWindowAppearance: false
    )
    view.bridge.onTitleChange = { [weak self] (_: String) in
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
    view.bridge.onCloseTab = { [weak self] (_: ghostty_action_close_tab_mode_e) in
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
    view.bridge.onProgressReport = { [weak self] (_: ghostty_action_progress_report_state_e) in
      guard let self else { return }
      self.updateRunningState(for: tabID)
    }
    view.bridge.onCloseRequest = { [weak self, weak view] (processAlive: Bool) in
      guard let self, let view else { return }
      self.requestCloseSurface(view.id, needsConfirmation: processAlive)
    }
    view.onFocusChange = { [weak self, weak view] (focused: Bool) in
      guard let self, let view, focused else { return }
      self.focusedSurfaceIDByTab[tabID] = view.id
      self.updateTabTitle(for: tabID)
      self.updateRunningState(for: tabID)
      self.emitFocusChangedIfNeeded(view.id)
    }
    surfaces[view.id] = view
    paneSessionNames[view.id] = sessionName
    closeRequestedSurfaceIDs.remove(view.id)
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

  private func focusPaneForShare(_ paneID: UUID) throws {
    guard let tabID = tabID(containing: paneID), let surface = surfaces[paneID] else {
      throw TerminalCreatePaneError.contextPaneNotFound
    }
    if let workspace = workspaceManager.workspace(for: tabID) {
      _ = workspaceManager.selectWorkspace(workspace.id)
      workspaceManager.tabManager(for: workspace.id)?.selectTab(tabID)
    }
    focusSurface(surface, in: tabID)
    persistSessionCatalogSnapshot()
  }

  private func resizeSplitForShare(
    paneId: UUID,
    delta: Double,
    axis: String
  ) throws {
    guard let tabID = tabID(containing: paneId), var tree = trees[tabID] else {
      throw TerminalCreatePaneError.contextPaneNotFound
    }
    guard let targetNode = tree.find(id: paneId) else {
      throw TerminalCreatePaneError.contextPaneNotFound
    }
    let spatialDirection: SplitTree<GhosttySurfaceView>.SpatialDirection =
      switch axis {
      case "horizontal":
        delta >= 0 ? .right : .left
      case "vertical":
        delta >= 0 ? .down : .top
      default:
        throw ShareServerError.invalidField("axis")
      }
    do {
      let newTree = try tree.resizing(
        node: targetNode,
        by: UInt16(max(1, min(100, Int(abs(delta) * 100)))),
        in: spatialDirection,
        with: CGRect(origin: .zero, size: tree.viewBounds())
      )
      tree = newTree
      trees[tabID] = tree
      persistSessionCatalogSnapshot()
    } catch {
      throw TerminalCreatePaneError.creationFailed
    }
  }

  private func toggleZoomForShare(tabId: TerminalTabID) throws {
    guard var tree = trees[tabId], tree.isSplit else { return }
    guard let focusedPaneID = focusedSurfaceIDByTab[tabId], let targetNode = tree.find(id: focusedPaneID) else {
      throw TerminalCreatePaneError.contextPaneNotFound
    }
    let newZoomed = tree.zoomed == targetNode ? nil : targetNode
    tree = tree.settingZoomed(newZoomed)
    trees[tabId] = tree
    persistSessionCatalogSnapshot()
  }

  private static func shareSplitTree(
    from tree: SplitTree<GhosttySurfaceView>
  ) -> ShareWorkspaceState.SplitTree {
    .init(
      root: tree.root.map(shareSplitTreeNode),
      zoomed: tree.zoomed.map(shareSplitTreeNode)
    )
  }

  private static func shareSplitTreeNode(
    from node: SplitTree<GhosttySurfaceView>.Node
  ) -> ShareWorkspaceState.Node {
    switch node {
    case .leaf(let view):
      return .leaf(id: view.id.uuidString)
    case .split(let split):
      return .split(
        direction: split.direction == .horizontal ? "horizontal" : "vertical",
        ratio: split.ratio,
        left: shareSplitTreeNode(from: split.left),
        right: shareSplitTreeNode(from: split.right)
      )
    }
  }

  static func paneSessionName(tabID: TerminalTabID, paneID: UUID) -> String {
    "sp.\(compactSessionComponent(tabID.rawValue.uuidString)).\(compactSessionComponent(paneID.uuidString))"
  }

  private static func compactSessionComponent(_ value: String) -> String {
    value
      .lowercased()
      .replacingOccurrences(of: "-", with: "")
      .prefix(12)
      .description
  }

  static func zmxBootstrapInput(
    sessionName: String,
    trailingInput: String? = nil
  ) -> String {
    let attachCommand = zmxBootstrapCommand(sessionName: sessionName)
    guard let trailingInput, !trailingInput.isEmpty else {
      return "\(attachCommand)\n"
    }
    return "\(attachCommand)\n\(trailingInput)"
  }

  static func zmxBootstrapCommand(sessionName: String) -> String {
    let zmxRef = bundledZMXCommandReference()
    return "exec \(zmxRef) attach \(shellQuoted(sessionName))"
  }

  private static func shellQuoted(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }

  private static func bundledZMXCommandReference(
    executableURL: URL? = Bundle.main.executableURL
  ) -> String {
    if let executableDirectory = executableURL?.deletingLastPathComponent() {
      return shellQuoted(
        executableDirectory
          .appendingPathComponent("zmx", isDirectory: false)
          .path(percentEncoded: false)
      )
    }

    return "\"zmx\""
  }

  static func zmxEnvironmentVariables(
    sessionName: String
  ) -> [SupatermCLIEnvironmentVariable] {
    [
      SupatermCLIEnvironmentVariable(
        key: SupatermCLIEnvironment.paneSessionNameKey,
        value: sessionName
      )
    ]
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
    persistSessionCatalogSnapshot()
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
    persistSessionCatalogSnapshot()
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

  func paneSessionName(for paneID: UUID) -> String? {
    paneSessionNames[paneID]
  }

  private func restoreSessionState(from catalog: PersistedTerminalSessionCatalog) {
    for workspace in catalog.workspaces {
      guard let tabManager = workspaceManager.tabManager(for: workspace.id) else { continue }
      let restoredTabs = workspace.tabs.map {
        TerminalTabItem(
          id: $0.id,
          title: $0.title,
          icon: $0.icon,
          isPinned: $0.isPinned,
          isTitleLocked: $0.isTitleLocked
        )
      }
      tabManager.restoreTabs(restoredTabs, selectedTabID: workspace.selectedTabID)

      guard managesTerminalSurfaces else { continue }
      for persistedTab in workspace.tabs {
        restoreTree(for: persistedTab)
      }
    }
  }

  private func restoreTree(for persistedTab: PersistedTerminalTab) {
    let panesByID = Dictionary(uniqueKeysWithValues: persistedTab.panes.map { ($0.id, $0) })
    var orderedPaneIDs = persistedTab.panes.map(\.id)
    if let rootPaneID = persistedTab.splitTree.root.leftmostPaneID,
      let rootIndex = orderedPaneIDs.firstIndex(of: rootPaneID)
    {
      orderedPaneIDs.swapAt(0, rootIndex)
    }

    var viewsByID: [UUID: GhosttySurfaceView] = [:]
    for (index, paneID) in orderedPaneIDs.enumerated() {
      guard let persistedPane = panesByID[paneID] else { continue }
      let view = createSurface(
        tabID: persistedTab.id,
        initialInput: nil,
        inheritingFromSurfaceID: nil,
        context: index == 0 ? GHOSTTY_SURFACE_CONTEXT_TAB : GHOSTTY_SURFACE_CONTEXT_SPLIT,
        persistedPane: persistedPane
      )
      viewsByID[paneID] = view
    }

    guard
      let root = splitTreeNode(from: persistedTab.splitTree.root, viewsByID: viewsByID)
    else {
      return
    }
    let zoomed = persistedTab.splitTree.zoomedPaneID.flatMap {
      splitTreeNode(from: .leaf($0), viewsByID: viewsByID)
    }
    trees[persistedTab.id] = SplitTree(root: root, zoomed: zoomed)
    if viewsByID[persistedTab.selectedPaneID] != nil {
      focusedSurfaceIDByTab[persistedTab.id] = persistedTab.selectedPaneID
    } else {
      focusedSurfaceIDByTab[persistedTab.id] = orderedPaneIDs.first
    }
  }

  private func splitTreeNode(
    from node: PersistedTerminalSplitTree.Node,
    viewsByID: [UUID: GhosttySurfaceView]
  ) -> SplitTree<GhosttySurfaceView>.Node? {
    switch node {
    case .leaf(let paneID):
      guard let view = viewsByID[paneID] else { return nil }
      return .leaf(view: view)
    case .split(let split):
      guard
        let left = splitTreeNode(from: split.left, viewsByID: viewsByID),
        let right = splitTreeNode(from: split.right, viewsByID: viewsByID)
      else {
        return nil
      }
      return .split(
        .init(
          direction: split.direction == .horizontal ? .horizontal : .vertical,
          ratio: split.ratio,
          left: left,
          right: right
        )
      )
    }
  }

  private func removeTree(
    for tabID: TerminalTabID,
    sessionDisposal: SessionDisposal = .detach
  ) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    for surface in tree.leaves() {
      if sessionDisposal == .kill,
        let sessionName = paneSessionNames[surface.id]
      {
        zmxClient.killSession(sessionName)
      }
      surface.closeSurface()
      surfaces.removeValue(forKey: surface.id)
      paneSessionNames.removeValue(forKey: surface.id)
    }
    focusedSurfaceIDByTab.removeValue(forKey: tabID)
  }

  private func persistSessionCatalogSnapshot() {
    let snapshot = sessionCatalogSnapshot()
    replaceSessionCatalog(
      PersistedTerminalSessionCatalog.merged(
        base: PersistedTerminalSessionCatalog.sanitized(sessionCatalog),
        incoming: snapshot
      )
    )
  }

  private func sessionCatalogSnapshot() -> PersistedTerminalSessionCatalog {
    let currentTimestamp = PersistedTerminalSessionCatalog.currentTimestamp()
    let previousCatalog = PersistedTerminalSessionCatalog.sanitized(sessionCatalog)
    let previousWorkspacesByID = Dictionary(
      uniqueKeysWithValues: previousCatalog.workspaces.map { ($0.id, $0) }
    )
    let workspaceIDs = Set(workspaces.map(\.id))
    let tabIDs = Set(workspaces.flatMap { workspaceManager.tabs(in: $0.id).map(\.id) })
    let paneIDs = Set(surfaces.keys)
    let workspaceSnapshots: [PersistedTerminalWorkspaceState] = workspaces.map { workspace in
      let previousWorkspace = previousWorkspacesByID[workspace.id]
      let tabs = persistedTabs(
        in: workspace.id,
        previousWorkspace: previousWorkspace,
        currentTimestamp: currentTimestamp
      )
      let selectedTabID = workspaceManager.selectedTabID(in: workspace.id)
      return PersistedTerminalWorkspaceState(
        id: workspace.id,
        updatedAt:
          previousWorkspace.map {
            let candidate = PersistedTerminalWorkspaceState(
              id: workspace.id,
              updatedAt: $0.updatedAt,
              name: workspace.name,
              tabs: tabs,
              selectedTabID: selectedTabID
            )
            return candidate == $0 ? $0.updatedAt : currentTimestamp
          } ?? currentTimestamp,
        name: workspace.name,
        tabs: tabs,
        selectedTabID: selectedTabID
      )
    }
    return PersistedTerminalSessionCatalog.sanitized(
      PersistedTerminalSessionCatalog(
        defaultSelectedWorkspaceID: workspaceCatalog.defaultSelectedWorkspaceID,
        selectionUpdatedAt:
          workspaceCatalog.defaultSelectedWorkspaceID == previousCatalog.defaultSelectedWorkspaceID
          ? previousCatalog.selectionUpdatedAt
          : currentTimestamp,
        workspaces: workspaceSnapshots,
        workspaceTombstones: updatedTombstones(
          previousCatalog.workspaceTombstones,
          previousIDs: Set(previousCatalog.workspaces.map(\.id)),
          currentIDs: workspaceIDs,
          currentTimestamp: currentTimestamp,
          activeUpdatedAtByID: Dictionary(uniqueKeysWithValues: workspaceSnapshots.map { ($0.id, $0.updatedAt) })
        ),
        tabTombstones: updatedTombstones(
          previousCatalog.tabTombstones,
          previousIDs: Set(previousCatalog.workspaces.flatMap { $0.tabs.map(\.id) }),
          currentIDs: tabIDs,
          currentTimestamp: currentTimestamp,
          activeUpdatedAtByID: Dictionary(
            uniqueKeysWithValues: workspaceSnapshots.flatMap { $0.tabs.map { ($0.id, $0.updatedAt) } }
          )
        ),
        paneTombstones: updatedTombstones(
          previousCatalog.paneTombstones,
          previousIDs: Set(previousCatalog.workspaces.flatMap { $0.tabs.flatMap { $0.panes.map(\.id) } }),
          currentIDs: paneIDs,
          currentTimestamp: currentTimestamp,
          activeUpdatedAtByID: Dictionary(
            uniqueKeysWithValues: workspaceSnapshots.flatMap { $0.tabs.flatMap { $0.panes.map { ($0.id, $0.updatedAt) } } }
          )
        )
      )
    )
  }

  private func persistedTabs(
    in workspaceID: TerminalWorkspaceID,
    previousWorkspace: PersistedTerminalWorkspaceState?,
    currentTimestamp: UInt64
  ) -> [PersistedTerminalTab] {
    let previousTabsByID = Dictionary(
      uniqueKeysWithValues: previousWorkspace?.tabs.map { ($0.id, $0) } ?? []
    )
    return workspaceManager.tabs(in: workspaceID).compactMap { tab in
      guard let tree = trees[tab.id] else { return nil }
      let previousTab = previousTabsByID[tab.id]
      let previousPanesByID = Dictionary(
        uniqueKeysWithValues: previousTab?.panes.map { ($0.id, $0) } ?? []
      )
      let panes = tree.leaves().map { surface -> PersistedTerminalPane in
        let previousPane = previousPanesByID[surface.id]
        let candidate = PersistedTerminalPane(
          id: surface.id,
          sessionName: paneSessionNames[surface.id] ?? Self.paneSessionName(tabID: tab.id, paneID: surface.id),
          updatedAt: previousPane?.updatedAt ?? currentTimestamp,
          title: surface.bridge.state.title,
          workingDirectoryPath: surface.bridge.state.pwd,
          lastKnownRunning: surface.bridge.state.progressState != nil
        )
        if let previousPane, candidate == previousPane {
          return previousPane
        }
        var updated = candidate
        updated.updatedAt = currentTimestamp
        return updated
      }
      guard
        let root = tree.root.map(Self.persistedSplitTreeNode(from:)),
        let selectedPaneID = focusedSurfaceIDByTab[tab.id] ?? panes.first?.id
      else {
        return nil
      }
      let candidate = PersistedTerminalTab(
        id: tab.id,
        updatedAt: previousTab?.updatedAt ?? currentTimestamp,
        title: tab.title,
        icon: tab.icon,
        isPinned: tab.isPinned,
        isTitleLocked: tab.isTitleLocked,
        selectedPaneID: selectedPaneID,
        panes: panes,
        splitTree: PersistedTerminalSplitTree(
          root: root,
          zoomedPaneID: tree.zoomed?.leftmostLeaf().id
        )
      )
      if let previousTab, candidate == previousTab {
        return previousTab
      }
      var updated = candidate
      updated.updatedAt = currentTimestamp
      return updated
    }
  }

  private func updatedTombstones(
    _ existingTombstones: [PersistedTerminalWorkspaceTombstone],
    previousIDs: Set<TerminalWorkspaceID>,
    currentIDs: Set<TerminalWorkspaceID>,
    currentTimestamp: UInt64,
    activeUpdatedAtByID: [TerminalWorkspaceID: UInt64]
  ) -> [PersistedTerminalWorkspaceTombstone] {
    let removedIDs = previousIDs.subtracting(currentIDs)
    let merged = Dictionary(
      uniqueKeysWithValues: existingTombstones.map { ($0.id, $0) }
    ).merging(
      Dictionary(
        uniqueKeysWithValues: removedIDs.map { id in
          (id, PersistedTerminalWorkspaceTombstone(id: id, deletedAt: currentTimestamp))
        }
      ),
      uniquingKeysWith: { lhs, rhs in lhs.deletedAt >= rhs.deletedAt ? lhs : rhs }
    )

    return merged.values
      .filter { tombstone in
        guard let activeUpdatedAt = activeUpdatedAtByID[tombstone.id] else { return true }
        return tombstone.deletedAt >= activeUpdatedAt
      }
      .sorted { $0.deletedAt < $1.deletedAt }
  }

  private func updatedTombstones(
    _ existingTombstones: [PersistedTerminalTabTombstone],
    previousIDs: Set<TerminalTabID>,
    currentIDs: Set<TerminalTabID>,
    currentTimestamp: UInt64,
    activeUpdatedAtByID: [TerminalTabID: UInt64]
  ) -> [PersistedTerminalTabTombstone] {
    let removedIDs = previousIDs.subtracting(currentIDs)
    let merged = Dictionary(
      uniqueKeysWithValues: existingTombstones.map { ($0.id, $0) }
    ).merging(
      Dictionary(
        uniqueKeysWithValues: removedIDs.map { id in
          (id, PersistedTerminalTabTombstone(id: id, deletedAt: currentTimestamp))
        }
      ),
      uniquingKeysWith: { lhs, rhs in lhs.deletedAt >= rhs.deletedAt ? lhs : rhs }
    )

    return merged.values
      .filter { tombstone in
        guard let activeUpdatedAt = activeUpdatedAtByID[tombstone.id] else { return true }
        return tombstone.deletedAt >= activeUpdatedAt
      }
      .sorted { $0.deletedAt < $1.deletedAt }
  }

  private func updatedTombstones(
    _ existingTombstones: [PersistedTerminalPaneTombstone],
    previousIDs: Set<UUID>,
    currentIDs: Set<UUID>,
    currentTimestamp: UInt64,
    activeUpdatedAtByID: [UUID: UInt64]
  ) -> [PersistedTerminalPaneTombstone] {
    let removedIDs = previousIDs.subtracting(currentIDs)
    let merged = Dictionary(
      uniqueKeysWithValues: existingTombstones.map { ($0.id, $0) }
    ).merging(
      Dictionary(
        uniqueKeysWithValues: removedIDs.map { id in
          (id, PersistedTerminalPaneTombstone(id: id, deletedAt: currentTimestamp))
        }
      ),
      uniquingKeysWith: { lhs, rhs in lhs.deletedAt >= rhs.deletedAt ? lhs : rhs }
    )

    return merged.values
      .filter { tombstone in
        guard let activeUpdatedAt = activeUpdatedAtByID[tombstone.id] else { return true }
        return tombstone.deletedAt >= activeUpdatedAt
      }
      .sorted { $0.deletedAt < $1.deletedAt }
  }

  private static func persistedSplitTreeNode(
    from node: SplitTree<GhosttySurfaceView>.Node
  ) -> PersistedTerminalSplitTree.Node {
    switch node {
    case .leaf(let view):
      return .leaf(view.id)
    case .split(let split):
      return .split(
        .init(
          direction: split.direction == .horizontal ? .horizontal : .vertical,
          ratio: split.ratio,
          left: persistedSplitTreeNode(from: split.left),
          right: persistedSplitTreeNode(from: split.right)
        )
      )
    }
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
    workspaceManager.workspace(for: tabID)
      .flatMap { workspaceManager.tabManager(for: $0.id) }?
      .updateDirty(tabID, isDirty: isRunning)
  }

  private func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains(where: \.needsCloseConfirmation)
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

  private func observeSessionCatalog() {
    sessionCatalogObservationTask?.cancel()
    sessionCatalogObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.sessionCatalog ?? .default
      }
      for await sessionCatalog in observations {
        guard let self else { return }
        self.applyObservedSessionCatalog(sessionCatalog)
      }
    }
  }

  private func applyObservedWorkspaceCatalog(_ workspaceCatalog: TerminalWorkspaceCatalog) {
    let resolvedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    guard resolvedWorkspaceCatalog != lastAppliedWorkspaceCatalog else { return }

    let previousSelectedWorkspaceID = selectedWorkspaceID
    lastAppliedWorkspaceCatalog = resolvedWorkspaceCatalog
    let diff = workspaceManager.applyCatalog(resolvedWorkspaceCatalog)
    removeTrees(for: diff.removedTabIDs, sessionDisposal: .detach)

    if previousSelectedWorkspaceID != selectedWorkspaceID {
      finalizeWorkspaceSelectionChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
    }
  }

  private func applyObservedSessionCatalog(_ sessionCatalog: PersistedTerminalSessionCatalog) {
    let resolvedSessionCatalog = PersistedTerminalSessionCatalog.sanitized(sessionCatalog)
    guard resolvedSessionCatalog != sessionCatalogSnapshot() else { return }

    let projectedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(
      Self.workspaceCatalog(from: resolvedSessionCatalog)
    )
    replaceWorkspaceCatalog(projectedWorkspaceCatalog)
    lastAppliedWorkspaceCatalog = projectedWorkspaceCatalog

    let existingTabIDs = Array(trees.keys)
    removeTrees(for: existingTabIDs, sessionDisposal: .detach)
    workspaceManager.bootstrap(
      from: projectedWorkspaceCatalog,
      initialSelectedWorkspaceID: projectedWorkspaceCatalog.defaultSelectedWorkspaceID
    )
    restoreSessionState(from: resolvedSessionCatalog)
    finalizeWorkspaceSelectionChange()
  }

  @discardableResult
  private func writeWorkspaceCatalog(
    _ workspaceCatalog: TerminalWorkspaceCatalog,
    removedTabSessionDisposal: SessionDisposal = .detach
  ) -> TerminalWorkspaceManager.WorkspaceCatalogDiff {
    let resolvedWorkspaceCatalog = TerminalWorkspaceCatalog.sanitized(workspaceCatalog)
    replaceWorkspaceCatalog(resolvedWorkspaceCatalog)
    lastAppliedWorkspaceCatalog = resolvedWorkspaceCatalog

    let diff = workspaceManager.applyCatalog(resolvedWorkspaceCatalog)
    removeTrees(for: diff.removedTabIDs, sessionDisposal: removedTabSessionDisposal)
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

  private func replaceSessionCatalog(_ sessionCatalog: PersistedTerminalSessionCatalog) {
    $sessionCatalog.withLock { $0 = sessionCatalog }
  }

  func prepareForTermination(killSessions: Bool) {
    let sessionNames = Array(Set(paneSessionNames.values)).sorted()
    replaceSessionCatalog(
      Self.sessionCatalog(from: TerminalWorkspaceCatalog.sanitized(workspaceCatalog))
    )

    for surface in surfaces.values {
      surface.closeSurface()
    }

    trees.removeAll()
    surfaces.removeAll()
    paneSessionNames.removeAll()
    focusedSurfaceIDByTab.removeAll()
    lastEmittedFocusSurfaceID = nil

    if killSessions {
      zmxClient.killSessions(sessionNames)
    }
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

  private func removeTrees(
    for tabIDs: [TerminalTabID],
    sessionDisposal: SessionDisposal = .detach
  ) {
    for tabID in tabIDs {
      removeTree(for: tabID, sessionDisposal: sessionDisposal)
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
}

extension TerminalHostState {
  private static func workspaceCatalog(
    from sessionCatalog: PersistedTerminalSessionCatalog
  ) -> TerminalWorkspaceCatalog {
    TerminalWorkspaceCatalog(
      defaultSelectedWorkspaceID: sessionCatalog.defaultSelectedWorkspaceID,
      workspaces: sessionCatalog.workspaces.map(\.catalogWorkspace)
    )
  }

  private static func sessionCatalog(
    from workspaceCatalog: TerminalWorkspaceCatalog
  ) -> PersistedTerminalSessionCatalog {
    PersistedTerminalSessionCatalog(
      defaultSelectedWorkspaceID: workspaceCatalog.defaultSelectedWorkspaceID,
      selectionUpdatedAt: PersistedTerminalSessionCatalog.currentTimestamp(),
      workspaces: workspaceCatalog.workspaces.map {
        PersistedTerminalWorkspaceState(id: $0.id, name: $0.name)
      }
    )
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
