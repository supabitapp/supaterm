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

  struct SidebarNotificationPresentation: Equatable, Sendable {
    let markdown: String
    let previewMarkdown: String
  }

  struct PaneNotification: Equatable, Sendable {
    var attentionState: SupatermNotificationAttentionState?
    var body: String
    let createdAt: Date
    var subtitle: String
    var title: String
    let origin: NotificationOrigin

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      subtitle: String,
      title: String
    ) {
      self.init(
        attentionState: attentionState,
        body: body,
        createdAt: createdAt,
        subtitle: subtitle,
        title: title,
        origin: .generic
      )
    }

    init(
      attentionState: SupatermNotificationAttentionState?,
      body: String,
      createdAt: Date,
      subtitle: String,
      title: String,
      origin: NotificationOrigin
    ) {
      self.attentionState = attentionState
      self.body = body
      self.createdAt = createdAt
      self.subtitle = subtitle
      self.title = title
      self.origin = origin
    }
  }

  enum NotificationSemantic: Equatable, Sendable {
    case completion
    case attention
    case other
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

  enum AgentActivityPhase: Equatable, Sendable {
    case needsInput
    case running
    case idle
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
      .init(kind: .claude, phase: phase, detail: detail)
    }

    static func codex(
      _ phase: AgentActivityPhase,
      detail: String? = nil
    ) -> Self {
      .init(kind: .codex, phase: phase, detail: detail)
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

  @ObservationIgnored
  let runtime: GhosttyRuntime?
  @ObservationIgnored
  let managesTerminalSurfaces: Bool
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
  var onCommandFinished: @MainActor (UUID) -> Void = { _ in }
  let spaceManager = TerminalSpaceManager()

  var pendingEvents: [TerminalClient.Event] = []
  var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  var surfaces: [UUID: GhosttySurfaceView] = [:]
  var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  var previousFocusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  var paneNotifications: [UUID: [PaneNotification]] = [:]
  var agentActivityByTab: [TerminalTabID: AgentActivity] = [:]
  var agentActivitySurfaceIDByTab: [TerminalTabID: UUID] = [:]
  var codexHoverMessagesByTab: [TerminalTabID: [String]] = [:]
  var previousSelectedTabIDBySpace: [TerminalSpaceID: TerminalTabID] = [:]
  var previousSelectedSpaceID: TerminalSpaceID?
  var lastEmittedFocusSurfaceID: UUID?
  var runtimeConfigGeneration = 0
  var suppressesSessionChanges = 0
  @ObservationIgnored
  var recentStructuredNotificationsBySurfaceID: [UUID: RecentStructuredNotification] = [:]

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
    let initialPinnedTabCatalog = sanitizedPinnedTabCatalog(pinnedTabCatalog)
    if initialPinnedTabCatalog != pinnedTabCatalog {
      replacePinnedTabCatalog(initialPinnedTabCatalog)
    }
    lastAppliedPinnedTabCatalog = initialPinnedTabCatalog
    reconcilePinnedTabs(with: initialPinnedTabCatalog)
    observeRuntimeConfig()
    observeSpaceCatalog()
    observePinnedTabCatalog()
  }

  isolated deinit {
    spaceCatalogObservationTask?.cancel()
    pinnedTabCatalogObservationTask?.cancel()
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
      .savePinnedTabLayout,
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
    case .ensureInitialTab(let focusing, let startupInput):
      ensureInitialTab(
        focusing: focusing,
        startupInput: startupInput
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
    case .savePinnedTabLayout(let tabID):
      savePinnedTabLayout(tabID)
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

  func ensureInitialTab(
    focusing: Bool,
    startupInput: String? = nil
  ) {
    guard tabs.isEmpty else { return }
    _ = createTab(
      focusing: focusing,
      initialInput: startupInput
    )
  }

  @discardableResult
  func createTab(
    focusing: Bool = true,
    initialInput: String? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    sessionChangesEnabled: Bool = true
  ) -> TerminalTabID? {
    guard let target = resolveLocalCreateTabTarget(inheritingFromSurfaceID: inheritingFromSurfaceID)
    else {
      return nil
    }
    return createTab(
      in: target.spaceID,
      focusing: focusing,
      initialInput: initialInput,
      inheritingFromSurfaceID: target.inheritedSurfaceID,
      insertion: resolvedNewTabInsertion(anchorTabID: target.anchorTabID),
      sessionChangesEnabled: sessionChangesEnabled
    )
  }

  @discardableResult
  func createTab(
    in spaceID: TerminalSpaceID,
    focusing: Bool = true,
    initialInput: String? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    insertion: TerminalTabManager.Insertion = .end,
    sessionChangesEnabled: Bool = true,
    synchronizesFocus: Bool = true
  ) -> TerminalTabID? {
    guard let tabManager = spaceManager.tabManager(for: spaceID) else { return nil }
    let context: ghostty_surface_context_e =
      tabManager.tabs.isEmpty
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let tabID = tabManager.createTab(
      title: "Terminal \(nextTabIndex(in: spaceID))",
      icon: "terminal",
      insertion: insertion
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
    if synchronizesFocus {
      syncFocus(windowActivity)
    }
    if sessionChangesEnabled {
      sessionDidChange()
    }
    return tabID
  }

  @discardableResult
  func applySelectedSpace(_ spaceID: TerminalSpaceID) -> Bool {
    let currentSelectedSpaceID = selectedSpaceID
    guard spaceManager.selectSpace(spaceID) else { return false }
    if currentSelectedSpaceID != spaceID, let currentSelectedSpaceID {
      previousSelectedSpaceID = currentSelectedSpaceID
    }
    return true
  }

  func applySelectedTab(
    _ tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    let currentSelectedTabID = spaceManager.selectedTabID(in: spaceID)
    if currentSelectedTabID != tabID, let currentSelectedTabID {
      previousSelectedTabIDBySpace[spaceID] = currentSelectedTabID
    }
    spaceManager.tabManager(for: spaceID)?.selectTab(tabID)
  }

  func selectTab(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    let didChangeSpace = spaceManager.selectedSpaceID != space.id
    guard applySelectedSpace(space.id) else { return }
    if didChangeSpace {
      persistDefaultSelectedSpaceID(space.id)
    }
    applySelectedTab(tabID, in: space.id)
    focusSurface(in: tabID)
    syncFocus(windowActivity)
    sessionDidChange()
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

  func nextSpace() {
    selectAdjacentSpace(step: 1)
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

  func previousSpace() {
    selectAdjacentSpace(step: -1)
  }

  func selectLastTab() {
    guard let selectedSpaceID else { return }
    guard let lastTabID = previousSelectedTabIDBySpace[selectedSpaceID] else { return }
    selectTab(lastTabID)
  }

  func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setPinnedTabOrder(orderedIDs)
    persistPinnedTabCatalog()
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
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .moveTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
    persistPinnedTabCatalog()
    sessionDidChange()
  }

  func togglePinned(_ tabID: TerminalTabID) {
    spaceManager.space(for: tabID).flatMap { spaceManager.tabManager(for: $0.id) }?.togglePinned(
      tabID)
    persistPinnedTabCatalog()
    sessionDidChange()
  }

  func savePinnedTabLayout(_ tabID: TerminalTabID) {
    persistPinnedTabCatalogIfNeeded(for: tabID)
  }

  @discardableResult
  func createSpace(named name: String) throws -> TerminalSpaceID {
    guard let normalizedName = Self.trimmedNonEmpty(name) else {
      throw TerminalControlError.invalidSpaceName
    }
    guard spaceManager.isNameAvailable(normalizedName) else {
      throw TerminalControlError.spaceNameUnavailable
    }

    let space = PersistedTerminalSpace(name: normalizedName)
    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = space.id
    updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: updatedSpaceCatalog.defaultSelectedSpaceID,
      spaces: updatedSpaceCatalog.spaces + [space]
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    guard applySelectedSpace(space.id) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: spaces.count + 1)
    }
    finalizeSpaceSelectionChange()
    sessionDidChange()
    return space.id
  }

  func selectSpace(_ spaceID: TerminalSpaceID) {
    selectSpace(spaceID, persistDefaultSelection: true)
  }

  func selectSpace(
    _ spaceID: TerminalSpaceID,
    persistDefaultSelection: Bool
  ) {
    guard applySelectedSpace(spaceID) else { return }
    if persistDefaultSelection {
      persistDefaultSelectedSpaceID(spaceID)
    }
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  func selectSpace(slot: Int) {
    let index = slot == 0 ? 9 : slot - 1
    guard spaces.indices.contains(index) else { return }
    selectSpace(spaces[index].id)
  }

  func selectAdjacentSpace(step: Int) {
    guard
      spaces.count > 1,
      let selectedSpaceID,
      let currentIndex = spaces.firstIndex(where: { $0.id == selectedSpaceID })
    else { return }

    let targetIndex = (currentIndex + step + spaces.count) % spaces.count
    selectSpace(spaces[targetIndex].id)
  }

  func renameSpace(_ spaceID: TerminalSpaceID, to name: String) {
    let normalizedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedName.isEmpty else { return }
    guard spaceManager.isNameAvailable(normalizedName, excluding: spaceID) else { return }
    guard let index = spaceCatalog.spaces.firstIndex(where: { $0.id == spaceID }) else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.spaces[index].name = normalizedName
    _ = writeSpaceCatalog(updatedSpaceCatalog)
  }

  func deleteSpace(_ spaceID: TerminalSpaceID) {
    let remainingSpaces = spaceCatalog.spaces.filter { $0.id != spaceID }
    guard !remainingSpaces.isEmpty else { return }
    guard remainingSpaces.count != spaceCatalog.spaces.count else { return }
    if previousSelectedSpaceID == spaceID {
      previousSelectedSpaceID = nil
    }

    let nextSelectedSpaceID = nextSelectedSpaceID(afterDeleting: spaceID)
    let updatedSpaceCatalog = TerminalSpaceCatalog(
      defaultSelectedSpaceID: nextSelectedSpaceID,
      spaces: remainingSpaces
    )
    _ = writeSpaceCatalog(updatedSpaceCatalog)
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  func isSpaceNameAvailable(
    _ proposedName: String,
    excluding excludedSpaceID: TerminalSpaceID? = nil
  ) -> Bool {
    spaceManager.isNameAvailable(proposedName, excluding: excludedSpaceID)
  }

  func closeSurface(_ surfaceID: UUID) {
    performCloseSurface(surfaceID)
  }

  func closeTab(_ tabID: TerminalTabID) {
    performCloseTab(tabID)
  }

  func closeTabs(_ tabIDs: [TerminalTabID]) {
    performCloseTabs(tabIDs)
  }

  func requestCloseSurface(_ surfaceID: UUID, needsConfirmation: Bool? = nil) {
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

  func requestCloseTab(_ tabID: TerminalTabID) {
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

  func requestCloseTabsBelow(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    requestCloseTabs(tabManager.tabIDsBelow(tabID))
  }

  func requestCloseOtherTabs(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    requestCloseTabs(tabManager.otherTabIDs(tabID))
  }

  func requestCloseTabs(_ tabIDs: [TerminalTabID]) {
    let tabIDs = tabIDs.filter { trees[$0] != nil }
    guard !tabIDs.isEmpty else { return }
    emit(
      .closeRequested(
        .init(
          target: .tabs(tabIDs),
          needsConfirmation: tabIDs.contains(where: tabNeedsCloseConfirmation)
        )
      )
    )
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
    windowActivity = activity
    syncFocus(activity)
    clearUnreadOnFocusedSurfaceIfNeeded()
  }

  func syncFocus(_ activity: WindowActivityState) {
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
        persistPinnedTabCatalogIfNeeded(for: tabID)
        sessionDidChange()
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
        persistPinnedTabCatalogIfNeeded(for: tabID)
        sessionDidChange()
        return true
      } catch {
        return false
      }

    case .equalizeSplits:
      trees[tabID] = tree.equalized()
      persistPinnedTabCatalogIfNeeded(for: tabID)
      sessionDidChange()
      return true

    case .toggleSplitZoom:
      guard tree.isSplit else { return false }
      let newZoomed = tree.zoomed == targetNode ? nil : targetNode
      trees[tabID] = tree.settingZoomed(newZoomed)
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
        persistPinnedTabCatalogIfNeeded(for: tabID)
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
        persistPinnedTabCatalogIfNeeded(for: tabID)
        sessionDidChange()
      } catch {
        return
      }

    case .equalize:
      trees[tabID] = tree.equalized()
      persistPinnedTabCatalogIfNeeded(for: tabID)
      sessionDidChange()
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

    let shouldCreateReplacement = tabManager.tabs.count == 1
    let inheritedSurfaceID = focusedSurfaceIDByTab[tabID]
    if shouldCreateReplacement {
      _ = applySelectedSpace(space.id)
      _ = createTab(
        focusing: false,
        inheritingFromSurfaceID: inheritedSurfaceID,
        sessionChangesEnabled: false
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
    if wasPinned {
      persistPinnedTabCatalog()
    }
    sessionDidChange()
  }

  func performCloseTabs(_ tabIDs: [TerminalTabID]) {
    for tabID in tabIDs {
      performCloseTab(tabID)
    }
  }

  func performCloseSurface(_ surfaceID: UUID) {
    guard let tabID = tabID(containing: surfaceID), let tree = trees[tabID] else { return }
    guard let node = tree.find(id: surfaceID), let surface = surfaces[surfaceID] else { return }
    let wasPinned = spaceManager.tab(for: tabID)?.isPinned == true

    let nextSurface =
      focusedSurfaceIDByTab[tabID] == surfaceID
      ? tree.focusTargetAfterClosing(node)
      : nil
    let newTree = tree.removing(node)
    surface.closeSurface()
    surfaces.removeValue(forKey: surfaceID)
    paneNotifications.removeValue(forKey: surfaceID)
    recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)

    if newTree.isEmpty {
      trees.removeValue(forKey: tabID)
      focusedSurfaceIDByTab.removeValue(forKey: tabID)
      previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
      agentActivityByTab.removeValue(forKey: tabID)
      agentActivitySurfaceIDByTab.removeValue(forKey: tabID)
      codexHoverMessagesByTab.removeValue(forKey: tabID)
      spaceManager.space(for: tabID)
        .flatMap { spaceManager.tabManager(for: $0.id) }?
        .closeTab(tabID)
      if tabs.isEmpty {
        _ = createTab(focusing: false, sessionChangesEnabled: false)
      } else if let selectedTabID = selectedTabID {
        focusSurface(in: selectedTabID)
      }
      syncFocus(windowActivity)
      if wasPinned {
        persistPinnedTabCatalog()
      }
      sessionDidChange()
      return
    }

    trees[tabID] = newTree
    if agentActivitySurfaceIDByTab[tabID] == surfaceID {
      agentActivityByTab.removeValue(forKey: tabID)
      agentActivitySurfaceIDByTab.removeValue(forKey: tabID)
      codexHoverMessagesByTab.removeValue(forKey: tabID)
    }
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
    if focusedSurfaceIDByTab[tabID] == surfaceID {
      if let nextSurface {
        focusSurface(nextSurface, in: tabID)
      } else {
        focusedSurfaceIDByTab.removeValue(forKey: tabID)
        previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
      }
    }
    syncFocus(windowActivity)
    persistPinnedTabCatalogIfNeeded(for: tabID)
    sessionDidChange()
  }

  func createSurface(
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
    configureBridgeCallbacks(for: view, tabID: tabID)
    configureSurfaceCallbacks(for: view, tabID: tabID)
    surfaces[view.id] = view
    return view
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
      _ = self.clearAgentActivity(for: view.id)
      self.onCommandFinished(view.id)
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

  func configureBridgeCloseCallbacks(for view: GhosttySurfaceView) {
    view.bridge.onChildExited = { [weak self, weak view] in
      guard let self, let view else { return false }
      self.requestCloseSurface(view.id, needsConfirmation: false)
      return true
    }
    view.bridge.onCloseRequest = { [weak self, weak view] processAlive in
      guard let self, let view else { return }
      self.requestCloseSurface(view.id, needsConfirmation: processAlive)
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
      self.sessionDidChange()
    }
  }

  struct InheritedSurfaceConfig: Equatable {
    let workingDirectory: URL?
    let fontSize: Float32?
  }

  func inheritedSurfaceConfig(
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

  func currentFocusedSurfaceID() -> UUID? {
    guard let selectedTabID = spaceManager.selectedTabID else { return nil }
    return focusedSurfaceIDByTab[selectedTabID]
  }

  func inheritedSurfaceID(in spaceID: TerminalSpaceID) -> UUID? {
    if let selectedTabID = spaceManager.selectedTabID(in: spaceID) {
      if let focusedSurfaceID = focusedSurfaceIDByTab[selectedTabID],
        surfaces[focusedSurfaceID] != nil
      {
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

  struct ResolvedCreateTabTarget {
    let anchorTabID: TerminalTabID?
    let inheritedSurfaceID: UUID?
    let space: TerminalSpaceItem
  }

  struct ResolvedLocalCreateTabTarget {
    let anchorTabID: TerminalTabID?
    let inheritedSurfaceID: UUID?
    let spaceID: TerminalSpaceID
  }

  struct ResolvedCreatePaneTarget {
    let anchorSurface: GhosttySurfaceView
    let spaceID: TerminalSpaceID
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  struct ResolvedCreatePaneTab {
    let space: TerminalSpaceItem
    let tabID: TerminalTabID
    let tree: SplitTree<GhosttySurfaceView>
  }

  func resolveCreateTabTarget(
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
        anchorTabID: tabID,
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
        anchorTabID: spaceManager.selectedTabID(in: space.id),
        inheritedSurfaceID: inheritedSurfaceID(in: space.id),
        space: space
      )
    }
  }

  func resolveLocalCreateTabTarget(
    inheritingFromSurfaceID: UUID?
  ) -> ResolvedLocalCreateTabTarget? {
    if let inheritingFromSurfaceID,
      let anchorTabID = tabID(containing: inheritingFromSurfaceID),
      let space = spaceManager.space(for: anchorTabID)
    {
      return .init(
        anchorTabID: anchorTabID,
        inheritedSurfaceID: inheritingFromSurfaceID,
        spaceID: space.id
      )
    }

    guard let spaceID = spaceManager.selectedSpaceID else {
      return nil
    }

    return .init(
      anchorTabID: spaceManager.selectedTabID(in: spaceID),
      inheritedSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      spaceID: spaceID
    )
  }

  func resolvedNewTabInsertion(
    anchorTabID: TerminalTabID?
  ) -> TerminalTabManager.Insertion {
    switch supatermSettings.newTabPosition {
    case .current:
      guard let anchorTabID else {
        return .end
      }
      return .after(anchorTabID)
    case .end:
      return .end
    }
  }

  struct ResolvedPaneLocation {
    let paneIndex: Int
    let spaceIndex: Int
    let tabIndex: Int
  }

  func resolveCreatePaneTarget(
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
      let resolvedTab = try resolveTab(
        windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
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
      let resolvedTab = try resolveTab(
        windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
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

    return .init(space: space, tabID: tabID, tree: tree)
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

    return .init(
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
    if let unreadSurfaceID = latestUnreadNotifiedSurfaceID(in: tabID),
      let surface = surfaces[unreadSurfaceID]
    {
      focusSurface(surface, in: tabID)
      return
    }
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID], let surface = surfaces[focusedSurfaceID] {
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
    let currentFocusedSurfaceID = focusedSurfaceIDByTab[tabID]
    if currentFocusedSurfaceID != surfaceID, let currentFocusedSurfaceID {
      previousFocusedSurfaceIDByTab[tabID] = currentFocusedSurfaceID
    }
    focusedSurfaceIDByTab[tabID] = surfaceID
  }

  func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
    let previousSurface = focusedSurfaceIDByTab[tabID].flatMap { surfaces[$0] }
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

  func removeTree(for tabID: TerminalTabID) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    for surface in tree.leaves() {
      paneNotifications.removeValue(forKey: surface.id)
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surface.id)
      surface.closeSurface()
      surfaces.removeValue(forKey: surface.id)
    }
    agentActivityByTab.removeValue(forKey: tabID)
    agentActivitySurfaceIDByTab.removeValue(forKey: tabID)
    codexHoverMessagesByTab.removeValue(forKey: tabID)
    focusedSurfaceIDByTab.removeValue(forKey: tabID)
    previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
    previousSelectedTabIDBySpace = previousSelectedTabIDBySpace.filter { $0.value != tabID }
  }

  func notifications(for tabID: TerminalTabID) -> [UUID: [PaneNotification]] {
    guard let tree = trees[tabID] else { return [:] }
    return Dictionary(
      uniqueKeysWithValues: tree.leaves().compactMap { surface in
        paneNotifications[surface.id].map { (surface.id, $0) }
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

  func latestNotification(for tabID: TerminalTabID) -> PaneNotification? {
    Self.latestNotification(in: notifications(for: tabID).values.flatMap { $0 })
  }

  func clearUnreadOnFocusedSurfaceIfNeeded() {
    guard
      let selectedTabID = spaceManager.selectedTabID,
      let surfaceID = focusedSurfaceIDByTab[selectedTabID]
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
      focusedSurfaceID: focusedSurfaceIDByTab[tabID],
      surfaceID: surfaceID
    )
    guard let notifications = paneNotifications[surfaceID] else {
      return
    }
    let updatedNotifications = Self.notificationsAfterDirectInteraction(
      notifications,
      activity: activity
    )
    guard updatedNotifications != notifications else { return }
    paneNotifications[surfaceID] = updatedNotifications
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

  func tabNeedsCloseConfirmation(_ tabID: TerminalTabID) -> Bool {
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

  func surfaceNeedsCloseConfirmation(_ surfaceID: UUID) -> Bool {
    surfaces[surfaceID]?.needsCloseConfirmation ?? false
  }

  func tabID(containing surfaceID: UUID) -> TerminalTabID? {
    for (tabID, tree) in trees where tree.find(id: surfaceID) != nil {
      return tabID
    }
    return nil
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

  func mapGotoTabTarget(_ target: ghostty_action_goto_tab_e) -> TerminalGotoTabTarget? {
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

  func nextTabIndex(in spaceID: TerminalSpaceID) -> Int {
    var maxIndex = 0
    for tab in spaceManager.tabs(in: spaceID) {
      guard tab.title.hasPrefix("Terminal ") else { continue }
      let suffix = tab.title.dropFirst("Terminal ".count)
      guard let value = Int(suffix) else { continue }
      maxIndex = max(maxIndex, value)
    }
    return maxIndex + 1
  }

  func fallbackTitle(for tabID: TerminalTabID) -> String {
    spaceManager.tab(for: tabID)?.defaultTitle ?? "Terminal"
  }

  func setLockedTabTitle(_ title: String?, for tabID: TerminalTabID) {
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .setLockedTitle(tabID, title: title)
    updateTabTitle(for: tabID)
    persistPinnedTabCatalogIfNeeded(for: tabID)
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
    switch agentActivityByTab[tabID]?.phase {
    case .some(.needsInput), .some(.running):
      return true
    case .some(.idle), .none:
      return false
    }
  }

  func titleSurface(for tabID: TerminalTabID) -> GhosttySurfaceView? {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID] {
      return surfaces[focusedSurfaceID]
    }
    return trees[tabID]?.root?.leftmostLeaf()
  }

  func observeSpaceCatalog() {
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

  func applyObservedSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard resolvedSpaceCatalog != lastAppliedSpaceCatalog else { return }

    let previousSelectedSpaceID = selectedSpaceID
    lastAppliedSpaceCatalog = resolvedSpaceCatalog
    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs)
    synchronizePinnedTabCatalogWithSpaces()

    if previousSelectedSpaceID != selectedSpaceID {
      finalizeSpaceSelectionChange()
      sessionDidChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
      sessionDidChange()
    }
  }

  @discardableResult
  func writeSpaceCatalog(
    _ spaceCatalog: TerminalSpaceCatalog
  ) -> TerminalSpaceManager.SpaceCatalogDiff {
    let resolvedSpaceCatalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    replaceSpaceCatalog(resolvedSpaceCatalog)
    lastAppliedSpaceCatalog = resolvedSpaceCatalog

    let diff = spaceManager.applyCatalog(resolvedSpaceCatalog)
    removeTrees(for: diff.removedTabIDs)
    synchronizePinnedTabCatalogWithSpaces()
    return diff
  }

  func persistDefaultSelectedSpaceID(_ spaceID: TerminalSpaceID) {
    guard spaceCatalog.defaultSelectedSpaceID != spaceID else { return }

    var updatedSpaceCatalog = spaceCatalog
    updatedSpaceCatalog.defaultSelectedSpaceID = spaceID
    replaceSpaceCatalog(updatedSpaceCatalog)
    lastAppliedSpaceCatalog = updatedSpaceCatalog
  }

  func replaceSpaceCatalog(_ spaceCatalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = spaceCatalog }
  }

  func nextSelectedSpaceID(afterDeleting spaceID: TerminalSpaceID) -> TerminalSpaceID {
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

  func finalizeSpaceSelectionChange() {
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

  func removeTrees(for tabIDs: [TerminalTabID]) {
    for tabID in tabIDs {
      removeTree(for: tabID)
    }
  }

  func mapSplitDirection(_ direction: GhosttySplitAction.NewDirection)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapSplitDirection(_ direction: TerminalPaneSplitDirection)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapSessionSplitDirection(
    _ direction: SplitTree<GhosttySurfaceView>.Direction
  ) -> TerminalPaneSplitDirection {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapPaneDirection(_ direction: SupatermPaneDirection)
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
      return .up
    }
  }

  func mapFocusDirection(_ direction: GhosttySplitAction.FocusDirection)
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
    case .up:
      return .spatial(.up)
    case .down:
      return .spatial(.down)
    }
  }

  func mapResizeDirection(_ direction: GhosttySplitAction.ResizeDirection)
    -> SplitTree<GhosttySurfaceView>.SpatialDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapResizeDirection(_ direction: SupatermResizePaneDirection)
    -> SplitTree<GhosttySurfaceView>.SpatialDirection
  {
    switch direction {
    case .left:
      return .left
    case .right:
      return .right
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  func mapPaneAxis(_ axis: SupatermPaneAxis)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch axis {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  func mapPaneSizeUnit(_ unit: SupatermPaneSizeUnit)
    -> SplitTree<GhosttySurfaceView>.SizeUnit
  {
    switch unit {
    case .cells:
      return .cells
    case .percent:
      return .percent
    }
  }

  func mapDropZone(_ zone: TerminalSplitTreeView.DropZone)
    -> SplitTree<GhosttySurfaceView>.NewDirection
  {
    switch zone {
    case .up:
      return .up
    case .bottom:
      return .down
    case .left:
      return .left
    case .right:
      return .right
    }
  }

  func debugPaneSnapshot(
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

}
