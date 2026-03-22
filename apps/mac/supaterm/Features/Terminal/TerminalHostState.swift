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
  struct NewTabSelectionInput: Equatable {
    let selectedSpaceID: TerminalSpaceID?
    let targetSpaceID: TerminalSpaceID
    let selectedTabID: TerminalTabID?
    let targetTabID: TerminalTabID
    let windowActivity: WindowActivityState
    let focusedSurfaceID: UUID?
    let surfaceID: UUID
  }

  struct NewTabSelectionState: Equatable {
    let isFocused: Bool
    let isSelectedSpace: Bool
    let isSelectedTab: Bool
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
  private var eventContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  @ObservationIgnored
  @Shared(.terminalSpaceCatalog)
  private var spaceCatalog = TerminalSpaceCatalog.default
  @ObservationIgnored
  private var spaceCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  private var lastAppliedSpaceCatalog = TerminalSpaceCatalog.default
  let spaceManager = TerminalSpaceManager()

  private var pendingEvents: [TerminalClient.Event] = []
  private var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  private var surfaces: [UUID: GhosttySurfaceView] = [:]
  private var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var tabTitleOverrides: [TerminalTabID: String] = [:]
  private var lastEmittedFocusSurfaceID: UUID?

  var windowActivity = WindowActivityState.inactive

  init(
    runtime: GhosttyRuntime? = nil,
    managesTerminalSurfaces: Bool = true
  ) {
    self.managesTerminalSurfaces = managesTerminalSurfaces
    self.runtime = managesTerminalSurfaces ? (runtime ?? GhosttyRuntime()) : runtime

    let initialSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    if initialSpaceCatalog != spaceCatalog {
      replaceSpaceCatalog(initialSpaceCatalog)
    }
    lastAppliedSpaceCatalog = initialSpaceCatalog
    spaceManager.bootstrap(
      from: initialSpaceCatalog,
      initialSelectedSpaceID: initialSpaceCatalog.defaultSelectedSpaceID
    )
    observeSpaceCatalog()
  }

  deinit {
    spaceCatalogObservationTask?.cancel()
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
    case .createSpace:
      createSpace()
    case .navigateSearch(let direction):
      _ = navigateSearchOnFocusedSurface(direction)
    case .nextTab:
      nextTab()
    case .performBindingActionOnFocusedSurface(let command):
      _ = performBindingActionOnFocusedSurface(command)
    case .performSplitOperation(let tabID, let operation):
      performSplitOperation(operation, in: tabID)
    case .previousTab:
      previousTab()
    case .requestCloseSurface(let surfaceID):
      requestCloseSurface(surfaceID)
    case .requestCloseTab(let tabID):
      requestCloseTab(tabID)
    case .renameSpace(let spaceID, let name):
      renameSpace(spaceID, to: name)
    case .selectLastTab,
      .moveSidebarTab,
      .selectTab,
      .selectTabSlot,
      .selectSpaceSlot,
      .selectSpace,
      .setPinnedTabOrder,
      .setRegularTabOrder,
      .togglePinned,
      .updateWindowActivity,
      .deleteSpace:
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
    case .selectSpaceSlot(let slot):
      selectSpace(slot: slot)
    case .selectSpace(let spaceID):
      selectSpace(spaceID)
    case .moveSidebarTab(let tabID, let pinnedOrder, let regularOrder):
      moveSidebarTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
    case .setPinnedTabOrder(let orderedIDs):
      setPinnedTabOrder(orderedIDs)
    case .setRegularTabOrder(let orderedIDs):
      setRegularTabOrder(orderedIDs)
    case .togglePinned(let tabID):
      togglePinned(tabID)
    case .deleteSpace(let spaceID):
      deleteSpace(spaceID)
    case .updateWindowActivity(let activity):
      updateWindowActivity(activity)
    default:
      return
    }
  }

  var spaces: [TerminalSpaceItem] {
    spaceManager.spaces
  }

  var selectedSpaceID: TerminalSpaceID? {
    spaceManager.selectedSpaceID
  }

  var tabs: [TerminalTabItem] {
    spaceManager.tabs
  }

  var pinnedTabs: [TerminalTabItem] {
    spaceManager.pinnedTabs
  }

  var regularTabs: [TerminalTabItem] {
    spaceManager.regularTabs
  }

  var visibleTabs: [TerminalTabItem] {
    spaceManager.visibleTabs
  }

  var selectedTabID: TerminalTabID? {
    spaceManager.selectedTabID
  }

  var selectedTab: TerminalTabItem? {
    guard let selectedTabID else { return nil }
    return spaceManager.tab(for: selectedTabID)
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

  var selectedPaneDisplayTitle: String {
    Self.selectedPaneDisplayTitle(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree,
      title: { $0.bridge.state.title },
      pwd: { $0.bridge.state.pwd }
    )
  }

  var terminalBackgroundColor: Color {
    Color(nsColor: runtime?.backgroundColor() ?? .windowBackgroundColor)
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
    guard let selectedSpaceID = spaceManager.selectedSpaceID else { return nil }
    return createTab(
      in: selectedSpaceID,
      focusing: focusing,
      initialInput: initialInput,
      inheritingFromSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID()
    )
  }

  @discardableResult
  private func createTab(
    in spaceID: TerminalSpaceID,
    focusing: Bool = true,
    initialInput: String? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil
  ) -> TerminalTabID? {
    guard let tabManager = spaceManager.tabManager(for: spaceID) else { return nil }
    let context: ghostty_surface_context_e =
      tabManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let tabID = tabManager.createTab(
      title: "Terminal \(nextTabIndex(in: spaceID))",
      icon: "terminal"
    )
    let tree = splitTree(
      for: tabID,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      initialInput: initialInput,
      workingDirectory: workingDirectory,
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
    guard let space = spaceManager.space(for: tabID) else { return }
    let didChangeSpace = spaceManager.selectedSpaceID != space.id
    guard spaceManager.selectSpace(space.id) else { return }
    if didChangeSpace {
      persistDefaultSelectedSpaceID(space.id)
    }
    spaceManager.tabManager(for: space.id)?.selectTab(tabID)
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
    spaceManager.activeTabManager?.setPinnedTabOrder(orderedIDs)
  }

  private func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setRegularTabOrder(orderedIDs)
  }

  private func moveSidebarTab(
    _ tabID: TerminalTabID,
    pinnedOrder: [TerminalTabID],
    regularOrder: [TerminalTabID]
  ) {
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .moveTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
  }

  private func togglePinned(_ tabID: TerminalTabID) {
    spaceManager.space(for: tabID).flatMap { spaceManager.tabManager(for: $0.id) }?.togglePinned(tabID)
  }

  private func createSpace() {
    let space = PersistedTerminalSpace(name: spaceManager.nextDefaultSpaceName())
    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = space.id
    updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: updatedSpaceCatalog.defaultSelectedSpaceID,
      spaces: updatedSpaceCatalog.spaces + [space]
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    guard spaceManager.selectSpace(space.id) else { return }
    finalizeSpaceSelectionChange()
  }

  private func selectSpace(_ spaceID: TerminalSpaceID) {
    selectSpace(spaceID, persistDefaultSelection: true)
  }

  private func selectSpace(
    _ spaceID: TerminalSpaceID,
    persistDefaultSelection: Bool
  ) {
    guard spaceManager.selectSpace(spaceID) else { return }
    if persistDefaultSelection {
      persistDefaultSelectedSpaceID(spaceID)
    }
    finalizeSpaceSelectionChange()
  }

  private func selectSpace(slot: Int) {
    let index = slot == 0 ? 9 : slot - 1
    guard spaces.indices.contains(index) else { return }
    selectSpace(spaces[index].id)
  }

  private func renameSpace(_ spaceID: TerminalSpaceID, to name: String) {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedName.isEmpty else { return }
    guard spaceManager.isNameAvailable(normalizedName, excluding: spaceID) else { return }
    guard let index = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[index].name = normalizedName
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  private func deleteSpace(_ spaceID: TerminalSpaceID) {
    let remainingSpaces = spaceCatalog.spaces.filter { $0.id != spaceID }
    guard !remainingSpaces.isEmpty else { return }
    guard remainingSpaces.count != spaceCatalog.spaces.count else { return }

    let nextSelectedSpaceID = nextSelectedSpaceID(afterDeleting: spaceID)
    let updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: nextSelectedSpaceID,
      spaces: remainingSpaces
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    finalizeSpaceSelectionChange()
  }

  func isSpaceNameAvailable(
    _ proposedName: String,
    excluding excludedSpaceID: TerminalSpaceID? = nil
  ) -> Bool {
    spaceManager.isNameAvailable(proposedName, excluding: excludedSpaceID)
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
  private func performBindingActionOnFocusedSurface(_ command: SupatermCommand) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.performBindingAction(command.ghosttyBindingAction)
    return true
  }

  private func updateWindowActivity(_ activity: WindowActivityState) {
    windowActivity = activity
    syncFocus(activity)
  }

  private func syncFocus(_ activity: WindowActivityState) {
    let selectedTabID = spaceManager.selectedTabID
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
      spaces: spaces.enumerated().map { spaceOffset, space in
        let tabs = spaceManager.tabs(in: space.id).enumerated().map { tabOffset, tab in
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
            isSelected: tab.id == spaceManager.selectedTabID(in: space.id),
            panes: panes
          )
        }

        return SupatermTreeSnapshot.Space(
          index: spaceOffset + 1,
          name: space.name,
          isSelected: space.id == selectedSpaceID,
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
      spaces: spaces.enumerated().map { spaceOffset, space in
        let tabs = spaceManager.tabs(in: space.id).enumerated().map { tabOffset, tab in
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
        currentSelectedTabID: spaceManager.selectedTabID
      )
      if let nextSelectedTabID, nextSelectedTabID != spaceManager.selectedTabID {
        if let space = spaceManager.space(for: nextSelectedTabID) {
          _ = spaceManager.selectSpace(space.id)
          spaceManager.tabManager(for: space.id)?.selectTab(nextSelectedTabID)
        }
      }

      if request.focus {
        focusSurface(newSurface, in: resolvedTarget.tabID)
      }

      syncFocus(windowActivity)

      guard
        let spaceIndex = spaceManager.spaceIndex(for: resolvedTarget.spaceID),
        let tabIndex = spaceManager.tabs(in: resolvedTarget.spaceID)
          .firstIndex(where: { $0.id == resolvedTarget.tabID }),
        let paneIndex = newTree.leaves().firstIndex(where: { $0.id == newSurface.id })
      else {
        throw TerminalCreatePaneError.creationFailed
      }
      let selectionState = Self.newPaneSelectionState(
        selectedTabID: spaceManager.selectedTabID,
        targetTabID: resolvedTarget.tabID,
        windowActivity: windowActivity,
        focusedSurfaceID: focusedSurfaceIDByTab[resolvedTarget.tabID],
        surfaceID: newSurface.id
      )

      return SupatermNewPaneResult(
        direction: request.direction,
        isFocused: selectionState.isFocused,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex + 1,
        paneIndex: paneIndex + 1
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

  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    let resolvedTarget = try resolveCreateTabTarget(request.target)
    let currentSelectedSpaceID = spaceManager.selectedSpaceID
    let currentSelectedTabID = spaceManager.selectedTabID
    var createdTabID: TerminalTabID?

    do {
      let tabID =
        createTab(
          in: resolvedTarget.space.id,
          focusing: false,
          initialInput: request.command.map { "\($0)\n" },
          workingDirectory: request.cwd.map { URL(fileURLWithPath: $0, isDirectory: true) },
          inheritingFromSurfaceID: resolvedTarget.inheritedSurfaceID
        )
      guard
        let tabID,
        let tree = trees[tabID],
        let surfaceID = tree.root?.leftmostLeaf().id
      else {
        throw TerminalCreateTabError.creationFailed
      }
      createdTabID = tabID

      let resolvedSelectedTabID = Self.selectedTabID(
        afterCreatingTabIn: resolvedTarget.space.id,
        targetTabID: tabID,
        focusRequested: request.focus,
        currentSelectedSpaceID: currentSelectedSpaceID,
        currentSelectedTabID: currentSelectedTabID
      )
      if let tabManager = spaceManager.tabManager(for: resolvedTarget.space.id),
        resolvedSelectedTabID != tabManager.selectedTabId
      {
        tabManager.selectTab(resolvedSelectedTabID)
      }

      if request.focus {
        if currentSelectedSpaceID != resolvedTarget.space.id {
          selectSpace(resolvedTarget.space.id, persistDefaultSelection: true)
        }
        spaceManager.tabManager(for: resolvedTarget.space.id)?.selectTab(tabID)
        if let surface = surfaces[surfaceID] {
          focusSurface(surface, in: tabID)
        }
      }

      syncFocus(windowActivity)

      guard
        let spaceIndex = spaceManager.spaceIndex(for: resolvedTarget.space.id),
        let tabIndex = spaceManager.tabs(in: resolvedTarget.space.id)
          .firstIndex(where: { $0.id == tabID }),
        let paneIndex = tree.leaves().firstIndex(where: { $0.id == surfaceID })
      else {
        throw TerminalCreateTabError.creationFailed
      }

      let selectionState = Self.newTabSelectionState(
        .init(
          selectedSpaceID: spaceManager.selectedSpaceID,
          targetSpaceID: resolvedTarget.space.id,
          selectedTabID: spaceManager.selectedTabID,
          targetTabID: tabID,
          windowActivity: windowActivity,
          focusedSurfaceID: focusedSurfaceIDByTab[tabID],
          surfaceID: surfaceID
        )
      )

      return .init(
        isFocused: selectionState.isFocused,
        isSelectedSpace: selectionState.isSelectedSpace,
        isSelectedTab: selectionState.isSelectedTab,
        windowIndex: 1,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex + 1,
        paneIndex: paneIndex + 1
      )
    } catch let error as TerminalCreateTabError {
      if let createdTabID {
        removeTree(for: createdTabID)
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw error
    } catch {
      if let createdTabID {
        removeTree(for: createdTabID)
        spaceManager.tabManager(for: resolvedTarget.space.id)?.closeTab(createdTabID)
      }
      throw TerminalCreateTabError.creationFailed
    }
  }

  func splitTree(
    for tabID: TerminalTabID,
    inheritingFromSurfaceID: UUID? = nil,
    initialInput: String? = nil,
    workingDirectory: URL? = nil,
    context: ghostty_surface_context_e = GHOSTTY_SURFACE_CONTEXT_TAB
  ) -> SplitTree<GhosttySurfaceView> {
    if let existing = trees[tabID] {
      return existing
    }
    let surface = createSurface(
      tabID: tabID,
      initialInput: initialInput,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      workingDirectory: workingDirectory,
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
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }

    let shouldCreateReplacement = tabManager.tabs.count == 1
    let inheritedSurfaceID = focusedSurfaceIDByTab[tabID]
    if shouldCreateReplacement {
      _ = spaceManager.selectSpace(space.id)
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
      tabTitleOverrides.removeValue(forKey: tabID)
      spaceManager.space(for: tabID)
        .flatMap { spaceManager.tabManager(for: $0.id) }?
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
    workingDirectory: URL? = nil,
    context: ghostty_surface_context_e
  ) -> GhosttySurfaceView {
    guard let runtime else {
      preconditionFailure("TerminalHostState cannot create surfaces without a GhosttyRuntime")
    }
    let inherited = inheritedSurfaceConfig(fromSurfaceID: inheritingFromSurfaceID, context: context)
    let view = GhosttySurfaceView(
      runtime: runtime,
      tabID: tabID.rawValue,
      workingDirectory: workingDirectory ?? inherited.workingDirectory,
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
    view.bridge.onTabTitleChange = { [weak self] title in
      guard let self else { return false }
      self.setTabTitleOverride(title, for: tabID)
      return true
    }
    view.bridge.onCopyTitleToClipboard = { [weak self] in
      guard let self else { return false }
      return self.copyTitleToClipboard(for: tabID)
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
    guard let selectedTabID = spaceManager.selectedTabID else { return nil }
    return focusedSurfaceIDByTab[selectedTabID]
  }

  private func inheritedSurfaceID(in spaceID: TerminalSpaceID) -> UUID? {
    if let selectedTabID = spaceManager.selectedTabID(in: spaceID) {
      if let focusedSurfaceID = focusedSurfaceIDByTab[selectedTabID], surfaces[focusedSurfaceID] != nil {
        return focusedSurfaceID
      }
      if let surfaceID = trees[selectedTabID]?.root?.leftmostLeaf().id {
        return surfaceID
      }
    }

    for tab in spaceManager.tabs(in: spaceID) {
      if let focusedSurfaceID = focusedSurfaceIDByTab[tab.id], surfaces[focusedSurfaceID] != nil {
        return focusedSurfaceID
      }
      if let surfaceID = trees[tab.id]?.root?.leftmostLeaf().id {
        return surfaceID
      }
    }

    return nil
  }

  private struct ResolvedCreateTabTarget {
    let inheritedSurfaceID: UUID?
    let space: TerminalSpaceItem
  }

  private struct ResolvedCreatePaneTarget {
    let anchorSurface: GhosttySurfaceView
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  private struct ResolvedCreatePaneTab {
    let space: TerminalSpaceItem
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  private func resolveCreateTabTarget(
    _ target: TerminalCreateTabRequest.Target
  ) throws -> ResolvedCreateTabTarget {
    switch target {
    case .contextPane(let paneID):
      guard
        let tabID = tabID(containing: paneID),
        let space = spaceManager.space(for: tabID)
      else {
        throw TerminalCreateTabError.contextPaneNotFound
      }

      return ResolvedCreateTabTarget(
        inheritedSurfaceID: paneID,
        space: space
      )

    case .space(let windowIndex, let spaceIndex):
      guard windowIndex == 1 else {
        throw TerminalCreateTabError.windowNotFound(windowIndex)
      }
      guard let space = spaceManager.space(at: spaceIndex) else {
        throw TerminalCreateTabError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      }
      return ResolvedCreateTabTarget(
        inheritedSurfaceID: inheritedSurfaceID(in: space.id),
        space: space
      )
    }
  }

  private func resolveCreatePaneTarget(
    _ target: TerminalCreatePaneRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let paneID):
      guard
        let tabID = tabID(containing: paneID),
        let space = spaceManager.space(for: tabID),
        let tree = trees[tabID],
        let anchorSurface = surfaces[paneID]
      else {
        throw TerminalCreatePaneError.contextPaneNotFound
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: space.id,
        tabID: tabID,
        tree: tree
      )

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let resolvedTab = try resolveTab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
      let panes = resolvedTab.tree.leaves()
      let paneOffset = paneIndex - 1
      guard panes.indices.contains(paneOffset) else {
        throw TerminalCreatePaneError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: panes[paneOffset],
        spaceID: resolvedTab.space.id,
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
      )

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let resolvedTab = try resolveTab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
      let anchorSurface =
        focusedSurfaceIDByTab[resolvedTab.tabID].flatMap { surfaces[$0] }
        ?? resolvedTab.tree.root?.leftmostLeaf()
      guard let anchorSurface else {
        throw TerminalCreatePaneError.creationFailed
      }

      return ResolvedCreatePaneTarget(
        anchorSurface: anchorSurface,
        spaceID: resolvedTab.space.id,
        tabID: resolvedTab.tabID,
        tree: resolvedTab.tree
      )
    }
  }

  private func resolveSpace(
    windowIndex: Int,
    spaceIndex: Int
  ) throws -> TerminalSpaceItem {
    guard windowIndex == 1 else {
      throw TerminalCreatePaneError.windowNotFound(windowIndex)
    }
    guard let space = spaceManager.space(at: spaceIndex) else {
      throw TerminalCreatePaneError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
    }
    return space
  }

  private func resolveTab(
    windowIndex: Int,
    spaceIndex: Int,
    tabIndex: Int
  ) throws -> ResolvedCreatePaneTab {
    let space = try resolveSpace(windowIndex: windowIndex, spaceIndex: spaceIndex)
    let tabs = spaceManager.tabs(in: space.id)
    let tabOffset = tabIndex - 1
    guard tabs.indices.contains(tabOffset) else {
      throw TerminalCreatePaneError.tabNotFound(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex
      )
    }

    let tabID = tabs[tabOffset].id
    guard let tree = trees[tabID] else {
      throw TerminalCreatePaneError.creationFailed
    }

    return .init(space: space, tabID: tabID, tree: tree)
  }

  private func updateTabTitle(for tabID: TerminalTabID) {
    let resolvedTitle = currentTabTitle(for: tabID)
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
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
    guard tabID == spaceManager.selectedTabID else { return }
    let fromSurface = previousSurface === surface ? nil : previousSurface
    GhosttySurfaceView.moveFocus(to: surface, from: fromSurface)
    emitFocusChangedIfNeeded(surface.id)
  }

  static func selectedTabID(
    afterCreatingTabIn targetSpaceID: TerminalSpaceID,
    targetTabID: TerminalTabID,
    focusRequested: Bool,
    currentSelectedSpaceID: TerminalSpaceID?,
    currentSelectedTabID: TerminalTabID?
  ) -> TerminalTabID {
    guard !focusRequested else { return targetTabID }
    guard currentSelectedSpaceID == targetSpaceID, let currentSelectedTabID else {
      return targetTabID
    }
    return currentSelectedTabID
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

  static func newTabSelectionState(_ input: NewTabSelectionInput) -> NewTabSelectionState {
    let isSelectedSpace = input.targetSpaceID == input.selectedSpaceID
    let isSelectedTab = isSelectedSpace && input.targetTabID == input.selectedTabID
    let activity = surfaceActivity(
      isSelectedTab: isSelectedTab,
      windowIsVisible: input.windowActivity.isVisible,
      windowIsKey: input.windowActivity.isKeyWindow,
      focusedSurfaceID: input.focusedSurfaceID,
      surfaceID: input.surfaceID
    )
    return NewTabSelectionState(
      isFocused: activity.isFocused,
      isSelectedSpace: isSelectedSpace,
      isSelectedTab: isSelectedTab
    )
  }

  private func removeTree(for tabID: TerminalTabID) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    for surface in tree.leaves() {
      surface.closeSurface()
      surfaces.removeValue(forKey: surface.id)
    }
    focusedSurfaceIDByTab.removeValue(forKey: tabID)
    tabTitleOverrides.removeValue(forKey: tabID)
  }

  private func updateRunningState(for tabID: TerminalTabID) {
    guard let tree = trees[tabID] else { return }
    let isRunning = tree.leaves().contains { surface in
      Self.isRunning(progressState: surface.bridge.state.progressState)
    }
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .updateDirty(tabID, isDirty: isRunning)
  }

  private func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains(where: \.needsCloseConfirmation)
  }

  func windowNeedsCloseConfirmation() -> Bool {
    if let runtime {
      return runtime.needsConfirmQuit()
    }
    return trees.values.contains { tree in
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

  private func nextTabIndex(in spaceID: TerminalSpaceID) -> Int {
    var maxIndex = 0
    for tab in spaceManager.tabs(in: spaceID) {
      guard tab.title.hasPrefix("Terminal ") else { continue }
      let suffix = tab.title.dropFirst("Terminal ".count)
      guard let value = Int(suffix) else { continue }
      maxIndex = max(maxIndex, value)
    }
    return maxIndex + 1
  }

  private func fallbackTitle(for tabID: TerminalTabID) -> String {
    spaceManager.tab(for: tabID)?.defaultTitle ?? "Terminal"
  }

  private func setTabTitleOverride(_ title: String?, for tabID: TerminalTabID) {
    if let title {
      tabTitleOverrides[tabID] = title
    } else {
      tabTitleOverrides.removeValue(forKey: tabID)
    }
    updateTabTitle(for: tabID)
  }

  private func copyTitleToClipboard(for tabID: TerminalTabID) -> Bool {
    let title = currentTabTitle(for: tabID).trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty else { return false }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    return pasteboard.setString(title, forType: .string)
  }

  private func currentTabTitle(for tabID: TerminalTabID) -> String {
    if let title = tabTitleOverrides[tabID] {
      return title
    }
    let fallbackTitle = fallbackTitle(for: tabID)
    guard let surface = titleSurface(for: tabID) else {
      return fallbackTitle
    }
    return surface.resolvedDisplayTitle(defaultValue: fallbackTitle)
  }

  private func titleSurface(for tabID: TerminalTabID) -> GhosttySurfaceView? {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID] {
      return surfaces[focusedSurfaceID]
    }
    return trees[tabID]?.root?.leftmostLeaf()
  }

  private func observeSpaceCatalog() {
    spaceCatalogObservationTask?.cancel()
    spaceCatalogObservationTask = Task { @MainActor [weak self] in
      let observations = Observations { [weak self] in
        self?.spaceCatalog ?? .default
      }
      for await spaceCatalog in observations {
        guard let self else { return }
        self.applyObservedSpaceCatalog(spaceCatalog)
      }
    }
  }

  private func applyObservedSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard resolvedSpaceCatalog != lastAppliedSpaceCatalog else { return }

    let previousSelectedSpaceID = selectedSpaceID
    lastAppliedSpaceCatalog = resolvedSpaceCatalog
    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs)

    if previousSelectedSpaceID != selectedSpaceID {
      finalizeSpaceSelectionChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
    }
  }

  @discardableResult
  private func writeSpaceCatalog(
    _ spaceCatalog: TerminalSpaceCatalog
  ) -> TerminalSpaceManager.SpaceCatalogDiff {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    replaceSpaceCatalog(resolvedSpaceCatalog)
    lastAppliedSpaceCatalog = resolvedSpaceCatalog

    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs)
    return diff
  }

  private func persistDefaultSelectedSpaceID(_ spaceID: TerminalSpaceID) {
    guard spaceCatalog.defaultSelectedSpaceID != spaceID else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = spaceID
    replaceSpaceCatalog(updatedSpaceCatalog)
    lastAppliedSpaceCatalog = updatedSpaceCatalog
  }

  private func replaceSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = spaceCatalog }
  }

  private func nextSelectedSpaceID(afterDeleting spaceID: TerminalSpaceID) -> TerminalSpaceID {
    let remainingSpaces = spaces.filter { $0.id != spaceID }
    precondition(!remainingSpaces.isEmpty)

    if let selectedSpaceID,
      selectedSpaceID != spaceID,
      remainingSpaces.contains(where: { $0.id == selectedSpaceID })
    {
      return selectedSpaceID
    }

    if let deletedIndex = spaces.firstIndex(where: { $0.id == spaceID }) {
      for space in spaces[..<deletedIndex].reversed()
      where remainingSpaces.contains(where: { $0.id == space.id }) {
        return space.id
      }
    }

    return remainingSpaces[0].id
  }

  private func finalizeSpaceSelectionChange() {
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

  static func selectedPaneDisplayTitle<Surface: NSView & Identifiable>(
    focusedSurfaceID: UUID?,
    in tree: SplitTree<Surface>?,
    title: (Surface) -> String?,
    pwd: (Surface) -> String?
  ) -> String where Surface.ID == UUID {
    let leaves = tree?.leaves() ?? []
    guard let surface = focusedSurfaceID.flatMap({ id in leaves.first(where: { $0.id == id }) }) ?? leaves.first
    else {
      return "Pane"
    }
    return resolvedPaneDisplayTitle(
      title: title(surface),
      pwd: pwd(surface),
      defaultValue: paneFallbackTitle(for: surface.id, in: tree)
    )
  }

  static func resolvedPaneDisplayTitle(
    title: String?,
    pwd: String?,
    defaultValue: String
  ) -> String {
    if let title = trimmedNonEmpty(title) {
      return title
    }
    if let pwd = trimmedNonEmpty(pwd) {
      return pwd
    }
    return defaultValue
  }

  static func paneFallbackTitle<Surface: NSView & Identifiable>(
    for surfaceID: UUID?,
    in tree: SplitTree<Surface>?
  ) -> String where Surface.ID == UUID {
    let leaves = tree?.leaves() ?? []
    guard !leaves.isEmpty else { return "Pane" }
    if let surfaceID, let index = leaves.firstIndex(where: { $0.id == surfaceID }) {
      return "Pane \(index + 1)"
    }
    return "Pane 1"
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
    TerminalHostState.resolvedPaneDisplayTitle(
      title: bridge.state.title,
      pwd: bridge.state.pwd,
      defaultValue: defaultValue
    )
  }
}
