import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore
import SwiftUI

func normalizedTerminalAgentDetail(_ detail: String?) -> String? {
  guard let detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines), !detail.isEmpty
  else {
    return nil
  }
  return detail
}

nonisolated enum TerminalSurfaceCloseSource: String, Sendable {
  case commandCloseSurface = "command.closeSurface"
  case commandRequestCloseSurface = "command.requestCloseSurface"
  case controlClosePane = "control.closePane"
  case ghosttyChildExit = "ghostty.childExit"
  case ghosttyCloseSurfaceCallback = "ghostty.closeSurfaceCallback"
}

nonisolated enum TerminalTreeRemovalSource: String, Sendable {
  case closeTab = "closeTab"
  case controlCleanup = "control.cleanup"
  case pinnedLastPaneClose = "pinned.lastPaneClose"
  case pinnedReconcile = "pinned.reconcile"
  case pinnedSuspend = "pinned.suspend"
  case sessionClear = "session.clear"
  case spaceCatalogObserved = "spaceCatalog.observed"
  case spaceCatalogWrite = "spaceCatalog.write"
}

nonisolated struct TerminalClosePerformLogContext: Sendable {
  let source: TerminalSurfaceCloseSource
  let surfaceID: UUID
  let tabID: TerminalTabID
  let spaceID: TerminalSpaceID?
  let wasPinned: Bool
  let leafCount: Int
  let newTreeEmpty: Bool
  let focusedSurfaceID: UUID?
  let nextSurfaceID: UUID?
}

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

  struct SurfaceActivity: Equatable {
    let isVisible: Bool
    let isFocused: Bool
  }

  enum ResolvedCloseRequest: Equatable {
    case request(TerminalCloseRequest)
    case window(needsConfirmation: Bool)

    var closesWindow: Bool {
      if case .window = self { return true }
      return false
    }
  }

  struct SidebarNotificationPresentation: Equatable, Sendable {
    let previewText: String
  }

  struct PaneNotification: Equatable, Sendable {
    var attentionState: SupatermNotificationAttentionState?
    var body: String
    let createdAt: Date
    var title: String
    let origin: NotificationOrigin

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      title: String
    ) {
      self.init(
        attentionState: attentionState,
        body: body,
        createdAt: createdAt,
        title: title,
        origin: .generic
      )
    }

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      title: String,
      origin: NotificationOrigin
    ) {
      self.attentionState = attentionState
      self.body = body
      self.createdAt = createdAt
      self.title = title
      self.origin = origin
    }
  }

  enum NotificationSemantic: Equatable, Sendable {
    case completion
    case attention
  }

  enum NotificationOrigin: Equatable, Sendable {
    case structuredAgent(NotificationSemantic)
    case terminalDesktop
    case generic
  }

  struct RecentStructuredNotification: Equatable, Sendable {
    let recordedAt: Date
    let semantic: NotificationSemantic
    let text: String
  }

  enum AgentActivityTone: Equatable, Sendable {
    case attention
    case active
    case muted
  }

  struct AgentActivity: Equatable, Sendable {
    let kind: SupatermAgentKind
    let phase: AgentActivityPhase
    let detail: String?

    init(
      kind: SupatermAgentKind,
      phase: AgentActivityPhase,
      detail: String? = nil
    ) {
      self.kind = kind
      self.phase = phase
      self.detail = normalizedTerminalAgentDetail(detail)
    }

    static func claude(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(kind: .claude, phase: phase, detail: detail)
    }

    static func codex(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(kind: .codex, phase: phase, detail: detail)
    }

    var tone: AgentActivityTone {
      switch phase {
      case .needsInput:
        return .attention
      case .running:
        return .active
      case .idle:
        return .muted
      }
    }

    var showsLeadingIndicator: Bool {
      switch phase {
      case .needsInput, .running:
        return true
      case .idle:
        return false
      }
    }
  }

  struct PaneAgentMetadata: Equatable, Sendable {
    var branchDetails: PaneAgentBranchDetails?
    var artifacts: [PaneAgentArtifact] = []

    var isEmpty: Bool {
      branchDetails == nil && artifacts.isEmpty
    }

    func panelPresentation(
      progressRows: [PaneAgentProgressRow] = [],
      activeChildren: [TerminalAgentActiveChild] = [],
      session: PaneAgentPanelSession? = nil
    ) -> PaneAgentPanelPresentation {
      PaneAgentPanelPresentation(
        progressRows: progressRows,
        activeChildren: activeChildren,
        branchDetails: branchDetails,
        artifacts: artifacts,
        session: session
      )
    }
  }

  struct TabAgentPresentation: Equatable, Sendable {
    let badgeActivities: [AgentActivity]
    let badgeActivity: AgentActivity?
    let badgeActivityIsFocused: Bool
    let detailActivity: AgentActivity?
    let hoverMarkdown: String?
  }

  struct AgentStateInstance: Equatable, Sendable {
    let presentation: TerminalAgentStatePresentation
    let revision: Int
    let surfaceID: UUID

    var activity: AgentActivity {
      AgentActivity(
        kind: presentation.agent,
        phase: presentation.phase,
        detail: presentation.detail
      )
    }
  }

  struct FocusHistory: Equatable {
    var current: UUID
    var previous: UUID?

    init(current: UUID) {
      self.current = current
    }

    mutating func updateCurrent(_ surfaceID: UUID) {
      guard surfaceID != current else { return }
      previous = current
      current = surfaceID
    }
  }

  struct SurfaceLaunchCommand: Equatable {
    let command: String?
    let commandWrapper: [String]
    let usesZmx: Bool
  }

  @ObservationIgnored
  let runtime: GhosttyRuntime?
  @ObservationIgnored
  let managesTerminalSurfaces: Bool
  @ObservationIgnored
  let zmxClient: ZmxClient
  @ObservationIgnored
  let zmxSessionsEnabled: Bool
  @ObservationIgnored
  @Shared(.supatermSettings)
  var supatermSettings = .default
  @ObservationIgnored
  var eventContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  @ObservationIgnored
  @Shared(.terminalSpaceCatalog)
  var spaceCatalog = TerminalSpaceCatalog.default
  @ObservationIgnored
  var spaceCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  @Shared(.terminalPinnedTabCatalog)
  var pinnedTabCatalog = TerminalPinnedTabCatalog.default
  @ObservationIgnored
  var pinnedTabCatalogObservationTask: Task<Void, Never>?
  @ObservationIgnored
  var runtimeConfigObserver: NSObjectProtocol?
  @ObservationIgnored
  var lastAppliedSpaceCatalog = TerminalSpaceCatalog.default
  @ObservationIgnored
  var lastAppliedPinnedTabCatalog = TerminalPinnedTabCatalog.default
  @ObservationIgnored
  var onSessionChange: @MainActor () -> Void = {}
  @ObservationIgnored
  var onSurfaceCommandFinished: @MainActor (UUID) -> Void = { _ in }
  @ObservationIgnored
  var onSurfaceRemoved: @MainActor (UUID) -> Void = { _ in }
  @ObservationIgnored
  var agentPanelController: TerminalAgentPanelController?
  let spaceManager = TerminalSpaceManager()

  var pendingEvents: [TerminalClient.Event] = []
  var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  var surfaces: [UUID: GhosttySurfaceView] = [:]
  var focusHistoryByTab: [TerminalTabID: FocusHistory] = [:]
  var notificationStore = TerminalNotificationStore()
  var paneAgentMetadataBySurfaceID: [UUID: PaneAgentMetadata] = [:]
  var agentStateStore = TerminalAgentStateStore()
  var previousSelectedTabIDBySpace: [TerminalSpaceID: TerminalTabID] = [:]
  var previousSelectedSpaceID: TerminalSpaceID?
  var lastEmittedFocusSurfaceID: UUID?
  var runtimeConfigGeneration = 0
  var suppressesSessionChanges = 0

  var windowActivity = WindowActivityState.inactive

  init(
    runtime: GhosttyRuntime? = nil,
    managesTerminalSurfaces: Bool = true,
    zmxClient: ZmxClient = .live,
    zmxSessionsEnabled: Bool = true
  ) {
    self.managesTerminalSurfaces = managesTerminalSurfaces
    self.runtime = managesTerminalSurfaces ? (runtime ?? GhosttyRuntime()) : runtime
    self.zmxClient = zmxClient
    self.zmxSessionsEnabled = zmxSessionsEnabled

    let initialSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    if initialSpaceCatalog != spaceCatalog {
      replaceSpaceCatalog(initialSpaceCatalog)
    }
    lastAppliedSpaceCatalog = initialSpaceCatalog
    spaceManager.bootstrap(
      from: initialSpaceCatalog,
      initialSelectedSpaceID: initialSpaceCatalog.defaultSelectedSpaceID
    )
    let initialPinnedTabCatalog = sanitizedPinnedTabCatalog(pinnedTabCatalog)
    if initialPinnedTabCatalog != pinnedTabCatalog {
      replacePinnedTabCatalog(initialPinnedTabCatalog)
    }
    lastAppliedPinnedTabCatalog = initialPinnedTabCatalog
    reconcilePinnedTabs(with: initialPinnedTabCatalog)
    observeRuntimeConfig()
    observeSpaceCatalog()
    observePinnedTabCatalog()
    agentPanelController = TerminalAgentPanelController(terminal: self)
  }

  isolated deinit {
    spaceCatalogObservationTask?.cancel()
    pinnedTabCatalogObservationTask?.cancel()
    agentPanelController?.stop()
    if let runtimeConfigObserver {
      NotificationCenter.default.removeObserver(runtimeConfigObserver)
    }
  }

  func observeRuntimeConfig() {
    guard let runtime else { return }
    if let runtimeConfigObserver {
      NotificationCenter.default.removeObserver(runtimeConfigObserver)
    }
    runtimeConfigObserver = NotificationCenter.default.addObserver(
      forName: .ghosttyRuntimeConfigDidChange,
      object: runtime,
      queue: .main
    ) { [weak self] _ in
      MainActor.assumeIsolated {
        self?.runtimeConfigGeneration &+= 1
      }
    }
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
    case .closeSurface,
      .closeTab,
      .closeTabs,
      .requestCloseSurface,
      .requestCloseTab,
      .requestCloseTabsBelow,
      .requestCloseOtherTabs:
      handleCloseCommand(command)
    case .createTab,
      .ensureInitialTab,
      .createSpace:
      handleCreationCommand(command)
    case .navigateSearch,
      .nextTab,
      .performGhosttyBindingActionOnFocusedSurface,
      .performBindingActionOnFocusedSurface,
      .performSplitOperation,
      .previousTab,
      .renameSpace:
      handleInteractionCommand(command)
    case .nextSpace,
      .previousSpace,
      .selectLastTab,
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

  func handleCloseCommand(_ command: TerminalClient.Command) {
    switch command {
    case .closeSurface(let surfaceID):
      closeSurface(surfaceID)
    case .closeTab(let tabID):
      closeTab(tabID)
    case .closeTabs(let tabIDs):
      closeTabs(tabIDs)
    case .requestCloseSurface(let surfaceID):
      requestCloseSurface(surfaceID)
    case .requestCloseTab(let tabID):
      requestCloseTab(tabID)
    case .requestCloseTabsBelow(let tabID):
      requestCloseTabsBelow(tabID)
    case .requestCloseOtherTabs(let tabID):
      requestCloseOtherTabs(tabID)
    default:
      return
    }
  }

  func handleCreationCommand(_ command: TerminalClient.Command) {
    switch command {
    case .createTab(let inheritingFromSurfaceID):
      _ = createTab(inheritingFromSurfaceID: inheritingFromSurfaceID)
    case .ensureInitialTab(let focusing, let startupCommand, let workingDirectoryPath):
      ensureInitialTab(
        focusing: focusing,
        startupCommand: startupCommand,
        workingDirectoryPath: workingDirectoryPath
      )
    case .createSpace(let name):
      _ = try? createSpace(named: name)
    default:
      return
    }
  }

  func handleInteractionCommand(_ command: TerminalClient.Command) {
    switch command {
    case .navigateSearch(let direction):
      _ = navigateSearchOnFocusedSurface(direction)
    case .nextTab:
      nextTab()
    case .performGhosttyBindingActionOnFocusedSurface(let action):
      _ = performGhosttyBindingActionOnFocusedSurface(action)
    case .performBindingActionOnFocusedSurface(let command):
      _ = performBindingActionOnFocusedSurface(command)
    case .performSplitOperation(let tabID, let operation):
      performSplitOperation(operation, in: tabID)
    case .previousTab:
      previousTab()
    case .renameSpace(let spaceID, let name):
      renameSpace(spaceID, to: name)
    default:
      return
    }
  }

  func handleSelectionCommand(_ command: TerminalClient.Command) {
    switch command {
    case .selectLastTab:
      selectLastTab()
    case .nextSpace:
      nextSpace()
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
    case .previousSpace:
      previousSpace()
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

  func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setPinnedTabOrder(orderedIDs)
    if let selectedSpaceID {
      syncPinnedTabMembership(in: selectedSpaceID)
    }
    sessionDidChange()
  }

  func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setRegularTabOrder(orderedIDs)
    sessionDidChange()
  }

  func moveSidebarTab(
    _ tabID: TerminalTabID,
    pinnedOrder: [TerminalTabID],
    regularOrder: [TerminalTabID]
  ) {
    guard let spaceID = spaceManager.space(for: tabID)?.id else { return }
    spaceManager.tabManager(for: spaceID)?
      .moveTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
    syncPinnedTabMembership(in: spaceID)
    sessionDidChange()
  }

  func togglePinned(_ tabID: TerminalTabID) {
    guard let spaceID = spaceManager.space(for: tabID)?.id else { return }
    if spaceManager.tab(for: tabID)?.isPinned == true, trees[tabID] == nil {
      let wasSelectedSpace = selectedSpaceID == spaceID
      spaceManager.tabManager(for: spaceID)?.closeTab(tabID)
      updateSelectionAfterClosingTab(in: spaceID, wasSelectedSpace: wasSelectedSpace)
    } else {
      spaceManager.tabManager(for: spaceID)?.togglePinned(tabID)
    }
    syncPinnedTabMembership(in: spaceID)
    sessionDidChange()
  }

  @discardableResult
  func navigateSearchOnFocusedSurface(_ direction: GhosttySearchDirection) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.navigateSearch(direction)
    return true
  }

  @discardableResult
  func performBindingActionOnFocusedSurface(_ command: SupatermCommand) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.performBindingAction(command.ghosttyBindingAction)
    return true
  }

  @discardableResult
  func performGhosttyBindingActionOnFocusedSurface(_ action: String) -> Bool {
    guard let surface = selectedSurfaceView else { return false }
    surface.performBindingAction(action)
    return true
  }

  func updateWindowActivity(_ activity: WindowActivityState) {
    let selectedTabID = selectedTabID
    let focusedSurfaceID = selectedTabID.flatMap { focusHistoryByTab[$0]?.current }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.windowActivity.update",
      fields: [
        "isKeyWindow=\(activity.isKeyWindow)",
        "isVisible=\(activity.isVisible)",
        "selectedSpaceID=\(SupatermLog.uuid(selectedSpaceID?.rawValue))",
        "selectedTabID=\(SupatermLog.uuid(selectedTabID?.rawValue))",
        "focusedSurfaceID=\(SupatermLog.uuid(focusedSurfaceID))",
      ]
    )
    windowActivity = activity
    syncFocus(activity)
    clearUnreadOnFocusedSurfaceIfNeeded()
  }

  func syncFocus(_ activity: WindowActivityState) {
    let selectedTabID = spaceManager.selectedTabID
    var surfaceToFocus: GhosttySurfaceView?

    for (tabID, tree) in trees {
      let focusedSurfaceID = focusHistoryByTab[tabID]?.current
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

    if let surfaceToFocus,
      let window = surfaceToFocus.window,
      Self.shouldRestoreSurfaceFirstResponder(window.firstResponder, to: surfaceToFocus)
    {
      window.makeFirstResponder(surfaceToFocus)
    }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.focus.sync",
      fields: [
        "isKeyWindow=\(activity.isKeyWindow)",
        "isVisible=\(activity.isVisible)",
        "selectedTabID=\(SupatermLog.uuid(selectedTabID?.rawValue))",
        "focusedSurfaceID=\(SupatermLog.uuid(surfaceToFocus?.id))",
      ]
    )
  }

  static func shouldRestoreSurfaceFirstResponder(
    _ responder: NSResponder?,
    to surface: GhosttySurfaceView
  ) -> Bool {
    guard let responder else { return true }
    if responder === surface { return true }
    if responder is GhosttySurfaceView { return true }
    if responder is NSText { return false }
    if responder is NSControl { return false }
    guard let view = responder as? NSView else { return false }
    return view.window === surface.window
  }

  func splitTree(
    for tabID: TerminalTabID,
    inheritingFromSurfaceID: UUID? = nil,
    startupCommand: String? = nil,
    workingDirectory: URL? = nil,
    context: ghostty_surface_context_e = GHOSTTY_SURFACE_CONTEXT_TAB
  ) -> SplitTree<GhosttySurfaceView> {
    if let existing = trees[tabID] {
      return existing
    }
    let surface = createSurface(
      tabID: tabID,
      startupCommand: startupCommand,
      inheritingFromSurfaceID: inheritingFromSurfaceID,
      workingDirectory: workingDirectory,
      context: context
    )
    let tree = SplitTree(view: surface)
    trees[tabID] = tree
    applyFocusedSurface(surface.id, in: tabID)
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
        startupCommand: nil,
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
        sessionDidChange()
        return true
      } catch {
        killZmxSession(for: newSurface.id)
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
        let newZoomed =
          runtime?.splitPreserveZoomOnNavigation() == true
          ? tree.root?.node(view: nextSurface)
          : nil
        tree = tree.settingZoomed(newZoomed)
        trees[tabID] = tree
      }
      focusSurface(nextSurface, in: tabID)
      sessionDidChange()
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
        sessionDidChange()
        return true
      } catch {
        return false
      }

    case .equalizeSplits:
      trees[tabID] = tree.equalized()
      sessionDidChange()
      return true

    case .toggleSplitZoom:
      guard tree.isSplit else { return false }
      let newZoomed = tree.zoomed == targetNode ? nil : targetNode
      trees[tabID] = tree.settingZoomed(newZoomed)
      focusSurface(targetSurface, in: tabID)
      return true
    }
  }

  func performSplitOperation(
    _ operation: TerminalSplitTreeView.Operation, in tabID: TerminalTabID
  ) {
    guard var tree = trees[tabID] else { return }

    switch operation {
    case .resize(let node, let ratio):
      let resizedNode = node.resizing(to: ratio)
      do {
        tree = try tree.replacing(node: node, with: resizedNode)
        trees[tabID] = tree
        sessionDidChange()
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
        sessionDidChange()
      } catch {
        return
      }

    case .equalize:
      trees[tabID] = tree.equalized()
      sessionDidChange()

    case .agentPanelCopyBranchName,
      .agentPanelCopySessionID,
      .agentPanelForkSessionRequested,
      .agentPanelVisibilityToggled,
      .agentPanelURLTapped:
      break
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

  func performCloseTab(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    let wasPinned = spaceManager.tab(for: tabID)?.isPinned == true
    let wasSelectedSpace = selectedSpaceID == space.id
    let dormantPinnedSurfaceIDs =
      wasPinned && trees[tabID] == nil
      ? Array(pinnedTabCatalog.tabs(in: space.id).first(where: { $0.id == tabID })?.session.surfaceIDs ?? [])
      : []

    if wasPinned {
      removePinnedTabFromCatalog(tabID, in: space.id)
    }

    removeTree(for: tabID, source: .closeTab)
    if !dormantPinnedSurfaceIDs.isEmpty {
      killZmxSessions(for: dormantPinnedSurfaceIDs)
    }
    tabManager.closeTab(tabID)
    updateSelectionAfterClosingTab(in: space.id, wasSelectedSpace: wasSelectedSpace)
    syncFocus(windowActivity)
    sessionDidChange()
  }

  func performCloseTabs(_ tabIDs: [TerminalTabID]) {
    guard !tabIDs.isEmpty else { return }
    withBatchedSessionChange {
      for tabID in tabIDs {
        performCloseTab(tabID)
      }
    }
  }

  static func surfaceContextLabel(_ context: ghostty_surface_context_e) -> String {
    switch context {
    case GHOSTTY_SURFACE_CONTEXT_WINDOW:
      return "window"
    case GHOSTTY_SURFACE_CONTEXT_TAB:
      return "tab"
    case GHOSTTY_SURFACE_CONTEXT_SPLIT:
      return "split"
    default:
      return String(Int(context.rawValue))
    }
  }

  func configureBridgeCallbacks(
    for view: GhosttySurfaceView,
    tabID: TerminalTabID
  ) {
    view.bridge.onTitleChange = { [weak self] _ in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
      self.sessionDidChange()
    }
    view.bridge.onPathChange = { [weak self] in
      guard let self else { return }
      self.updateTabTitle(for: tabID)
      self.persistPinnedTabWorkingDirectoriesIfNeeded(for: tabID)
      self.agentPanelController?.surfacePathChanged(view.id)
      self.sessionDidChange()
    }
    view.bridge.onTabTitleChange = { [weak self] title in
      guard let self else { return false }
      self.setLockedTabTitle(title, for: tabID)
      return true
    }
    view.bridge.onPromptTabTitle = { [weak self, weak view] in
      guard let self, let view else { return }
      self.promptTabTitle(for: tabID, using: view)
    }
    view.bridge.onCopyTitleToClipboard = { [weak self, weak view] in
      guard let self, let view else { return false }
      return self.copyTitleToClipboard(for: view.id)
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
    view.bridge.onCommandPaletteToggle = { [weak self] in
      guard let self else { return false }
      self.emit(.commandPaletteToggleRequested)
      return true
    }
    view.bridge.onProgressReport = { [weak self] _ in
      guard let self else { return }
      self.updateRunningState(for: tabID)
    }
    view.bridge.onCommandFinished = { [weak self, weak view] in
      guard let self, let view else { return }
      self.handleCommandFinished(for: view.id)
    }
    configureBridgeCloseCallbacks(for: view)
    view.bridge.onDesktopNotification = { [weak self, weak view] title, body in
      guard let self, let view else { return }
      self.handleDesktopNotification(
        body: body,
        surfaceID: view.id,
        title: title
      )
    }
  }

  func handleCommandFinished(for surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    let removedAgentState = clearAgentState(for: surfaceID)
    let hadAgentMetadata = paneAgentMetadataBySurfaceID[surfaceID]?.isEmpty == false
    _ = clearAgentPanelMetadata(for: surfaceID)
    agentPanelController?.surfaceCommandFinished(surfaceID)
    onSurfaceCommandFinished(surfaceID)
    if hadAgentMetadata || removedAgentState {
      sessionDidChange()
    }
  }

  func configureBridgeCloseCallbacks(for view: GhosttySurfaceView) {
    view.bridge.onChildExited = { [weak self, weak view] in
      guard let self, let view else { return false }
      self.requestCloseSurfaceAfterProcessExit(
        view.id,
        source: .ghosttyChildExit
      )
      return true
    }
    view.bridge.onCloseRequest = { [weak self, weak view] processAlive in
      guard let self, let view else { return }
      guard !processAlive else {
        self.requestCloseSurface(
          view.id,
          needsConfirmation: true,
          source: .ghosttyCloseSurfaceCallback
        )
        return
      }
      self.requestCloseSurfaceAfterProcessExit(
        view.id,
        source: .ghosttyCloseSurfaceCallback
      )
    }
  }

  func configureSurfaceCallbacks(
    for view: GhosttySurfaceView,
    tabID: TerminalTabID
  ) {
    view.onDirectInteraction = { [weak self, weak view] in
      guard let self, let view else { return }
      self.handleDirectInteraction(on: view.id)
    }
    view.onFocusChange = { [weak self, weak view] focused in
      guard let self, let view, focused else { return }
      self.applyFocusedSurface(view.id, in: tabID)
      self.updateTabTitle(for: tabID)
      self.updateRunningState(for: tabID)
      self.clearNotificationAttention(for: view.id)
      self.emitFocusChangedIfNeeded(view.id)
      self.agentPanelController?.surfaceFocused(view.id)
      self.sessionDidChange()
    }
  }

  struct InheritedSurfaceConfig: Equatable {
    let workingDirectory: URL?
    let fontSize: Float32?
  }

  struct ResolvedCreateTabTarget {
    let inheritedSurfaceID: UUID?
    let space: TerminalSpaceItem
  }

  struct ResolvedLocalCreateTabTarget {
    let inheritedSurfaceID: UUID?
    let spaceID: TerminalSpaceID
  }

  struct ResolvedCreatePaneTarget {
    let anchorSurface: GhosttySurfaceView
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  struct ResolvedTabItemTarget {
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
  }

  struct ResolvedCreatePaneTab {
    let space: TerminalSpaceItem
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  struct ResolvedPaneLocation {
    let paneIndex: Int
    let spaceIndex: Int
    let tabIndex: Int
  }

  func resolveNotifyTarget(
    _ target: TerminalNotifyRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let paneID):
      return try resolveCreatePaneTarget(.contextPane(paneID))
    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return try resolveCreatePaneTarget(
        .pane(
          windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex
        )
      )
    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      return try resolveCreatePaneTarget(
        .tab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
    }
  }

  func resolveSpace(
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

  func resolveTab(
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

    return ResolvedCreatePaneTab(space: space, tabID: tabID, tree: tree)
  }

  func resolvedPaneLocation(
    spaceID: TerminalSpaceID,
    tabID: TerminalTabID,
    surfaceID: UUID,
    tree: SplitTree<GhosttySurfaceView>
  ) throws -> ResolvedPaneLocation {
    guard
      let spaceIndex = spaceManager.spaceIndex(for: spaceID),
      let tabIndex = spaceManager.tabs(in: spaceID).firstIndex(where: { $0.id == tabID }),
      let paneIndex = tree.leaves().firstIndex(where: { $0.id == surfaceID })
    else {
      throw TerminalCreatePaneError.creationFailed
    }

    return ResolvedPaneLocation(
      paneIndex: paneIndex + 1,
      spaceIndex: spaceIndex,
      tabIndex: tabIndex + 1
    )
  }

  func updateTabTitle(for tabID: TerminalTabID) {
    let resolvedTitle = currentTabTitle(for: tabID)
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .updateTitle(tabID, title: resolvedTitle)
  }

  func focusSurface(in tabID: TerminalTabID) {
    restorePinnedTabSessionIfNeeded(for: tabID)
    if let unreadSurfaceID = latestUnreadNotifiedSurfaceID(in: tabID),
      let surface = surfaces[unreadSurfaceID]
    {
      focusSurface(surface, in: tabID)
      return
    }
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current, let surface = surfaces[focusedSurfaceID] {
      focusSurface(surface, in: tabID)
      return
    }
    let tree = splitTree(for: tabID)
    if let surface = tree.root?.leftmostLeaf() {
      focusSurface(surface, in: tabID)
    }
  }

  func applyFocusedSurface(
    _ surfaceID: UUID,
    in tabID: TerminalTabID
  ) {
    focusHistoryByTab[tabID, default: FocusHistory(current: surfaceID)].updateCurrent(surfaceID)
  }

  func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
    let previousSurface = focusHistoryByTab[tabID].flatMap { surfaces[$0.current] }
    applyFocusedSurface(surface.id, in: tabID)
    updateTabTitle(for: tabID)
    clearNotificationAttention(for: surface.id)
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

  static func shouldSyncFocusDuringTabCreation(
    targetSpaceID: TerminalSpaceID,
    focusRequested: Bool,
    currentSelectedSpaceID: TerminalSpaceID?
  ) -> Bool {
    focusRequested || currentSelectedSpaceID != targetSpaceID
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

  func notifications(for tabID: TerminalTabID) -> [UUID: [PaneNotification]] {
    guard let tree = trees[tabID] else { return [:] }
    return Dictionary(
      uniqueKeysWithValues: tree.leaves().compactMap { surface in
        notificationStore.notifications(for: surface.id).map { (surface.id, $0) }
      }
    )
  }

  func latestUnreadNotifiedSurfaceID(in tabID: TerminalTabID) -> UUID? {
    notifications(for: tabID)
      .compactMap { surfaceID, notifications -> (UUID, PaneNotification)? in
        guard
          let latestUnreadNotification = Self.latestNotification(
            in: notifications.filter { $0.attentionState == .unread }
          )
        else {
          return nil
        }
        return (surfaceID, latestUnreadNotification)
      }
      .max { lhs, rhs in
        lhs.1.createdAt < rhs.1.createdAt
      }?
      .0
  }

  func clearUnreadOnFocusedSurfaceIfNeeded() {
    guard
      let selectedTabID = spaceManager.selectedTabID,
      let surfaceID = focusHistoryByTab[selectedTabID]?.current
    else {
      return
    }
    clearNotificationAttention(for: surfaceID)
  }

  func clearNotificationAttention(for surfaceID: UUID) {
    guard let tabID = tabID(containing: surfaceID) else { return }
    let activity = Self.surfaceActivity(
      isSelectedTab: tabID == spaceManager.selectedTabID,
      windowIsVisible: windowActivity.isVisible,
      windowIsKey: windowActivity.isKeyWindow,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surfaceID: surfaceID
    )
    guard let notifications = notificationStore.notifications(for: surfaceID) else {
      return
    }
    let updatedNotifications = Self.notificationsAfterDirectInteraction(
      notifications,
      activity: activity
    )
    guard updatedNotifications != notifications else { return }
    notificationStore.replaceNotifications(updatedNotifications, for: surfaceID)
  }

  func updateRunningState(for tabID: TerminalTabID) {
    guard let tree = trees[tabID] else { return }
    let isRunning = tree.leaves().contains { surface in
      Self.isRunning(progressState: surface.bridge.state.progressState)
    }
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .updateDirty(tabID, isDirty: isRunning)
  }

  nonisolated static func logSurfaceIDs(_ surfaceIDs: some Sequence<UUID>) -> String {
    surfaceIDs.map { SupatermLog.uuid($0) }.sorted().joined(separator: ",")
  }

  func emitFocusChangedIfNeeded(_ surfaceID: UUID) {
    guard surfaceID != lastEmittedFocusSurfaceID else { return }
    lastEmittedFocusSurfaceID = surfaceID
  }

  func emit(_ event: TerminalClient.Event) {
    guard let eventContinuation else {
      pendingEvents.append(event)
      return
    }
    eventContinuation.yield(event)
  }

  func emit(_ resolvedCloseRequest: ResolvedCloseRequest) {
    switch resolvedCloseRequest {
    case .request(let closeRequest):
      emit(.closeRequested(closeRequest))
    case .window(let needsConfirmation):
      emit(.windowCloseRequested(needsConfirmation: needsConfirmation))
    }
  }

  func fallbackTitle(for tabID: TerminalTabID) -> String {
    spaceManager.tab(for: tabID)?.defaultTitle ?? "Terminal"
  }

  func setLockedTabTitle(_ title: String?, for tabID: TerminalTabID) {
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .setLockedTitle(tabID, title: title)
    updateTabTitle(for: tabID)
    persistPinnedTabTitleIfNeeded(for: tabID)
    sessionDidChange()
  }

  func promptTabTitle(_ tabID: TerminalTabID) {
    guard let view = selectedSurfaceView ?? titleSurface(for: tabID) else { return }
    promptTabTitle(for: tabID, using: view)
  }

  func promptTabTitle(for tabID: TerminalTabID, using view: GhosttySurfaceView) {
    view.promptTitle(
      messageText: "Change Tab Title",
      initialValue: currentTabTitle(for: tabID)
    ) { [weak self] title in
      self?.setLockedTabTitle(GhosttySurfaceView.titleOverride(from: title), for: tabID)
    }
  }

  func copyTitleToClipboard(for surfaceID: UUID) -> Bool {
    guard let surface = surfaces[surfaceID] else { return false }
    guard let title = surface.effectiveTitle(), !title.isEmpty else { return false }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    return pasteboard.setString(title, forType: .string)
  }

  func currentTabTitle(for tabID: TerminalTabID) -> String {
    if let title = lockedTabTitle(for: tabID) {
      return title
    }
    let fallbackTitle = fallbackTitle(for: tabID)
    guard let surface = titleSurface(for: tabID) else {
      return fallbackTitle
    }
    return Self.resolvedTabDisplayTitle(
      titleOverride: surface.bridge.state.titleOverride,
      title: surface.bridge.state.title,
      pwd: surface.bridge.state.pwd,
      defaultValue: fallbackTitle
    )
  }

  func lockedTabTitle(for tabID: TerminalTabID) -> String? {
    guard let tab = spaceManager.tab(for: tabID), tab.isTitleLocked else { return nil }
    return tab.title
  }

  func resolvedNotificationTitle(
    _ title: String?,
    for tabID: TerminalTabID
  ) -> String {
    Self.trimmedNonEmpty(title) ?? currentTabTitle(for: tabID)
  }

  func resolvedDesktopNotificationDisposition(
    allowDesktopNotificationWhenAgentActive: Bool,
    isFocused: Bool,
    tabID: TerminalTabID
  ) -> SupatermDesktopNotificationDisposition {
    if isFocused {
      return .suppressFocused
    }
    if !allowDesktopNotificationWhenAgentActive && hasActiveAgentAttention(for: tabID) {
      return .suppressAgent
    }
    return .deliver
  }

  func hasActiveAgentAttention(for tabID: TerminalTabID) -> Bool {
    switch tabAgentPresentation(for: tabID).badgeActivity?.phase {
    case .some(.needsInput), .some(.running):
      return true
    case .some(.idle), .none:
      return false
    }
  }

  func titleSurface(for tabID: TerminalTabID) -> GhosttySurfaceView? {
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current {
      return surfaces[focusedSurfaceID]
    }
    return trees[tabID]?.root?.leftmostLeaf()
  }

  func debugPaneSnapshot(
    _ surface: GhosttySurfaceView,
    index: Int,
    isFocused: Bool
  ) -> SupatermAppDebugSnapshot.Pane {
    let state = surface.bridge.state
    return SupatermAppDebugSnapshot.Pane(
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

}
