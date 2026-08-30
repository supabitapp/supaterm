import AppKit
import Foundation
import GhosttyKit
import Observation
import Sharing
import SupaTheme
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
  case deleteSpace = "space.delete"
  case sessionClear = "session.clear"
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
  enum SpaceAction: Equatable {
    case create(String, ThemeTint)
    case delete(TerminalSpaceID)
    case next
    case previous
    case rename(TerminalSpaceID, String)
    case reorder(TerminalSpaceID, insertionIndex: Int)
    case select(TerminalSpaceID)
    case selectAfterAnimation(TerminalSpaceID)
    case selectSlot(Int)
    case setColor(TerminalSpaceID, ThemeTint)
  }

  struct NewPaneSelectionState: Equatable {
    let isFocused: Bool
    let isSelectedTab: Bool
  }

  struct SurfaceActivity: Equatable {
    let isVisible: Bool
    let isFocused: Bool
  }

  typealias SurfaceActivityApplier = @MainActor (GhosttySurfaceView, SurfaceActivity) -> Void

  enum ResolvedCloseRequest: Equatable {
    case request(TerminalCloseRequest)
    case window(needsConfirmation: Bool)

    var closesWindow: Bool {
      if case .window = self { return true }
      return false
    }
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

  struct AgentActivity: Equatable, Sendable {
    let identity: AgentDetectionAgentIdentity
    let phase: AgentActivityPhase
    let detail: String?

    init(
      identity: AgentDetectionAgentIdentity,
      phase: AgentActivityPhase,
      detail: String? = nil
    ) {
      self.identity = identity
      self.phase = phase
      self.detail = normalizedTerminalAgentDetail(detail)
    }

    init(
      agent: SupatermAgentKind,
      phase: AgentActivityPhase,
      detail: String? = nil
    ) {
      self.init(
        identity: AgentDetectionAgentIdentity(agent),
        phase: phase,
        detail: detail
      )
    }

    static func claude(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(agent: .claude, phase: phase, detail: detail)
    }

    static func codex(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(agent: .codex, phase: phase, detail: detail)
    }

    static func pi(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      AgentActivity(agent: .pi, phase: phase, detail: detail)
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
      workingDirectoryPath: String? = nil,
      session: PaneAgentPanelSession? = nil
    ) -> PaneAgentPanelPresentation {
      PaneAgentPanelPresentation(
        progressRows: progressRows,
        workingDirectoryPath: workingDirectoryPath,
        branchDetails: branchDetails,
        artifacts: artifacts,
        session: session
      )
    }
  }

  enum TabAgentStatus: Equatable, Sendable {
    case needsInput
    case done
    case working
  }

  struct TabAgentPresentation: Equatable, Sendable {
    let status: TabAgentStatus?
    let detailActivity: AgentActivity?
    let latestResponse: TabAgentResponse?

    static let empty = Self(
      status: nil,
      detailActivity: nil,
      latestResponse: nil
    )
  }

  struct TabAgentResponse: Equatable, Sendable {
    let agent: AgentDetectionAgentIdentity
    let text: String
  }

  enum AgentPhaseSource: Equatable, Sendable {
    case native
    case terminal
  }

  enum AgentLifecycle: Equatable, Sendable {
    case live
    case ceased(exitCode: Int?)
  }

  struct AgentStateInstance: Equatable, Sendable {
    let activity: AgentActivity
    let completionIdentity: TerminalAgentCompletionIdentity
    let lifecycle: AgentLifecycle
    let nativePresentation: TerminalAgentStatePresentation?
    let phaseSource: AgentPhaseSource
    let revision: UInt64
    let surfaceID: UUID

    var hasActivity: Bool {
      switch lifecycle {
      case .live:
        phaseSource == .terminal || nativePresentation?.hasActivity == true
      case .ceased:
        true
      }
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

  @ObservationIgnored
  let runtime: GhosttyRuntime?
  @ObservationIgnored
  let managesTerminalSurfaces: Bool
  @ObservationIgnored
  let surfaceFactory: GhosttySurfaceView.SurfaceFactory
  @ObservationIgnored
  let surfaceActivityApplier: SurfaceActivityApplier
  @ObservationIgnored
  let zmxClient: ZmxClient
  @ObservationIgnored
  let zmxSessionsEnabled: Bool
  @ObservationIgnored
  let licenseTabGate: LicenseTabGate
  let licenseOpenTabCount: @MainActor () -> Int
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
  var runtimeConfigObservers: [NSObjectProtocol] = []
  var onSessionChange: @MainActor () -> Void = {}
  var onSpaceAction: @MainActor (SpaceAction) -> Void = { _ in }
  @ObservationIgnored
  var onLicenseTabLimitAction: @MainActor (LicenseTabLimitAction) -> Void = { _ in }
  var onTabDroppedOnSpace: @MainActor (TerminalTabDragPayload, TerminalSpaceID) -> Bool = { _, _ in
    false
  }
  @ObservationIgnored
  var paneCountAcrossWindows: @MainActor (TerminalSpaceID) -> Int = { _ in 0 }
  @ObservationIgnored
  var agentPanelController: TerminalAgentPanelController?
  @ObservationIgnored
  var agentDetectionController: TerminalAgentDetectionController?
  weak var spacePager: SpaceSwipeController?
  let spaceManager: TerminalSpaceManager

  var pendingEvents: [TerminalClient.Event] = []
  var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  var surfaces: [UUID: GhosttySurfaceView] = [:]
  var focusHistoryByTab: [TerminalTabID: FocusHistory] = [:]
  var notificationStore = TerminalNotificationStore()
  var agentCompletionStore = TerminalAgentCompletionStore()
  var paneAgentMetadataBySurfaceID: [UUID: PaneAgentMetadata] = [:]
  var agentDetectionStore = TerminalAgentDetectionStore()
  var agentStateStore = TerminalAgentStateStore()
  var runtimeConfigGeneration = 0
  var suppressesSessionChanges = 0
  var showsLicenseTabLimitRefusal = false

  var windowActivity = WindowActivityState.inactive

  var visiblePaneIDs: Set<UUID> {
    guard let selectedTabID, let tree = trees[selectedTabID] else { return [] }
    return Self.visiblePaneIDs(in: tree)
  }

  static func visiblePaneIDs(in tree: SplitTree<GhosttySurfaceView>) -> Set<UUID> {
    Set((tree.zoomed ?? tree.root)?.leaves().map(\.id) ?? [])
  }

  init(
    runtime: GhosttyRuntime? = nil,
    managesTerminalSurfaces: Bool = true,
    surfaceFactory: @escaping GhosttySurfaceView.SurfaceFactory = { app, config in
      ghostty_surface_new(app, config)
    },
    surfaceActivityApplier: @escaping SurfaceActivityApplier = TerminalHostState
      .applySurfaceActivity,
    spaceID: TerminalSpaceID? = nil,
    zmxClient: ZmxClient = .live,
    zmxSessionsEnabled: Bool = true,
    agentDetectionRuleRepository: AgentDetectionRuleRepository? = nil,
    licenseTabGate: LicenseTabGate,
    licenseOpenTabCount: @escaping @MainActor () -> Int
  ) {
    @Shared(.terminalSpaceCatalog) var launchSpaceCatalog = TerminalSpaceCatalog.default
    let initialSpaceCatalog = TerminalSpaceCatalog.sanitized(launchSpaceCatalog)
    self.managesTerminalSurfaces = managesTerminalSurfaces
    self.surfaceFactory = surfaceFactory
    self.surfaceActivityApplier = surfaceActivityApplier
    self.runtime = managesTerminalSurfaces ? (runtime ?? GhosttyRuntime()) : runtime
    self.spaceManager = TerminalSpaceManager(
      catalog: initialSpaceCatalog,
      displayedSpaceID: spaceID ?? initialSpaceCatalog.defaultSelectedSpaceID
    )
    self.zmxClient = zmxClient
    self.zmxSessionsEnabled = zmxSessionsEnabled
    self.licenseTabGate = licenseTabGate
    self.licenseOpenTabCount = licenseOpenTabCount

    if initialSpaceCatalog != spaceCatalog {
      replaceSpaceCatalog(initialSpaceCatalog)
    }
    observeRuntimeConfig()
    observeSpaceCatalog()
    agentPanelController = TerminalAgentPanelController(terminal: self)
    if let agentDetectionRuleRepository {
      let controller = TerminalAgentDetectionController(
        host: self,
        repository: agentDetectionRuleRepository
      )
      agentDetectionController = controller
      controller.start()
    }
  }

  #if DEBUG || SUPATERM_SNAPSHOT_CATALOG
    static func test(
      runtime: GhosttyRuntime? = nil,
      managesTerminalSurfaces: Bool = true,
      createsLiveTerminalSurfaces: Bool = false,
      surfaceActivityApplier: @escaping SurfaceActivityApplier = TerminalHostState
        .applySurfaceActivity,
      spaceID: TerminalSpaceID? = nil,
      zmxClient: ZmxClient = .live,
      zmxSessionsEnabled: Bool = true,
      agentDetectionRuleRepository: AgentDetectionRuleRepository? = nil,
      licenseTabGate: LicenseTabGate = .unrestricted,
      licenseOpenTabCount: @escaping @MainActor () -> Int = { 0 }
    ) -> TerminalHostState {
      let surfaceFactory: GhosttySurfaceView.SurfaceFactory =
        createsLiveTerminalSurfaces
        ? { app, config in ghostty_surface_new(app, config) }
        : { _, _ in nil }
      return TerminalHostState(
        runtime: runtime,
        managesTerminalSurfaces: managesTerminalSurfaces,
        surfaceFactory: surfaceFactory,
        surfaceActivityApplier: surfaceActivityApplier,
        spaceID: spaceID,
        zmxClient: zmxClient,
        zmxSessionsEnabled: zmxSessionsEnabled,
        agentDetectionRuleRepository: agentDetectionRuleRepository,
        licenseTabGate: licenseTabGate,
        licenseOpenTabCount: licenseOpenTabCount
      )
    }
  #endif

  isolated deinit {
    spaceCatalogObservationTask?.cancel()
    agentDetectionController?.stop()
    agentPanelController?.stop()
    for observer in runtimeConfigObservers {
      NotificationCenter.default.removeObserver(observer)
    }
  }

  func observeRuntimeConfig() {
    guard let runtime else { return }
    let center = NotificationCenter.default
    for observer in runtimeConfigObservers {
      center.removeObserver(observer)
    }
    runtimeConfigObservers = [
      center.addObserver(
        forName: .ghosttyRuntimeConfigDidChange,
        object: runtime,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.runtimeConfigGeneration &+= 1
        }
      },
      center.addObserver(
        forName: NSTextInputContext.keyboardSelectionDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.runtimeConfigGeneration &+= 1
        }
      },
    ]
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

  func togglePinned(_ tabID: TerminalTabID) {
    guard let instance = spaceManager.instance(for: tabID) else { return }
    let previousRevision = instance.tabCollection.topologyRevision
    guard let result = instance.tabCollection.togglePinned(tabID) else { return }
    finishMove(result, previousRevision: previousRevision, spaceID: instance.spaceID)
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

  func clearScreenOnFocusedSurface() {
    selectedSurfaceView?.bridge.sendKey(.ctrlL)
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
        "displayedSpaceID=\(SupatermLog.uuid(displayedSpaceID.rawValue))",
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
    let visiblePaneIDs = self.visiblePaneIDs
    var surfaceToFocus: GhosttySurfaceView?

    for (tabID, tree) in trees {
      let focusedSurfaceID = focusHistoryByTab[tabID]?.current
      let isSelectedTab = tabID == selectedTabID
      for surface in tree.leaves() {
        let surfaceActivity = Self.surfaceActivity(
          isSelectedTab: isSelectedTab,
          isPaneVisible: visiblePaneIDs.contains(surface.id),
          windowActivity: activity,
          focusedSurfaceID: focusedSurfaceID,
          surface: surface
        )
        surfaceActivityApplier(surface, surfaceActivity)
        if surfaceActivity.isVisible && activity.isKeyWindow
          && focusedSurfaceID == surface.id
        {
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
    startupCommand: SupatermTerminalStartup? = nil,
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
        syncFocus(windowActivity)
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
      syncFocus(windowActivity)
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
        syncFocus(windowActivity)
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
      syncFocus(windowActivity)
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

    case .equalize:
      trees[tabID] = tree.equalized()
      sessionDidChange()

    case .agentPanelCopyText,
      .agentPanelForkSessionRequested,
      .agentPanelVisibilityToggled,
      .agentPanelURLTapped:
      break
    }
  }

  func rearrangePane(
    _ surfaceID: UUID,
    relativeTo destinationID: UUID,
    zone: TerminalSplitDropZone,
    in tabID: TerminalTabID
  ) -> Bool {
    guard
      var tree = trees[tabID],
      let surface = surfaces[surfaceID],
      let destination = surfaces[destinationID],
      surface !== destination,
      let sourceNode = tree.root?.node(view: surface)
    else { return false }
    let treeWithoutSource = tree.removing(sourceNode)
    guard !treeWithoutSource.isEmpty else { return false }
    do {
      tree = try treeWithoutSource.inserting(
        view: surface,
        at: destination,
        direction: mapDropZone(zone)
      )
    } catch {
      return false
    }
    trees[tabID] = tree
    focusSurface(surface, in: tabID)
    syncFocus(windowActivity)
    sessionDidChange()
    return true
  }

  static func surfaceActivity(
    isSelectedTab: Bool,
    isPaneVisible: Bool,
    windowActivity: WindowActivityState,
    focusedSurfaceID: UUID?,
    surface: GhosttySurfaceView
  ) -> SurfaceActivity {
    let isVisible = isSelectedTab && isPaneVisible && windowActivity.isVisible
    let isFocused =
      isVisible && windowActivity.isKeyWindow && focusedSurfaceID == surface.id
      && surface.window?.firstResponder === surface
    return SurfaceActivity(isVisible: isVisible, isFocused: isFocused)
  }

  static func applySurfaceActivity(
    _ surface: GhosttySurfaceView,
    _ activity: SurfaceActivity
  ) {
    surface.setOcclusion(activity.isVisible)
    surface.focusDidChange(activity.isFocused)
  }

  func performCloseTab(_ tabID: TerminalTabID) {
    guard let instance = spaceManager.instance(for: tabID) else { return }
    let tabCollection = instance.tabCollection
    let wasSelectedTab = tabCollection.selectedTabID == tabID

    removeTree(for: tabID, source: .closeTab)
    guard let result = tabCollection.closeTab(tabID) else { return }
    removeCollapsedGroups(result.deletedEmptyGroupIDs, in: instance.spaceID)
    updateSelectionAfterClosingTab(
      in: instance.spaceID,
      didCloseSelectedTab: wasSelectedTab
    )
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

  func performCloseGroup(_ groupID: TerminalTabGroupID) {
    guard let instance = spaceManager.instance(for: groupID) else { return }
    withBatchedSessionChange {
      for tabID in instance.tabCollection.tabIDs(in: groupID) {
        performCloseTab(tabID)
      }
      _ = instance.tabCollection.deleteEmptyGroup(groupID)
      instance.collapsedTabGroupIDs.remove(groupID)
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
    configureBridgePaneTabCallbacks(for: view)
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

  func configureBridgePaneTabCallbacks(for view: GhosttySurfaceView) {
    view.bridge.canMoveToNewTab = { [weak self, weak view] in
      guard let self, let view else { return false }
      return self.canMovePaneToNewTab(view.id)
    }
    view.bridge.onMoveToNewTab = { [weak self, weak view] in
      guard let self, let view else { return false }
      return self.movePaneToNewTab(view.id)
    }
  }

  func handleCommandFinished(for surfaceID: UUID) {
    #if SUPATERM_DEMO
      guard !DemoSeed.preservesSeededAgentState(surfaceID) else { return }
    #endif
    let exitingAgent =
      agentCompletionStore.cessation(for: surfaceID) == nil
      ? resolvedAgentState(for: surfaceID).currentInstance.map(TerminalAgentExitContext.init)
        ?? agentCompletionStore.pendingExit(for: surfaceID)
      : nil
    let exitCode = surfaces[surfaceID]?.bridge.state.commandExitCode
    agentDetectionController?.surfaceCommandDidFinish(surfaceID)
    let removedAgentState = clearAgentState(for: surfaceID)
    if let exitingAgent {
      recordAgentCessation(exitingAgent, exitCode: exitCode, surfaceID: surfaceID)
    }
    _ = clearAgentPanelMetadata(for: surfaceID)
    agentPanelController?.surfaceCommandFinished(surfaceID)
    if removedAgentState {
      sessionDidChange()
    }
  }

  func configureBridgeCloseCallbacks(for view: GhosttySurfaceView) {
    view.bridge.onChildExited = { [weak self, weak view] in
      guard let self, let view else { return false }
      self.requestCloseSurfaceAfterProcessExit(
        view.id,
        usesZmx: view.usesZmx,
        source: .ghosttyChildExit
      )
      return true
    }
    view.bridge.onCloseRequest = { [weak self, weak view] needsConfirmation in
      guard let self, let view else { return }
      let tabID = self.tabID(containing: view.id)
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.hostCallback",
        fields: [
          "surfaceID=\(SupatermLog.uuid(view.id))",
          "tabID=\(SupatermLog.uuid(tabID?.rawValue))",
          "selectedTabID=\(SupatermLog.uuid(self.selectedTabID?.rawValue))",
          "focusedSurfaceID=\(SupatermLog.uuid(tabID.flatMap { self.focusHistoryByTab[$0]?.current }))",
          "needsConfirmation=\(needsConfirmation)",
          "surfaceRegistered=\(self.surfaces[view.id] === view)",
          "zmxSessionsEnabled=\(self.zmxSessionsEnabled)",
        ]
      )
      self.requestCloseSurface(
        view.id,
        needsConfirmation: needsConfirmation,
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
      guard view.window?.isKeyWindow == true else { return }
      self.applyFocusedSurface(view.id, in: tabID)
      self.updateTabTitle(for: tabID)
      self.updateRunningState(for: tabID)
      self.clearNotificationAttention(for: view.id)
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
    let placement: TerminalTabPlacement?
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

  struct ResolvedPaneLocation {
    let paneIndex: Int
    let spaceIndex: Int
    let tabIndex: Int
  }

  func resolveNotifyTarget(
    _ target: TerminalNotifyRequest.Target
  ) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .pane(let paneID):
      return try resolveCreatePaneTarget(.pane(paneID))
    case .tab(let tabID):
      return try resolveCreatePaneTarget(.tab(tabID))
    }
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
    spaceManager.instance(for: tabID)?.tabCollection.updateTitle(tabID, title: resolvedTitle)
  }

  func focusSurface(in tabID: TerminalTabID) {
    clearAgentCompletionAttention(in: tabID)
    if let unreadSurfaceID = latestUnreadNotifiedSurfaceID(in: tabID),
      let surface = surfaces[unreadSurfaceID]
    {
      focusSurface(surface, in: tabID)
      return
    }
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current,
      let surface = surfaces[focusedSurfaceID]
    {
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
    clearAgentCompletionAttention(in: tabID)
  }

  func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
    let previousSurface = focusHistoryByTab[tabID].flatMap { surfaces[$0.current] }
    let didRevealSurface = revealSurfaceIfNeeded(surface.id, in: tabID)
    applyFocusedSurface(surface.id, in: tabID)
    updateTabTitle(for: tabID)
    clearNotificationAttention(for: surface.id)
    if didRevealSurface {
      syncFocus(windowActivity)
    }
    guard tabID == spaceManager.selectedTabID else { return }
    let fromSurface = previousSurface === surface ? nil : previousSurface
    GhosttySurfaceView.moveFocus(to: surface, from: fromSurface) { [weak self, weak surface] in
      guard let self, let surface else { return false }
      return selectedSurfaceView === surface
    }
  }

  private func revealSurfaceIfNeeded(_ surfaceID: UUID, in tabID: TerminalTabID) -> Bool {
    guard
      let tree = trees[tabID],
      tree.zoomed != nil,
      !Self.visiblePaneIDs(in: tree).contains(surfaceID)
    else {
      return false
    }
    trees[tabID] = tree.settingZoomed(nil)
    return true
  }

  static func selectedTabID(
    afterCreatingTab targetTabID: TerminalTabID,
    focusRequested: Bool,
    currentSelectedTabID: TerminalTabID?
  ) -> TerminalTabID {
    focusRequested ? targetTabID : currentSelectedTabID ?? targetTabID
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
    isSelectedTab: Bool,
    isPaneVisible: Bool,
    windowActivity: WindowActivityState,
    focusedSurfaceID: UUID?,
    surface: GhosttySurfaceView
  ) -> NewPaneSelectionState {
    let activity = surfaceActivity(
      isSelectedTab: isSelectedTab,
      isPaneVisible: isPaneVisible,
      windowActivity: windowActivity,
      focusedSurfaceID: focusedSurfaceID,
      surface: surface
    )
    return NewPaneSelectionState(isFocused: activity.isFocused, isSelectedTab: isSelectedTab)
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
    guard let tree = trees[tabID] else { return nil }
    return notificationStore.latestUnreadTarget(among: tree.leaves().map(\.id))?.surfaceID
  }

  func latestUnreadNotificationTarget() -> TerminalNotificationStore.UnreadTarget? {
    notificationStore.latestUnreadTarget(among: surfaces.keys)
  }

  func clearUnreadOnFocusedSurfaceIfNeeded() {
    guard
      let selectedTabID = spaceManager.selectedTabID,
      let surfaceID = focusHistoryByTab[selectedTabID]?.current
    else {
      return
    }
    clearAgentCompletionAttention(in: selectedTabID)
    clearNotificationAttention(for: surfaceID)
  }

  func clearAgentCompletionAttention(in tabID: TerminalTabID) {
    guard
      tabID == spaceManager.selectedTabID,
      windowActivity.isVisible,
      windowActivity.isKeyWindow
    else {
      return
    }
    for surfaceID in visiblePaneIDs {
      agentCompletionStore.clear(for: surfaceID)
      guard let notifications = notificationStore.notifications(for: surfaceID) else {
        continue
      }
      let updatedNotifications = Self.notificationsAfterViewingAgentCompletions(notifications)
      guard updatedNotifications != notifications else { continue }
      notificationStore.replaceNotifications(updatedNotifications, for: surfaceID)
    }
  }

  func clearNotificationAttention(for surfaceID: UUID) {
    guard let tabID = tabID(containing: surfaceID), let surface = surfaces[surfaceID] else {
      return
    }
    let activity = Self.surfaceActivity(
      isSelectedTab: tabID == spaceManager.selectedTabID,
      isPaneVisible: visiblePaneIDs.contains(surfaceID),
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[tabID]?.current,
      surface: surface
    )
    if activity.isFocused {
      agentCompletionStore.clear(for: surfaceID)
    }
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
    spaceManager.instance(for: tabID)?.tabCollection.updateDirty(tabID, isDirty: isRunning)
  }

  nonisolated static func logSurfaceIDs(_ surfaceIDs: some Sequence<UUID>) -> String {
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
    spaceManager.instance(for: tabID)?.tabCollection.setLockedTitle(tabID, title: title)
    updateTabTitle(for: tabID)
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
    guard let tree = trees[tabID] else { return false }
    return tree.leaves().contains { surface in
      nativeAgentDetectionCandidates(for: surface.id).contains {
        $0.presentation.phase == .needsInput || $0.presentation.phase == .running
      }
    }
  }

  func titleSurface(for tabID: TerminalTabID) -> GhosttySurfaceView? {
    if let focusedSurfaceID = focusHistoryByTab[tabID]?.current {
      return surfaces[focusedSurfaceID]
    }
    return trees[tabID]?.root?.leftmostLeaf()
  }

  func debugPaneSnapshot(
    _ surface: GhosttySurfaceView?,
    pendingPane: TerminalPaneLeafSession?,
    id: UUID,
    index: Int,
    isFocused: Bool
  ) -> SupatermAppDebugSnapshot.Pane {
    guard let surface else {
      return SupatermAppDebugSnapshot.Pane(
        index: index,
        id: id,
        isFocused: isFocused,
        displayTitle: pendingPane?.titleOverride ?? "Pane \(index)",
        pwd: pendingPane?.workingDirectoryPath,
        isReadOnly: false,
        hasSecureInput: false,
        bellCount: 0,
        isRunning: false,
        progressState: nil,
        progressValue: nil,
        needsCloseConfirmation: false,
        lastCommandExitCode: nil,
        lastCommandDurationMs: nil,
        lastChildExitCode: nil,
        lastChildExitTimeMs: nil,
        foregroundProcessGroupID: nil,
        ttyName: nil
      )
    }
    let state = surface.bridge.state
    let processIdentity = surface.processIdentity
    let agentSnapshot = debugAgentSnapshot(for: id)
    return SupatermAppDebugSnapshot.Pane(
      index: index,
      id: id,
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
      lastChildExitTimeMs: state.childExitTimeMs,
      foregroundProcessGroupID: processIdentity.foregroundProcessGroupID,
      ttyName: processIdentity.ttyName,
      agent: agentSnapshot.agent,
      agentStatus: agentSnapshot.status
    )
  }

}
