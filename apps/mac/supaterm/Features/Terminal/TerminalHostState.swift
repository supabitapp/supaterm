import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermSupport
import SupatermTerminalAgentPanelFeature
import SupatermTerminalCore
import SupatermTerminalModels
import SupatermTerminalPresentationFeature
import SupatermTerminalStateFeature
import SwiftUI

@MainActor
@Observable
public final class TerminalHostState: TerminalAgentPanelHost {
  @ObservationIgnored
  public let runtime: GhosttyRuntime?
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
  public var onSessionChange: @MainActor () -> Void = {}
  @ObservationIgnored
  public var onSurfaceCommandFinished: @MainActor (UUID) -> Void = { _ in }
  @ObservationIgnored
  var agentPanelController: TerminalAgentPanelController?
  let spaceManager = TerminalSpaceManager()

  var pendingEvents: [TerminalClient.Event] = []
  var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  var surfaces: [UUID: GhosttySurfaceView] = [:]
  var focusHistoryByTab: [TerminalTabID: FocusHistory] = [:]
  var notificationStore = TerminalNotificationStore()
  var paneAgentMetadataBySurfaceID: [UUID: PaneAgentMetadata] = [:]
  var agentPresenceStore = TerminalAgentPresenceStore()
  var previousSelectedTabIDBySpace: [TerminalSpaceID: TerminalTabID] = [:]
  var previousSelectedSpaceID: TerminalSpaceID?
  var lastEmittedFocusSurfaceID: UUID?
  var runtimeConfigGeneration = 0
  var suppressesSessionChanges = 0

  public var windowActivity = WindowActivityState.inactive

  public init(
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

  public func splitTree(
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
    _ operation: TerminalWindowSplitOperation, in tabID: TerminalTabID
  ) {
    guard var tree = trees[tabID] else { return }

    switch operation {
    case .resize(let leafIDs, let ratio):
      guard let node = splitNode(in: tree.root, matchingLeafIDs: leafIDs) else { return }
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
    }
  }

  private func splitNode(
    in node: SplitTree<GhosttySurfaceView>.Node?,
    matchingLeafIDs leafIDs: [UUID]
  ) -> SplitTree<GhosttySurfaceView>.Node? {
    guard let node else { return nil }
    switch node {
    case .leaf:
      return nil
    case .split(let split):
      if node.leaves().map(\.id) == leafIDs {
        return node
      }
      return splitNode(in: split.left, matchingLeafIDs: leafIDs)
        ?? splitNode(in: split.right, matchingLeafIDs: leafIDs)
    }
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

  public nonisolated static func logSurfaceIDs(_ surfaceIDs: some Sequence<UUID>) -> String {
    surfaceIDs.map { SupatermLog.uuid($0) }.sorted().joined(separator: ",")
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

  public func promptTabTitle(_ tabID: TerminalTabID) {
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
