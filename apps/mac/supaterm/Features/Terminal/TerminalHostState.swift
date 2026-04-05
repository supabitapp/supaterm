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
    fileprivate let origin: NotificationOrigin

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

    fileprivate init(
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

  fileprivate enum NotificationOrigin: Equatable, Sendable {
    case structuredAgent(NotificationSemantic)
    case terminalDesktop
    case generic
  }

  private struct RecentStructuredNotification: Equatable, Sendable {
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

    static func claude(_ phase: AgentActivityPhase) -> Self {
      .init(kind: .claude, phase: phase)
    }

    static func codex(_ phase: AgentActivityPhase) -> Self {
      .init(kind: .codex, phase: phase)
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
  private var runtimeConfigObserver: NSObjectProtocol?
  @ObservationIgnored
  private var lastAppliedSpaceCatalog = TerminalSpaceCatalog.default
  @ObservationIgnored
  var onSessionChange: @MainActor () -> Void = {}
  @ObservationIgnored
  var onCommandFinished: @MainActor (UUID) -> Void = { _ in }
  let spaceManager = TerminalSpaceManager()

  private var pendingEvents: [TerminalClient.Event] = []
  private var trees: [TerminalTabID: SplitTree<GhosttySurfaceView>] = [:]
  private var surfaces: [UUID: GhosttySurfaceView] = [:]
  private var focusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var previousFocusedSurfaceIDByTab: [TerminalTabID: UUID] = [:]
  private var paneNotifications: [UUID: [PaneNotification]] = [:]
  private var agentActivityByTab: [TerminalTabID: AgentActivity] = [:]
  private var previousSelectedTabIDBySpace: [TerminalSpaceID: TerminalTabID] = [:]
  private var previousSelectedSpaceID: TerminalSpaceID?
  private var lastEmittedFocusSurfaceID: UUID?
  private var runtimeConfigGeneration = 0
  private var suppressesSessionChanges = 0
  @ObservationIgnored
  private var recentStructuredNotificationsBySurfaceID: [UUID: RecentStructuredNotification] = [:]

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
    observeRuntimeConfig()
    observeSpaceCatalog()
  }

  isolated deinit {
    spaceCatalogObservationTask?.cancel()
    if let runtimeConfigObserver {
      NotificationCenter.default.removeObserver(runtimeConfigObserver)
    }
  }

  func restorationSnapshot() -> TerminalWindowSession {
    let spaces = spaces.map { space in
      let tabSnapshots = spaceManager.tabs(in: space.id).compactMap {
        tab -> (TerminalTabID, TerminalTabSession)? in
        guard let session = restorationTabSession(for: tab) else { return nil }
        return (tab.id, session)
      }
      let tabs = tabSnapshots.map(\.1)
      let selectedTabIndex =
        spaceManager.selectedTabID(in: space.id).flatMap { selectedTabID in
          tabSnapshots.firstIndex { $0.0 == selectedTabID }
        }
        ?? (tabs.isEmpty ? nil : 0)
      return TerminalWindowSpaceSession(
        id: space.id,
        selectedTabIndex: selectedTabIndex,
        tabs: tabs
      )
    }

    let resolvedSelectedSpaceID =
      self.selectedSpaceID.flatMap { selectedSpaceID in
        spaces.contains(where: { $0.id == selectedSpaceID }) ? selectedSpaceID : nil
      }
      ?? spaces.first?.id
      ?? spaceCatalog.defaultSelectedSpaceID

    return TerminalWindowSession(
      selectedSpaceID: resolvedSelectedSpaceID,
      spaces: spaces
    )
  }

  @discardableResult
  func restore(from session: TerminalWindowSession) -> Bool {
    guard managesTerminalSurfaces else { return false }
    let validSpaceIDs = Set(spaces.map(\.id))
    guard let session = session.pruned(validSpaceIDs: validSpaceIDs) else { return false }

    return withSessionChangesSuppressed {
      clearSessionState()

      let sessionsBySpaceID = Dictionary(
        uniqueKeysWithValues: session.spaces.map { ($0.id, $0) }
      )
      var restoredTabIDsBySpaceID: [TerminalSpaceID: [TerminalTabID]] = [:]

      for space in spaces {
        let restoredTabs =
          sessionsBySpaceID[space.id]?.tabs.enumerated().map { index, session in
            restoredTabItem(for: session, at: index)
          } ?? []
        restoredTabIDsBySpaceID[space.id] = restoredTabs.map(\.id)
        let selectedTabID =
          sessionsBySpaceID[space.id]?.selectedTabIndex.flatMap { index in
            restoredTabs.indices.contains(index) ? restoredTabs[index].id : nil
          }
        _ = spaceManager.restoreTabs(
          restoredTabs,
          selectedTabID: selectedTabID,
          in: space.id
        )
      }

      for spaceSession in session.spaces {
        let restoredTabIDs = restoredTabIDsBySpaceID[spaceSession.id] ?? []
        for (index, tabSession) in spaceSession.tabs.enumerated() {
          guard restoredTabIDs.indices.contains(index) else { continue }
          restoreTabSession(
            tabSession,
            tabID: restoredTabIDs[index],
            in: spaceSession.id
          )
        }
      }

      guard spaces.contains(where: { !spaceManager.tabs(in: $0.id).isEmpty }) else {
        clearSessionState()
        return false
      }

      let selectedSpaceID =
        spaces.contains(where: { $0.id == session.selectedSpaceID })
        ? session.selectedSpaceID
        : spaces.first?.id
      guard let selectedSpaceID, applySelectedSpace(selectedSpaceID) else {
        clearSessionState()
        return false
      }

      if spaceManager.tabs(in: selectedSpaceID).isEmpty {
        _ = createTab(
          in: selectedSpaceID,
          focusing: false,
          sessionChangesEnabled: false,
          synchronizesFocus: false
        )
      }

      if let selectedTabID {
        focusSurface(in: selectedTabID)
      } else {
        lastEmittedFocusSurfaceID = nil
      }
      syncFocus(windowActivity)
      return true
    }
  }

  private func observeRuntimeConfig() {
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
      .requestCloseTabs,
      .requestCloseTabsBelow,
      .requestCloseOtherTabs:
      handleCloseCommand(command)
    case .createTab,
      .ensureInitialTab,
      .createSpace:
      handleCreationCommand(command)
    case .navigateSearch,
      .nextTab,
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

  private func handleCloseCommand(_ command: TerminalClient.Command) {
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
    case .requestCloseTabs(let tabIDs):
      requestCloseTabs(tabIDs)
    case .requestCloseTabsBelow(let tabID):
      requestCloseTabsBelow(tabID)
    case .requestCloseOtherTabs(let tabID):
      requestCloseOtherTabs(tabID)
    default:
      return
    }
  }

  private func handleCreationCommand(_ command: TerminalClient.Command) {
    switch command {
    case .createTab(let inheritingFromSurfaceID):
      _ = createTab(inheritingFromSurfaceID: inheritingFromSurfaceID)
    case .ensureInitialTab(let focusing):
      ensureInitialTab(focusing: focusing)
    case .createSpace:
      createSpace()
    default:
      return
    }
  }

  private func handleInteractionCommand(_ command: TerminalClient.Command) {
    switch command {
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
    case .renameSpace(let spaceID, let name):
      renameSpace(spaceID, to: name)
    default:
      return
    }
  }

  private func handleSelectionCommand(_ command: TerminalClient.Command) {
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

  func sidebarTerminalProgress(for tabID: TerminalTabID) -> TerminalSidebarTerminalProgress? {
    Self.sidebarTerminalProgress(
      state: focusedSurfaceIDByTab[tabID].flatMap { surfaceID in
        surfaces[surfaceID]?.bridge.state
      }
    )
  }

  var selectedPaneIsZoomed: Bool {
    Self.isPaneZoomed(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree
    )
  }

  var selectedPaneDisplayTitle: String {
    Self.selectedPaneDisplayTitle(
      focusedSurfaceID: currentFocusedSurfaceID(),
      in: selectedTree,
      titleOverride: { $0.bridge.state.titleOverride },
      title: { $0.bridge.state.title },
      pwd: { $0.bridge.state.pwd }
    )
  }

  func contextSurfaceID(for tabID: TerminalTabID) -> UUID? {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID], surfaces[focusedSurfaceID] != nil {
      return focusedSurfaceID
    }
    return trees[tabID]?.root?.leftmostLeaf().id
  }

  func paneWorkingDirectories(for tabID: TerminalTabID) -> [String] {
    Self.paneWorkingDirectories(
      in: splitTree(for: tabID),
      pwd: { $0.bridge.state.pwd }
    )
  }

  var terminalBackgroundColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.backgroundColor() ?? .windowBackgroundColor)
  }

  var notificationAttentionColor: Color {
    _ = runtimeConfigGeneration
    return Color(nsColor: runtime?.notificationAttentionColor() ?? .controlAccentColor)
  }

  func latestNotificationText(for tabID: TerminalTabID) -> String? {
    Self.notificationText(
      Self.latestNotification(
        in: notifications(for: tabID)
          .values
          .flatMap { $0 }
          .filter { $0.attentionState != nil }
      )
    )
  }

  func latestSidebarNotificationPresentation(
    for tabID: TerminalTabID
  ) -> SidebarNotificationPresentation? {
    Self.sidebarNotificationPresentation(
      Self.latestNotification(
        in: notifications(for: tabID)
          .values
          .flatMap { $0 }
          .filter { $0.attentionState != nil }
      )
    )
  }

  func notificationRecordCount(for tabID: TerminalTabID) -> Int {
    notifications(for: tabID)
      .values
      .reduce(into: 0) { $0 += $1.count }
  }

  func unreadNotificationCount(for tabID: TerminalTabID) -> Int {
    unreadNotifiedSurfaceIDs(in: tabID).count
  }

  func unreadNotifiedSurfaceIDs(in tabID: TerminalTabID) -> Set<UUID> {
    Set(
      notifications(for: tabID)
        .compactMap { surfaceID, notifications in
          Self.surfaceAttentionState(in: notifications) == .unread ? surfaceID : nil
        }
    )
  }

  func agentActivity(for tabID: TerminalTabID) -> AgentActivity? {
    agentActivityByTab[tabID]
  }

  @discardableResult
  func setAgentActivity(_ activity: AgentActivity, for surfaceID: UUID) -> Bool {
    guard let tabID = tabID(containing: surfaceID) else { return false }
    agentActivityByTab[tabID] = activity
    return true
  }

  @discardableResult
  func clearAgentActivity(for surfaceID: UUID) -> Bool {
    guard let tabID = tabID(containing: surfaceID) else { return false }
    agentActivityByTab.removeValue(forKey: tabID)
    return true
  }
  private func ensureInitialTab(focusing: Bool) {
    guard tabs.isEmpty else { return }
    _ = createTab(focusing: focusing)
  }

  @discardableResult
  private func createTab(
    focusing: Bool = true,
    initialInput: String? = nil,
    inheritingFromSurfaceID: UUID? = nil,
    sessionChangesEnabled: Bool = true
  ) -> TerminalTabID? {
    guard let selectedSpaceID = spaceManager.selectedSpaceID else { return nil }
    return createTab(
      in: selectedSpaceID,
      focusing: focusing,
      initialInput: initialInput,
      inheritingFromSurfaceID: inheritingFromSurfaceID ?? currentFocusedSurfaceID(),
      sessionChangesEnabled: sessionChangesEnabled
    )
  }

  @discardableResult
  private func createTab(
    in spaceID: TerminalSpaceID,
    focusing: Bool = true,
    initialInput: String? = nil,
    workingDirectory: URL? = nil,
    inheritingFromSurfaceID: UUID? = nil,
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
    if synchronizesFocus {
      syncFocus(windowActivity)
    }
    if sessionChangesEnabled {
      sessionDidChange()
    }
    return tabID
  }

  @discardableResult
  private func applySelectedSpace(_ spaceID: TerminalSpaceID) -> Bool {
    let currentSelectedSpaceID = selectedSpaceID
    guard spaceManager.selectSpace(spaceID) else { return false }
    if currentSelectedSpaceID != spaceID, let currentSelectedSpaceID {
      previousSelectedSpaceID = currentSelectedSpaceID
    }
    return true
  }

  private func applySelectedTab(
    _ tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    let currentSelectedTabID = spaceManager.selectedTabID(in: spaceID)
    if currentSelectedTabID != tabID, let currentSelectedTabID {
      previousSelectedTabIDBySpace[spaceID] = currentSelectedTabID
    }
    spaceManager.tabManager(for: spaceID)?.selectTab(tabID)
  }

  private func selectTab(_ tabID: TerminalTabID) {
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

  private func nextSpace() {
    selectAdjacentSpace(step: 1)
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

  private func previousSpace() {
    selectAdjacentSpace(step: -1)
  }

  private func selectLastTab() {
    guard let selectedSpaceID else { return }
    guard let lastTabID = previousSelectedTabIDBySpace[selectedSpaceID] else { return }
    selectTab(lastTabID)
  }

  private func setPinnedTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setPinnedTabOrder(orderedIDs)
    sessionDidChange()
  }

  private func setRegularTabOrder(_ orderedIDs: [TerminalTabID]) {
    spaceManager.activeTabManager?.setRegularTabOrder(orderedIDs)
    sessionDidChange()
  }

  private func moveSidebarTab(
    _ tabID: TerminalTabID,
    pinnedOrder: [TerminalTabID],
    regularOrder: [TerminalTabID]
  ) {
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .moveTab(tabID, pinnedOrder: pinnedOrder, regularOrder: regularOrder)
    sessionDidChange()
  }

  private func togglePinned(_ tabID: TerminalTabID) {
    spaceManager.space(for: tabID).flatMap { spaceManager.tabManager(for: $0.id) }?.togglePinned(
      tabID)
    sessionDidChange()
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
    guard applySelectedSpace(space.id) else { return }
    finalizeSpaceSelectionChange()
    sessionDidChange()
  }

  private func selectSpace(_ spaceID: TerminalSpaceID) {
    selectSpace(spaceID, persistDefaultSelection: true)
  }

  private func selectSpace(
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

  private func selectSpace(slot: Int) {
    let index = slot == 0 ? 9 : slot - 1
    guard spaces.indices.contains(index) else { return }
    selectSpace(spaces[index].id)
  }

  private func selectAdjacentSpace(step: Int) {
    guard
      spaces.count > 1,
      let selectedSpaceID,
      let currentIndex = spaces.firstIndex(where: { $0.id == selectedSpaceID })
    else { return }

    let targetIndex = (currentIndex + step + spaces.count) % spaces.count
    selectSpace(spaces[targetIndex].id)
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

  private func closeSurface(_ surfaceID: UUID) {
    performCloseSurface(surfaceID)
  }

  private func closeTab(_ tabID: TerminalTabID) {
    performCloseTab(tabID)
  }

  private func closeTabs(_ tabIDs: [TerminalTabID]) {
    performCloseTabs(tabIDs)
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

  private func requestCloseTabsBelow(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    requestCloseTabs(tabManager.tabIDsBelow(tabID))
  }

  private func requestCloseOtherTabs(_ tabID: TerminalTabID) {
    guard let space = spaceManager.space(for: tabID) else { return }
    guard let tabManager = spaceManager.tabManager(for: space.id) else { return }
    requestCloseTabs(tabManager.otherTabIDs(tabID))
  }

  private func requestCloseTabs(_ tabIDs: [TerminalTabID]) {
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
    clearUnreadOnFocusedSurfaceIfNeeded()
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
        focusedSurfaceID: focusedSurfaceIDByTab[resolvedTarget.tabID],
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
          inheritingFromSurfaceID: resolvedTarget.inheritedSurfaceID,
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
        applySelectedTab(resolvedSelectedTabID, in: resolvedTarget.space.id)
      }

      if request.focus {
        if currentSelectedSpaceID != resolvedTarget.space.id {
          selectSpace(resolvedTarget.space.id, persistDefaultSelection: true)
        }
        applySelectedTab(tabID, in: resolvedTarget.space.id)
        if let surface = surfaces[surfaceID] {
          focusSurface(surface, in: tabID)
        }
      }

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
        spaceID: resolvedTarget.space.id.rawValue,
        tabIndex: tabIndex + 1,
        tabID: tabID.rawValue,
        paneIndex: paneIndex + 1,
        paneID: surfaceID
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
    guard let lastSurfaceID = previousFocusedSurfaceIDByTab[resolvedTarget.tabID] else {
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
    let resolvedTarget = try resolvePaneTarget(target)
    let result = try paneTarget(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
    performCloseSurface(resolvedTarget.anchorSurface.id)
    return result
  }

  func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
    let resolvedTarget = try resolveTabTarget(target)
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
    let resolvedTarget = try resolveTabTarget(target)
    let result = try tabTarget(for: resolvedTarget.tabID)
    performCloseTab(resolvedTarget.tabID)
    return result
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
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
    return .init(
      target: try paneTarget(
        spaceID: resolvedTarget.spaceID,
        tabID: resolvedTarget.tabID,
        surfaceID: resolvedTarget.anchorSurface.id,
        tree: resolvedTarget.tree
      ),
      text: text
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
    let resolvedTarget = try resolveTabTarget(request.target)
    let title = Self.trimmedNonEmpty(request.title)
    setLockedTabTitle(title, for: resolvedTarget.tabID)
    return .init(
      isTitleLocked: title != nil,
      target: try tabTarget(for: resolvedTarget.tabID)
    )
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
    if let windowIndex = request.target.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    let name =
      Self.trimmedNonEmpty(request.name)
      .flatMap { spaceManager.isNameAvailable($0) ? $0 : nil }
      ?? spaceManager.nextDefaultSpaceName()
    let space = PersistedTerminalSpace(name: name)
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
    return try selectSpaceResult(for: space.id)
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
      _ = try createSpace(
        .init(
          name: nil,
          target: .init(contextPaneID: nil, windowIndex: nil)
        )
      )
    }
    deleteSpace(resolvedTarget.space.id)
    return result
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    let resolvedTarget = try resolveSpaceTarget(request.target)
    renameSpace(resolvedTarget.space.id, to: request.name)
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
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
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
    recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID) != nil
  }

  private func resolveSpaceTarget(_ target: TerminalSpaceTarget) throws -> ResolvedCreateTabTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreateTabTarget(.contextPane(contextPaneID))
      } catch TerminalCreateTabError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreateTabError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreateTabError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .space(let windowIndex, let spaceIndex):
      do {
        return try resolveCreateTabTarget(.space(windowIndex: windowIndex, spaceIndex: spaceIndex))
      } catch TerminalCreateTabError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreateTabError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      }
    }
  }

  private func resolveTabTarget(_ target: TerminalTabTarget) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreatePaneTarget(.contextPane(contextPaneID))
      } catch TerminalCreatePaneError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreatePaneError.tabNotFound(let windowIndex, let spaceIndex, let tabIndex) {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      do {
        return try resolveCreatePaneTarget(
          .tab(windowIndex: windowIndex, spaceIndex: spaceIndex, tabIndex: tabIndex)
        )
      } catch TerminalCreatePaneError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreatePaneError.tabNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex
      ) {
        throw TerminalControlError.tabNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      }
    }
  }

  private func resolvePaneTarget(_ target: TerminalPaneTarget) throws -> ResolvedCreatePaneTarget {
    switch target {
    case .contextPane(let contextPaneID):
      do {
        return try resolveCreatePaneTarget(.contextPane(contextPaneID))
      } catch TerminalCreatePaneError.contextPaneNotFound {
        throw TerminalControlError.contextPaneNotFound
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let spaceIndex) {
        throw TerminalControlError.spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
      } catch TerminalCreatePaneError.tabNotFound(let windowIndex, let spaceIndex, let tabIndex) {
        throw TerminalControlError.tabNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex
        )
      } catch TerminalCreatePaneError.paneNotFound(
        let windowIndex, let spaceIndex, let tabIndex, let paneIndex
      ) {
        throw TerminalControlError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.contextPaneNotFound
      }

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      do {
        return try resolveCreatePaneTarget(
          .pane(
            windowIndex: windowIndex,
            spaceIndex: spaceIndex,
            tabIndex: tabIndex,
            paneIndex: paneIndex
          )
        )
      } catch TerminalCreatePaneError.spaceNotFound(let resolvedWindowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex
        )
      } catch TerminalCreatePaneError.tabNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex
      ) {
        throw TerminalControlError.tabNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex
        )
      } catch TerminalCreatePaneError.paneNotFound(
        let resolvedWindowIndex,
        let resolvedSpaceIndex,
        let resolvedTabIndex,
        let resolvedPaneIndex
      ) {
        throw TerminalControlError.paneNotFound(
          windowIndex: resolvedWindowIndex,
          spaceIndex: resolvedSpaceIndex,
          tabIndex: resolvedTabIndex,
          paneIndex: resolvedPaneIndex
        )
      } catch TerminalCreatePaneError.windowNotFound(let resolvedWindowIndex) {
        throw TerminalControlError.windowNotFound(resolvedWindowIndex)
      } catch {
        throw TerminalControlError.paneNotFound(
          windowIndex: windowIndex,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      }
    }
  }

  private func resolvedNavigationSpaceID(_ request: TerminalSpaceNavigationRequest) throws
    -> TerminalSpaceID
  {
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    if let contextPaneID = request.contextPaneID {
      guard let tabID = tabID(containing: contextPaneID), let space = spaceManager.space(for: tabID)
      else {
        throw TerminalControlError.contextPaneNotFound
      }
      return space.id
    }
    guard let selectedSpaceID else {
      throw TerminalControlError.lastSpaceNotFound
    }
    return selectedSpaceID
  }

  private func resolvedNavigationSpaceID(_ request: TerminalTabNavigationRequest) throws
    -> TerminalSpaceID
  {
    if let windowIndex = request.windowIndex, windowIndex != 1 {
      throw TerminalControlError.windowNotFound(windowIndex)
    }
    if let contextPaneID = request.contextPaneID {
      guard let tabID = tabID(containing: contextPaneID), let space = spaceManager.space(for: tabID)
      else {
        throw TerminalControlError.contextPaneNotFound
      }
      return space.id
    }
    if let spaceIndex = request.spaceIndex {
      do {
        return try resolveSpace(windowIndex: request.windowIndex ?? 1, spaceIndex: spaceIndex).id
      } catch TerminalCreatePaneError.spaceNotFound(let windowIndex, let resolvedSpaceIndex) {
        throw TerminalControlError.spaceNotFound(
          windowIndex: windowIndex, spaceIndex: resolvedSpaceIndex)
      } catch TerminalCreatePaneError.windowNotFound(let windowIndex) {
        throw TerminalControlError.windowNotFound(windowIndex)
      } catch {
        throw TerminalControlError.spaceNotFound(
          windowIndex: request.windowIndex ?? 1, spaceIndex: spaceIndex)
      }
    }
    guard let selectedSpaceID else {
      throw TerminalControlError.lastTabNotFound
    }
    return selectedSpaceID
  }

  private func spaceTarget(for spaceID: TerminalSpaceID) throws -> SupatermSpaceTarget {
    guard let space = spaces.first(where: { $0.id == spaceID }) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    guard let spaceIndex = spaceManager.spaceIndex(for: spaceID) else {
      throw TerminalControlError.spaceNotFound(windowIndex: 1, spaceIndex: 1)
    }
    return .init(
      windowIndex: 1,
      spaceIndex: spaceIndex,
      spaceID: spaceID.rawValue,
      name: space.name
    )
  }

  private func tabTarget(for tabID: TerminalTabID) throws -> SupatermTabTarget {
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
    return .init(
      windowIndex: 1,
      spaceIndex: spaceIndex,
      spaceID: space.id.rawValue,
      tabIndex: tabIndex + 1,
      tabID: tabID.rawValue,
      title: tab.title
    )
  }

  private func paneTarget(
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
    return .init(
      windowIndex: 1,
      spaceIndex: location.spaceIndex,
      spaceID: spaceID.rawValue,
      tabIndex: location.tabIndex,
      tabID: tabID.rawValue,
      paneIndex: location.paneIndex,
      paneID: surfaceID
    )
  }

  private func resolvedFocusedSurface(
    in tabID: TerminalTabID
  ) -> (tree: SplitTree<GhosttySurfaceView>, surface: GhosttySurfaceView)? {
    guard let tree = trees[tabID] else { return nil }
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID], let surface = surfaces[focusedSurfaceID] {
      return (tree, surface)
    }
    guard let surface = tree.root?.leftmostLeaf() else { return nil }
    return (tree, surface)
  }

  private func focusPaneResult(
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
      focusedSurfaceID: focusedSurfaceIDByTab[tabID],
      surfaceID: surfaceID
    )
    return .init(
      isFocused: activity.isFocused,
      isSelectedTab: selectedTabID == tabID,
      target: target
    )
  }

  private func selectTabResult(for tabID: TerminalTabID) throws -> SupatermSelectTabResult {
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
      focusedSurfaceID: focusedSurfaceIDByTab[tabID],
      surfaceID: resolvedSurface.surface.id
    )
    return .init(
      isFocused: activity.isFocused,
      isSelectedSpace: selectedSpaceID == space.id,
      isSelectedTab: selectedTabID == tabID,
      isTitleLocked: spaceManager.tab(for: tabID)?.isTitleLocked == true,
      paneIndex: paneTarget.paneIndex,
      paneID: paneTarget.paneID,
      target: target
    )
  }

  private func selectSpaceResult(for spaceID: TerminalSpaceID) throws -> SupatermSelectSpaceResult {
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
      focusedSurfaceID: focusedSurfaceIDByTab[tabID],
      surfaceID: resolvedSurface.surface.id
    )
    return .init(
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

  private func notify(
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
      focusedSurfaceID: focusedSurfaceIDByTab[resolvedTarget.tabID],
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
    paneNotifications[resolvedTarget.anchorSurface.id, default: []].append(
      PaneNotification(
        attentionState: attentionState,
        body: request.body,
        createdAt: createdAt,
        subtitle: request.subtitle,
        title: resolvedTitle,
        origin: origin
      ))
    updateRecentStructuredNotificationIfNeeded(
      body: request.body,
      createdAt: createdAt,
      origin: origin,
      surfaceID: resolvedTarget.anchorSurface.id,
      title: resolvedTitle
    )

    return .init(
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

  private func handleDesktopNotification(
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
        .init(
          body: body,
          subtitle: subtitle,
          target: .contextPane(surfaceID),
          title: Self.trimmedNonEmpty(title)
        ),
        origin: .terminalDesktop
      )
    else {
      return
    }
    emit(
      .notificationReceived(
        .init(
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
      return true
    }
  }

  private func performSplitOperation(
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
    sessionDidChange()
  }

  private func performCloseTabs(_ tabIDs: [TerminalTabID]) {
    for tabID in tabIDs {
      performCloseTab(tabID)
    }
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
    paneNotifications.removeValue(forKey: surfaceID)
    recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)

    if newTree.isEmpty {
      trees.removeValue(forKey: tabID)
      focusedSurfaceIDByTab.removeValue(forKey: tabID)
      previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
      agentActivityByTab.removeValue(forKey: tabID)
      spaceManager.space(for: tabID)
        .flatMap { spaceManager.tabManager(for: $0.id) }?
        .closeTab(tabID)
      if tabs.isEmpty {
        _ = createTab(focusing: false, sessionChangesEnabled: false)
      } else if let selectedTabID = selectedTabID {
        focusSurface(in: selectedTabID)
      }
      syncFocus(windowActivity)
      sessionDidChange()
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
        previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
      }
    }
    syncFocus(windowActivity)
    sessionDidChange()
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
    configureBridgeCallbacks(for: view, tabID: tabID)
    configureSurfaceCallbacks(for: view, tabID: tabID)
    surfaces[view.id] = view
    return view
  }

  private func configureBridgeCallbacks(
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
    view.bridge.onProgressReport = { [weak self] _ in
      guard let self else { return }
      self.updateRunningState(for: tabID)
    }
    view.bridge.onCommandFinished = { [weak self, weak view] in
      guard let self, let view else { return }
      _ = self.clearAgentActivity(for: view.id)
      self.onCommandFinished(view.id)
    }
    view.bridge.onCloseRequest = { [weak self, weak view] processAlive in
      guard let self, let view else { return }
      self.requestCloseSurface(view.id, needsConfirmation: processAlive)
    }
    view.bridge.onDesktopNotification = { [weak self, weak view] title, body in
      guard let self, let view else { return }
      self.handleDesktopNotification(
        body: body,
        surfaceID: view.id,
        title: title
      )
    }
  }

  private func configureSurfaceCallbacks(
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

  private struct ResolvedPaneLocation {
    let paneIndex: Int
    let spaceIndex: Int
    let tabIndex: Int
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

  private func resolveNotifyTarget(
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

  private func resolvedPaneLocation(
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

  private func updateTabTitle(for tabID: TerminalTabID) {
    let resolvedTitle = currentTabTitle(for: tabID)
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .updateTitle(tabID, title: resolvedTitle)
  }

  private func focusSurface(in tabID: TerminalTabID) {
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

  private func applyFocusedSurface(
    _ surfaceID: UUID,
    in tabID: TerminalTabID
  ) {
    let currentFocusedSurfaceID = focusedSurfaceIDByTab[tabID]
    if currentFocusedSurfaceID != surfaceID, let currentFocusedSurfaceID {
      previousFocusedSurfaceIDByTab[tabID] = currentFocusedSurfaceID
    }
    focusedSurfaceIDByTab[tabID] = surfaceID
  }

  private func focusSurface(_ surface: GhosttySurfaceView, in tabID: TerminalTabID) {
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

  private func removeTree(for tabID: TerminalTabID) {
    guard let tree = trees.removeValue(forKey: tabID) else { return }
    for surface in tree.leaves() {
      paneNotifications.removeValue(forKey: surface.id)
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surface.id)
      surface.closeSurface()
      surfaces.removeValue(forKey: surface.id)
    }
    agentActivityByTab.removeValue(forKey: tabID)
    focusedSurfaceIDByTab.removeValue(forKey: tabID)
    previousFocusedSurfaceIDByTab.removeValue(forKey: tabID)
    previousSelectedTabIDBySpace = previousSelectedTabIDBySpace.filter { $0.value != tabID }
  }

  private func notifications(for tabID: TerminalTabID) -> [UUID: [PaneNotification]] {
    guard let tree = trees[tabID] else { return [:] }
    return Dictionary(
      uniqueKeysWithValues: tree.leaves().compactMap { surface in
        paneNotifications[surface.id].map { (surface.id, $0) }
      }
    )
  }

  private func latestUnreadNotifiedSurfaceID(in tabID: TerminalTabID) -> UUID? {
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

  private func latestNotification(for tabID: TerminalTabID) -> PaneNotification? {
    Self.latestNotification(in: notifications(for: tabID).values.flatMap { $0 })
  }

  private func clearUnreadOnFocusedSurfaceIfNeeded() {
    guard
      let selectedTabID = spaceManager.selectedTabID,
      let surfaceID = focusedSurfaceIDByTab[selectedTabID]
    else {
      return
    }
    clearNotificationAttention(for: surfaceID)
  }

  private func clearNotificationAttention(for surfaceID: UUID) {
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

  private func setLockedTabTitle(_ title: String?, for tabID: TerminalTabID) {
    spaceManager.space(for: tabID)
      .flatMap { spaceManager.tabManager(for: $0.id) }?
      .setLockedTitle(tabID, title: title)
    updateTabTitle(for: tabID)
    sessionDidChange()
  }

  func promptTabTitle(_ tabID: TerminalTabID) {
    guard let view = selectedSurfaceView ?? titleSurface(for: tabID) else { return }
    promptTabTitle(for: tabID, using: view)
  }

  private func promptTabTitle(for tabID: TerminalTabID, using view: GhosttySurfaceView) {
    view.promptTitle(
      messageText: "Change Tab Title",
      initialValue: currentTabTitle(for: tabID)
    ) { [weak self] title in
      self?.setLockedTabTitle(GhosttySurfaceView.titleOverride(from: title), for: tabID)
    }
  }

  private func copyTitleToClipboard(for surfaceID: UUID) -> Bool {
    guard let surface = surfaces[surfaceID] else { return false }
    guard let title = surface.effectiveTitle(), !title.isEmpty else { return false }
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    return pasteboard.setString(title, forType: .string)
  }

  private func currentTabTitle(for tabID: TerminalTabID) -> String {
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

  private func lockedTabTitle(for tabID: TerminalTabID) -> String? {
    guard let tab = spaceManager.tab(for: tabID), tab.isTitleLocked else { return nil }
    return tab.title
  }

  private func resolvedNotificationTitle(
    _ title: String?,
    for tabID: TerminalTabID
  ) -> String {
    Self.trimmedNonEmpty(title) ?? currentTabTitle(for: tabID)
  }

  private func resolvedDesktopNotificationDisposition(
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

  private func hasActiveAgentAttention(for tabID: TerminalTabID) -> Bool {
    switch agentActivityByTab[tabID]?.phase {
    case .some(.needsInput), .some(.running):
      return true
    case .some(.idle), .none:
      return false
    }
  }

  private func titleSurface(for tabID: TerminalTabID) -> GhosttySurfaceView? {
    if let focusedSurfaceID = focusedSurfaceIDByTab[tabID] {
      return surfaces[focusedSurfaceID]
    }
    return trees[tabID]?.root?.leftmostLeaf()
  }

  private func restorationTabSession(for tab: TerminalTabItem) -> TerminalTabSession? {
    guard let tree = trees[tab.id], let root = tree.root.map(restorationNode(for:)) else {
      return nil
    }
    let focusedPaneIndex =
      focusedSurfaceIDByTab[tab.id].flatMap { focusedPaneID in
        tree.leaves().firstIndex(where: { $0.id == focusedPaneID })
      }
      ?? 0
    return TerminalTabSession(
      isPinned: tab.isPinned,
      lockedTitle: lockedTabTitle(for: tab.id),
      focusedPaneIndex: focusedPaneIndex,
      root: root
    )
  }

  private func restorationNode(
    for node: SplitTree<GhosttySurfaceView>.Node
  ) -> TerminalPaneNodeSession {
    switch node {
    case .leaf(let surface):
      return .leaf(
        TerminalPaneLeafSession(
          workingDirectoryPath: workingDirectoryPath(for: surface),
          titleOverride: surface.bridge.state.titleOverride
        )
      )
    case .split(let split):
      return .split(
        TerminalPaneSplitSession(
          direction: mapSessionSplitDirection(split.direction),
          ratio: split.ratio,
          left: restorationNode(for: split.left),
          right: restorationNode(for: split.right)
        )
      )
    }
  }

  private func restoredTabItem(
    for session: TerminalTabSession,
    at index: Int
  ) -> TerminalTabItem {
    TerminalTabItem(
      title: session.lockedTitle ?? restoredTabTitle(at: index),
      icon: "terminal",
      isPinned: session.isPinned,
      isTitleLocked: session.lockedTitle != nil
    )
  }

  private func restoredTabTitle(at index: Int) -> String {
    index == 0 ? "Terminal" : "Terminal \(index + 1)"
  }

  private func restoreTabSession(
    _ session: TerminalTabSession,
    tabID: TerminalTabID,
    in spaceID: TerminalSpaceID
  ) {
    let context: ghostty_surface_context_e =
      spaceManager.tabs(in: spaceID).first?.id == tabID
      ? GHOSTTY_SURFACE_CONTEXT_WINDOW
      : GHOSTTY_SURFACE_CONTEXT_TAB
    let restoredRoot = restoreNode(
      session.root,
      in: tabID,
      context: context
    )
    trees[tabID] = SplitTree(root: restoredRoot, zoomed: nil)
    let leaves = restoredRoot.leaves()
    let focusedPaneIndex =
      leaves.indices.contains(session.focusedPaneIndex)
      ? session.focusedPaneIndex
      : 0
    applyFocusedSurface(leaves[focusedPaneIndex].id, in: tabID)
    updateRunningState(for: tabID)
    updateTabTitle(for: tabID)
  }

  private func restoreNode(
    _ node: TerminalPaneNodeSession,
    in tabID: TerminalTabID,
    context: ghostty_surface_context_e
  ) -> SplitTree<GhosttySurfaceView>.Node {
    switch node {
    case .leaf(let leaf):
      let surface = createSurface(
        tabID: tabID,
        initialInput: nil,
        inheritingFromSurfaceID: nil,
        workingDirectory: existingWorkingDirectoryURL(for: leaf.workingDirectoryPath),
        context: context
      )
      surface.bridge.state.titleOverride = leaf.titleOverride
      return .leaf(view: surface)

    case .split(let split):
      let left = restoreNode(split.left, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      let right = restoreNode(split.right, in: tabID, context: GHOSTTY_SURFACE_CONTEXT_SPLIT)
      return .split(
        .init(
          direction: mapSplitDirection(split.direction),
          ratio: split.ratio,
          left: left,
          right: right
        )
      )
    }
  }

  private func clearSessionState() {
    let existingTabIDs = spaces.flatMap { spaceManager.tabs(in: $0.id).map(\.id) }
    removeTrees(for: existingTabIDs)
    for space in spaces {
      _ = spaceManager.restoreTabs([], selectedTabID: nil, in: space.id)
    }
    previousFocusedSurfaceIDByTab.removeAll()
    previousSelectedTabIDBySpace.removeAll()
    previousSelectedSpaceID = nil
    lastEmittedFocusSurfaceID = nil
  }

  private func sessionDidChange() {
    guard suppressesSessionChanges == 0 else { return }
    onSessionChange()
  }

  private func withSessionChangesSuppressed<Result>(
    _ body: () -> Result
  ) -> Result {
    suppressesSessionChanges += 1
    defer {
      suppressesSessionChanges -= 1
    }
    return body()
  }

  private func workingDirectoryPath(for surface: GhosttySurfaceView) -> String? {
    guard let path = Self.trimmedNonEmpty(surface.bridge.state.pwd) else { return nil }
    return GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
  }

  private func existingWorkingDirectoryURL(for path: String?) -> URL? {
    guard let path = Self.trimmedNonEmpty(path) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
    var isDirectory = ObjCBool(false)
    guard FileManager.default.fileExists(atPath: normalizedPath, isDirectory: &isDirectory) else {
      return nil
    }
    guard isDirectory.boolValue else { return nil }
    return URL(fileURLWithPath: normalizedPath, isDirectory: true)
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
      sessionDidChange()
    } else if !diff.removedTabIDs.isEmpty {
      syncFocus(windowActivity)
      sessionDidChange()
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
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  private func mapSplitDirection(_ direction: TerminalPaneSplitDirection)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  private func mapSessionSplitDirection(
    _ direction: SplitTree<GhosttySurfaceView>.Direction
  ) -> TerminalPaneSplitDirection {
    switch direction {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
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
      return .up
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
    case .up:
      return .spatial(.up)
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
    case .up:
      return .up
    case .down:
      return .down
    }
  }

  private func mapResizeDirection(_ direction: SupatermResizePaneDirection)
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

  private func mapPaneAxis(_ axis: SupatermPaneAxis)
    -> SplitTree<GhosttySurfaceView>.Direction
  {
    switch axis {
    case .horizontal:
      return .horizontal
    case .vertical:
      return .vertical
    }
  }

  private func mapPaneSizeUnit(_ unit: SupatermPaneSizeUnit)
    -> SplitTree<GhosttySurfaceView>.SizeUnit
  {
    switch unit {
    case .cells:
      return .cells
    case .percent:
      return .percent
    }
  }

  private func mapDropZone(_ zone: TerminalSplitTreeView.DropZone)
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
    titleOverride: (Surface) -> String?,
    title: (Surface) -> String?,
    pwd: (Surface) -> String?
  ) -> String where Surface.ID == UUID {
    let leaves = tree?.leaves() ?? []
    guard
      let surface = focusedSurfaceID.flatMap({ id in leaves.first(where: { $0.id == id }) })
        ?? leaves.first
    else {
      return "Pane"
    }
    return resolvedPaneDisplayTitle(
      titleOverride: titleOverride(surface),
      title: title(surface),
      pwd: pwd(surface),
      defaultValue: paneFallbackTitle(for: surface.id, in: tree)
    )
  }

  static func paneWorkingDirectories<Surface: NSView & Identifiable>(
    in tree: SplitTree<Surface>?,
    pwd: (Surface) -> String?
  ) -> [String] where Surface.ID == UUID {
    var seen = Set<String>()
    return (tree?.leaves() ?? []).compactMap { surface in
      guard let path = trimmedNonEmpty(pwd(surface)) else { return nil }
      let normalized = GhosttySurfaceView.normalizedWorkingDirectoryPath(path)
      guard seen.insert(normalized).inserted else { return nil }
      return (normalized as NSString).abbreviatingWithTildeInPath
    }
  }

  static func isPaneZoomed<Surface: NSView & Identifiable>(
    focusedSurfaceID: UUID?,
    in tree: SplitTree<Surface>?
  ) -> Bool where Surface.ID == UUID {
    guard
      let focusedSurfaceID,
      let zoomedSurfaceID = tree?.zoomed?.leftmostLeaf().id
    else {
      return false
    }
    return focusedSurfaceID == zoomedSurfaceID
  }

  static func resolvedPaneDisplayTitle(
    titleOverride: String?,
    title: String?,
    pwd: String?,
    defaultValue: String
  ) -> String {
    if let titleOverride {
      return titleOverride
    }
    if let title, !title.isEmpty {
      return title
    }
    if let pwd = trimmedNonEmpty(pwd) {
      return pwd
    }
    return defaultValue
  }

  static func resolvedTabDisplayTitle(
    titleOverride: String?,
    title: String?,
    pwd: String?,
    defaultValue: String
  ) -> String {
    if let titleOverride {
      return titleOverride
    }
    if let title = trimmedNonEmpty(title) {
      return strippedLeadingWorkingDirectory(from: title, pwd: pwd) ?? title
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

  static func sidebarTerminalProgress(
    state: GhosttySurfaceState?
  ) -> TerminalSidebarTerminalProgress? {
    guard let state else { return nil }

    switch state.progressState {
    case .some(GHOSTTY_PROGRESS_STATE_SET):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .active
      )
    case .some(GHOSTTY_PROGRESS_STATE_INDETERMINATE):
      return .init(fraction: nil, tone: .active)
    case .some(GHOSTTY_PROGRESS_STATE_PAUSE):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 } ?? 1,
        tone: .paused
      )
    case .some(GHOSTTY_PROGRESS_STATE_ERROR):
      return .init(
        fraction: state.progressValue.map { Double(Swift.max(0, Swift.min($0, 100))) / 100 },
        tone: .error
      )
    default:
      return nil
    }
  }

  private func updateRecentStructuredNotificationIfNeeded(
    body: String,
    createdAt: Date,
    origin: NotificationOrigin,
    surfaceID: UUID,
    title: String
  ) {
    guard case .structuredAgent(let semantic) = origin else { return }
    guard
      let text = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      )
    else {
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)
      return
    }
    recentStructuredNotificationsBySurfaceID[surfaceID] = .init(
      recordedAt: createdAt,
      semantic: semantic,
      text: text
    )
  }

  private func coalesceStructuredNotificationIfNeeded(
    body: String,
    origin: NotificationOrigin,
    surfaceID: UUID,
    title: String
  ) {
    guard case .structuredAgent(let semantic) = origin else { return }
    guard
      let structuredText = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      ),
      var notifications = paneNotifications[surfaceID]
    else {
      return
    }
    let now = Date()
    guard
      let index = notifications.indices.reversed().first(where: { index in
        let notification = notifications[index]
        guard
          notification.origin == .terminalDesktop,
          now.timeIntervalSince(notification.createdAt) <= Self.notificationCoalescingWindow,
          let terminalText = Self.normalizedNotificationText(Self.notificationText(notification))
        else {
          return false
        }
        return Self.shouldCoalesceTerminalNotification(
          terminalText: terminalText,
          structuredText: structuredText,
          semantic: semantic
        )
      })
    else {
      return
    }
    notifications.remove(at: index)
    if notifications.isEmpty {
      paneNotifications.removeValue(forKey: surfaceID)
    } else {
      paneNotifications[surfaceID] = notifications
    }
  }

  private func shouldSuppressDesktopNotification(
    body: String,
    surfaceID: UUID,
    title: String
  ) -> Bool {
    guard
      let terminalText = Self.normalizedNotificationText(
        Self.notificationText(body: body, title: title)
      ),
      let recentStructuredNotification = recentStructuredNotification(for: surfaceID)
    else {
      return false
    }
    return Self.shouldCoalesceTerminalNotification(
      terminalText: terminalText,
      structuredText: recentStructuredNotification.text,
      semantic: recentStructuredNotification.semantic
    )
  }

  private func recentStructuredNotification(for surfaceID: UUID) -> RecentStructuredNotification? {
    guard let notification = recentStructuredNotificationsBySurfaceID[surfaceID] else {
      return nil
    }
    guard Date().timeIntervalSince(notification.recordedAt) <= Self.notificationCoalescingWindow
    else {
      recentStructuredNotificationsBySurfaceID.removeValue(forKey: surfaceID)
      return nil
    }
    return notification
  }

  static func latestNotification(in notifications: [PaneNotification]) -> PaneNotification? {
    notifications.max { lhs, rhs in
      lhs.createdAt < rhs.createdAt
    }
  }

  static func unreadNotificationRecordCount(in notifications: [PaneNotification]) -> Int {
    notifications.filter { $0.attentionState == .unread }.count
  }

  static func surfaceAttentionState(
    in notifications: [PaneNotification]
  ) -> SupatermNotificationAttentionState? {
    if notifications.contains(where: { $0.attentionState == .unread }) {
      return .unread
    }
    return nil
  }

  static func notificationsAfterDirectInteraction(
    _ notifications: [PaneNotification],
    activity: SurfaceActivity
  ) -> [PaneNotification] {
    guard activity.isFocused else { return notifications }
    return notifications.map { notification in
      guard notification.attentionState != nil else { return notification }
      var updatedNotification = notification
      updatedNotification.attentionState = nil
      return updatedNotification
    }
  }

  static func notificationText(_ notification: PaneNotification?) -> String? {
    guard let notification else { return nil }
    return notificationText(body: notification.body, title: notification.title)
  }

  static func sidebarNotificationPresentation(
    _ notification: PaneNotification?
  ) -> SidebarNotificationPresentation? {
    guard let markdown = notificationText(notification) else { return nil }
    return .init(
      markdown: markdown,
      previewMarkdown: sidebarNotificationPreviewMarkdown(markdown)
    )
  }

  static func notificationText(body: String, title: String) -> String? {
    let body = body.trimmingCharacters(in: .whitespacesAndNewlines)
    if !body.isEmpty {
      return body
    }
    let title = title.trimmingCharacters(in: .whitespacesAndNewlines)
    return title.isEmpty ? nil : title
  }

  static func sidebarNotificationPreviewMarkdown(
    _ markdown: String
  ) -> String {
    var preview = markdown.trimmingCharacters(in: .whitespacesAndNewlines)
    let replacements = [
      (#"(?m)^\s*\[[^\]]+\]:\s+\S.*$"#, ""),
      (#"(?m)^\s*(```|~~~).*$"#, ""),
      (#"(?m)^\s{0,3}#{1,6}\s*"#, ""),
      (#"(?m)^\s{0,3}>\s?"#, ""),
      (#"(?m)^\s*[-+*]\s+"#, ""),
      (#"(?m)^\s*\d+[.)]\s+"#, ""),
      (#"(?m)^\s*\[[ xX]\]\s+"#, ""),
      (#"!\[([^\]]*)\]\([^)]+\)"#, "$1"),
      (#"\[([^\]]+)\]\([^)]+\)"#, "$1"),
      (#"\[([^\]]+)\]\[[^\]]*\]"#, "$1"),
      (#"(?i)<(?:https?://|mailto:)[^>]+>"#, ""),
      (#"(?i)\b(?:https?://|mailto:)\S+\b"#, ""),
      (#"(?m)^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$"#, ""),
    ]

    for (pattern, template) in replacements {
      preview = replacingMatches(in: preview, pattern: pattern, with: template)
    }

    preview =
      preview
      .split(separator: "\n", omittingEmptySubsequences: true)
      .map { normalizeSidebarNotificationPreviewLine(String($0)) }
      .filter { !$0.isEmpty }
      .joined(separator: " ")

    preview = replacingMatches(in: preview, pattern: #"\s+"#, with: " ", options: [])
    return preview.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func normalizeSidebarNotificationPreviewLine(
    _ line: String
  ) -> String {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return "" }

    let pipeCount = trimmed.reduce(into: 0) { count, character in
      if character == "|" {
        count += 1
      }
    }
    guard trimmed.hasPrefix("|") || trimmed.hasSuffix("|") || pipeCount >= 2 else {
      return trimmed
    }

    let cells =
      trimmed
      .split(separator: "|", omittingEmptySubsequences: false)
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .filter { !$0.isEmpty }
    return cells.joined(separator: " · ")
  }

  private static func replacingMatches(
    in string: String,
    pattern: String,
    with template: String,
    options: NSRegularExpression.Options = [.anchorsMatchLines]
  ) -> String {
    guard let expression = try? NSRegularExpression(pattern: pattern, options: options) else {
      return string
    }
    let range = NSRange(string.startIndex..<string.endIndex, in: string)
    return expression.stringByReplacingMatches(
      in: string, options: [], range: range, withTemplate: template)
  }

  private static let genericCompletionNotificationTexts: Set<String> = [
    "agent turn complete",
    "task complete",
    "turn complete",
  ]

  private static let notificationCoalescingWindow: TimeInterval = 2

  private static func shouldCoalesceTerminalNotification(
    terminalText: String,
    structuredText: String,
    semantic: NotificationSemantic
  ) -> Bool {
    if terminalText == structuredText {
      return true
    }
    if terminalText.count < structuredText.count,
      structuredText.hasPrefix(terminalText)
    {
      return true
    }
    return semantic == .completion
      && genericCompletionNotificationTexts.contains(terminalText)
  }

  private static func normalizedNotificationText(_ value: String?) -> String? {
    guard let value else { return nil }
    let collapsed =
      value
      .components(separatedBy: .whitespacesAndNewlines)
      .filter { !$0.isEmpty }
      .joined(separator: " ")
      .lowercased()
      .trimmingCharacters(in: .punctuationCharacters)
    return collapsed.isEmpty ? nil : collapsed
  }

  private static func trimmedNonEmpty(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
  }

  private static func strippedLeadingWorkingDirectory(
    from title: String,
    pwd: String?
  ) -> String? {
    guard let pwd = trimmedNonEmpty(pwd) else { return nil }
    let normalizedPath = GhosttySurfaceView.normalizedWorkingDirectoryPath(pwd)
    let abbreviatedPath = (normalizedPath as NSString).abbreviatingWithTildeInPath
    let prefixes = Set([normalizedPath, abbreviatedPath]).sorted { $0.count > $1.count }

    for prefix in prefixes where title.hasPrefix(prefix) {
      let suffix = String(title.dropFirst(prefix.count))
      guard let strippedSuffix = strippedTitleSeparator(from: suffix) else { continue }
      return strippedSuffix
    }

    return nil
  }

  private static func strippedTitleSeparator(
    from value: String
  ) -> String? {
    let separatorCharacters =
      CharacterSet.whitespacesAndNewlines
      .union(.punctuationCharacters)
      .union(CharacterSet(charactersIn: "·•›»—–"))
    guard let firstScalar = value.unicodeScalars.first,
      separatorCharacters.contains(firstScalar)
    else {
      return nil
    }

    let stripped = String(
      value.unicodeScalars.drop(while: { separatorCharacters.contains($0) })
    ).trimmingCharacters(in: .whitespacesAndNewlines)

    return stripped.isEmpty ? nil : stripped
  }
}

extension GhosttySurfaceView {
  fileprivate var needsCloseConfirmation: Bool {
    guard let surface else { return false }
    return ghostty_surface_needs_confirm_quit(surface)
  }

  fileprivate func resolvedDisplayTitle(defaultValue: String) -> String {
    TerminalHostState.resolvedPaneDisplayTitle(
      titleOverride: bridge.state.titleOverride,
      title: bridge.state.title,
      pwd: bridge.state.pwd,
      defaultValue: defaultValue
    )
  }
}
