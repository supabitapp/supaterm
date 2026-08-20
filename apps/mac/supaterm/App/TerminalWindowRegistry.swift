import AppKit
import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermSettingsFeature
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
import SwiftUI

@MainActor
final class TerminalWindowRegistry {
  let tabDragRegistry: TerminalTabDragRegistry

  struct CloseAllWindowsCandidate {
    let windowID: ObjectIdentifier
    let needsConfirmation: Bool
  }

  enum CloseAllWindowsPlan {
    case noWindows
    case closeImmediately([ObjectIdentifier])
    case confirm([ObjectIdentifier])
  }

  struct CommandAvailability: Equatable {
    let hasWindow: Bool
    let hasTab: Bool
    let hasSurface: Bool
    var hasAnySurface = false
    var hasAgentPanel = false
    var hasAgentPanelPullRequest = false
    var hasAgentPanelSession = false
  }

  struct MenuContext: Equatable {
    let availability: CommandAvailability
    let closesKeyWindowDirectly: Bool
    let hasSearch: Bool
    let hasSelectedGroup: Bool
    let hasUnreadNotifications: Bool
    let updateMenuItemText: String
    let visibleTabCount: Int
    let spaceCount: Int
    let isUpdateMenuItemEnabled: Bool
  }

  final class WindowReference {
    weak var value: NSWindow?
  }

  struct Entry {
    let keyboardShortcutForAction: (String) -> KeyboardShortcut?
    let requestConfirmedWindowClose: @MainActor () -> Void
    let setTerminatesTerminalSessionsOnClose: @MainActor (Bool) -> Void
    let windowControllerID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let windowReference: WindowReference
  }

  private struct SelectedAgentPanel {
    let pullRequestURL: URL?
    let surfaceID: UUID
    let session: PaneAgentPanelSession?
  }

  var applicationStore: StoreOf<AppFeature>?

  private var entries: [Entry] = []
  private let zmxClient: ZmxClient
  @Shared(.terminalSpaceCatalog)
  private var spaceCatalog = TerminalSpaceCatalog.default
  var onChange: @MainActor () -> Void = {}

  init(zmxClient: ZmxClient = .live) {
    let tabDragRegistry = TerminalTabDragRegistry()
    self.tabDragRegistry = tabDragRegistry
    self.zmxClient = zmxClient
    tabDragRegistry.transfer = { [weak self] payload, destination in
      self?.transferTab(payload, to: destination)
    }
    tabDragRegistry.split = { [weak self] payload, destination in
      self?.splitTab(payload, to: destination) == true
    }
  }

  var hasShortcutSource: Bool {
    !entries.isEmpty
  }

  var bypassesQuitConfirmation: Bool {
    processUpdateState.phase.bypassesQuitConfirmation
  }

  private var processUpdateState: UpdateFeature.State {
    applicationStore?.update
      ?? preferredActiveEntry()?.store.update
      ?? UpdateFeature.State()
  }

  func register(
    keyboardShortcutForAction: @escaping (String) -> KeyboardShortcut?,
    windowControllerID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    requestConfirmedWindowClose: @escaping @MainActor () -> Void,
    setTerminatesTerminalSessionsOnClose: @escaping @MainActor (Bool) -> Void = { _ in }
  ) {
    guard !entries.contains(where: { $0.windowControllerID == windowControllerID }) else { return }
    terminal.onSpaceAction = { [weak self] action in
      self?.performSpaceAction(action, from: windowControllerID)
    }
    terminal.onTabDroppedOnSpace = { [weak self] payload, spaceID in
      self?.dropTab(payload, on: spaceID, in: windowControllerID) == true
    }
    terminal.paneCountAcrossWindows = { [weak self] spaceID in
      self?.paneCount(inSpace: spaceID) ?? 0
    }
    let entry = Entry(
      keyboardShortcutForAction: keyboardShortcutForAction,
      requestConfirmedWindowClose: requestConfirmedWindowClose,
      setTerminatesTerminalSessionsOnClose: setTerminatesTerminalSessionsOnClose,
      windowControllerID: windowControllerID,
      store: store,
      terminal: terminal,
      windowReference: WindowReference()
    )
    entries.append(entry)
    onChange()
  }

  func unregister(windowControllerID: UUID) {
    entries.removeAll { $0.windowControllerID == windowControllerID }
    onChange()
  }

  func updateWindow(_ window: NSWindow?, for windowControllerID: UUID) {
    guard let index = entries.firstIndex(where: { $0.windowControllerID == windowControllerID })
    else { return }
    entries[index].windowReference.value = window
    onChange()
  }

  func markWindowFocused(_ windowControllerID: UUID) {
    guard let index = entries.firstIndex(where: { $0.windowControllerID == windowControllerID })
    else { return }
    persistDefaultSpace(entries[index].terminal.displayedSpaceID)
    entries.append(entries.remove(at: index))
    onChange()
  }

  var preferredSpaceID: TerminalSpaceID? {
    preferredActiveEntry()?.terminal.displayedSpaceID
  }

  var preferredTerminalWindow: NSWindow? {
    preferredActiveEntry()?.windowReference.value
  }

  var spaceCount: Int {
    TerminalSpaceCatalog.sanitized(spaceCatalog).spaces.count
  }

  func paneCount(inSpace spaceID: TerminalSpaceID) -> Int {
    activeEntries().reduce(0) { $0 + $1.terminal.paneCount(inSpace: spaceID) }
  }

  @discardableResult
  func selectSpace(
    _ spaceID: TerminalSpaceID,
    in windowControllerID: UUID? = nil,
    animated: Bool = true
  ) -> Bool {
    guard
      let entry = entry(in: windowControllerID),
      entry.terminal.switchSpace(to: spaceID, animated: animated)
    else {
      return false
    }
    if let window = entry.windowReference.value {
      if window.isMiniaturized {
        window.deminiaturize(nil)
      }
      window.makeKeyAndOrderFront(nil)
    }
    markWindowFocused(entry.windowControllerID)
    return true
  }

  @discardableResult
  func createSpace(
    named name: String,
    color: ThemeTint = .neutral,
    in windowControllerID: UUID? = nil
  ) throws -> TerminalSpaceID {
    guard let name = normalizedSpaceName(name) else {
      throw TerminalControlError.invalidSpaceName
    }
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard
      !catalog.spaces.contains(where: {
        $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame
      })
    else {
      throw TerminalControlError.spaceNameUnavailable
    }
    let space = TerminalSpaceItem(name: name, color: color)
    catalog.spaces.append(space)
    replaceSpaceCatalog(catalog)
    guard let entry = entry(in: windowControllerID) else { return space.id }
    entry.terminal.warmSpace(space.id)
    selectSpace(space.id, in: entry.windowControllerID)
    return space.id
  }

  func renameSpace(_ spaceID: TerminalSpaceID, to proposedName: String) throws {
    guard let name = normalizedSpaceName(proposedName) else {
      throw TerminalControlError.invalidSpaceName
    }
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard let index = catalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    guard
      !catalog.spaces.contains(where: {
        $0.id != spaceID && $0.name.localizedCaseInsensitiveCompare(name) == .orderedSame
      })
    else {
      throw TerminalControlError.spaceNameUnavailable
    }
    catalog.spaces[index].name = name
    replaceSpaceCatalog(catalog)
  }

  func setSpaceColor(_ spaceID: TerminalSpaceID, to color: ThemeTint) throws {
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard let index = catalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    catalog.spaces[index].color = color
    replaceSpaceCatalog(catalog)
  }

  func deleteSpace(_ spaceID: TerminalSpaceID) throws {
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard let index = catalog.spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    guard catalog.spaces.count > 1 else {
      throw TerminalControlError.onlyRemainingSpace
    }
    let neighborSpaceID = catalog.spaces[index == 0 ? 1 : index - 1].id
    catalog.spaces.remove(at: index)
    if catalog.defaultSelectedSpaceID == spaceID {
      catalog.defaultSelectedSpaceID = neighborSpaceID
    }
    replaceSpaceCatalog(catalog)
    for entry in activeEntries() {
      entry.terminal.applyObservedSpaceCatalog(catalog)
    }
  }

  func reorderSpace(_ spaceID: TerminalSpaceID, toInsertionIndex insertionIndex: Int) {
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    guard catalog.moveSpace(spaceID, toInsertionIndex: insertionIndex) else { return }
    replaceSpaceCatalog(catalog)
  }

  @discardableResult
  func dropTab(
    _ payload: TerminalTabDragPayload,
    on spaceID: TerminalSpaceID,
    in windowControllerID: UUID
  ) -> Bool {
    guard
      let entry = entry(forWindowControllerID: windowControllerID),
      let collection = entry.terminal.spaceManager.tabCollection(for: spaceID)
    else { return false }
    let regularIndex = collection.rootItems.filter { !$0.isPinned }.count
    let destination = TerminalTabDragRegistry.Destination(
      windowControllerID: windowControllerID,
      spaceID: spaceID,
      expectedTopologyRevision: collection.topologyRevision,
      placement: .root(TerminalRootPlacement(isPinned: false, index: regularIndex))
    )
    guard tabDragRegistry.performTransfer(payload, to: destination) != nil else { return false }
    return selectSpace(spaceID, in: windowControllerID)
  }

  @discardableResult
  func selectAdjacentSpace(step: Int, in windowControllerID: UUID? = nil) -> Bool {
    guard
      let entry = entry(in: windowControllerID),
      let spaceID = TerminalSpaceCatalog.sanitized(spaceCatalog)
        .spaceID(adjacentTo: entry.terminal.displayedSpaceID, step: step)
    else {
      return false
    }
    return selectSpace(spaceID, in: entry.windowControllerID)
  }

  @discardableResult
  func selectSpaceSlot(_ slot: Int, in windowControllerID: UUID? = nil) -> Bool {
    let index = slot == 0 ? 9 : slot - 1
    let spaces = TerminalSpaceCatalog.sanitized(spaceCatalog).spaces
    guard spaces.indices.contains(index) else { return false }
    return selectSpace(spaces[index].id, in: windowControllerID)
  }

  func selectSpaceResult(
    _ spaceID: TerminalSpaceID,
    context: SupatermCLIContext?
  ) throws -> SupatermSelectSpaceResult {
    let entry = try ambientEntry(for: context)
    guard selectSpace(spaceID, in: entry.windowControllerID) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return try spaceResult(for: spaceID, in: entry)
  }

  func createSpaceResult(
    named name: String,
    color: ThemeTint?,
    context: SupatermCLIContext?
  ) throws -> SupatermCreateSpaceResult {
    let entry = try ambientEntry(for: context)
    let spaceID = try createSpace(
      named: name,
      color: color ?? ThemeTint.chromatic.randomElement() ?? .blue,
      in: entry.windowControllerID
    )
    return try spaceResult(for: spaceID, in: entry)
  }

  func deleteSpaceResult(
    _ spaceID: TerminalSpaceID,
    context: SupatermCLIContext?
  ) throws -> SupatermCloseSpaceResult {
    let entry = try ambientEntry(for: context)
    let target = try spaceTargetResult(for: spaceID, in: entry)
    try deleteSpace(spaceID)
    return target
  }

  func renameSpaceResult(
    _ spaceID: TerminalSpaceID,
    to name: String,
    context: SupatermCLIContext?
  ) throws -> SupatermSpaceTarget {
    let entry = try ambientEntry(for: context)
    try renameSpace(spaceID, to: name)
    return try spaceTargetResult(for: spaceID, in: entry)
  }

  func setSpaceColorResult(
    _ spaceID: TerminalSpaceID,
    to color: ThemeTint,
    context: SupatermCLIContext?
  ) throws -> SupatermSpaceTarget {
    let entry = try ambientEntry(for: context)
    try setSpaceColor(spaceID, to: color)
    return try spaceTargetResult(for: spaceID, in: entry)
  }

  func adjacentSpaceResult(
    step: Int,
    context: SupatermCLIContext?
  ) throws -> SupatermSelectSpaceResult {
    let entry = try ambientEntry(for: context)
    guard
      let targetSpaceID = TerminalSpaceCatalog.sanitized(spaceCatalog)
        .spaceID(adjacentTo: entry.terminal.displayedSpaceID, step: step)
    else {
      throw TerminalControlError.lastSpaceNotFound
    }
    return try selectSpaceResult(targetSpaceID, context: context)
  }

  func lastSpaceResult(context: SupatermCLIContext?) throws -> SupatermSelectSpaceResult {
    let entry = try ambientEntry(for: context)
    guard let lastDisplayedSpaceID = entry.terminal.spaceManager.lastDisplayedSpaceID else {
      throw TerminalControlError.lastSpaceNotFound
    }
    return try selectSpaceResult(lastDisplayedSpaceID, context: context)
  }

  func commandAvailability() -> CommandAvailability {
    guard let entry = preferredActiveEntry() else {
      return CommandAvailability(hasWindow: false, hasTab: false, hasSurface: false, hasAnySurface: hasAnySurface)
    }

    return commandAvailability(for: entry)
  }

  func menuContext(keyWindow: NSWindow? = NSApp.keyWindow) -> MenuContext {
    let closesKeyWindowDirectly = closesWindowDirectly(keyWindow)
    let updateState = processUpdateState
    let updateMenuItemAction = Self.updateMenuItemAction(for: updateState)
    guard let entry = preferredActiveEntry() else {
      return MenuContext(
        availability: CommandAvailability(
          hasWindow: false, hasTab: false, hasSurface: false, hasAnySurface: hasAnySurface),
        closesKeyWindowDirectly: closesKeyWindowDirectly,
        hasSearch: false,
        hasSelectedGroup: false,
        hasUnreadNotifications: false,
        updateMenuItemText: updateState.phase.menuItemTitle,
        visibleTabCount: 0,
        spaceCount: 0,
        isUpdateMenuItemEnabled: updateMenuItemAction != nil
      )
    }

    return MenuContext(
      availability: commandAvailability(for: entry),
      closesKeyWindowDirectly: closesKeyWindowDirectly,
      hasSearch: entry.terminal.selectedSurfaceState?.searchNeedle != nil,
      hasSelectedGroup: selectedGroupID(in: entry) != nil,
      hasUnreadNotifications: hasUnreadNotifications,
      updateMenuItemText: updateState.phase.menuItemTitle,
      visibleTabCount: entry.terminal.visibleTabs.count,
      spaceCount: spaceCount,
      isUpdateMenuItemEnabled: updateMenuItemAction != nil
    )
  }

  func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    shortcutEntry()?.keyboardShortcutForAction(action)
  }

  func requestNewTabInKeyWindow() {
    guard let entry = preferredActiveEntry() else { return }
    AppPostHog.capture("terminal_tab_created")
    _ = entry.terminal.createTab(inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id)
  }

  func requestNewTabInSelectedGroupInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let groupID = selectedGroupID(in: entry)
    else {
      return
    }
    AppPostHog.capture("terminal_tab_created")
    _ = entry.terminal.createTab(
      in: groupID,
      inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id
    )
  }

  @discardableResult
  func createTabInPreferredWindow(workingDirectoryPath: String) -> Bool {
    guard let entry = preferredActiveEntry() else { return false }
    if let window = entry.windowReference.value {
      if window.isMiniaturized {
        window.deminiaturize(nil)
      }
      window.makeKeyAndOrderFront(nil)
    }
    return entry.terminal.createTab(
      focusing: true,
      workingDirectoryPath: workingDirectoryPath,
      inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id
    ) != nil
  }

  func requestNextTabInKeyWindow() {
    preferredActiveEntry()?.terminal.nextTab()
  }

  func requestPreviousTabInKeyWindow() {
    preferredActiveEntry()?.terminal.previousTab()
  }

  func requestSelectTabInKeyWindow(_ slot: Int) {
    preferredActiveEntry()?.terminal.selectTab(slot: slot)
  }

  func requestSelectLastTabInKeyWindow() {
    preferredActiveEntry()?.terminal.selectLastTab()
  }

  func requestSelectSpaceInKeyWindow(_ slot: Int) {
    selectSpaceSlot(slot)
  }

  func requestNextSpaceInKeyWindow() {
    selectAdjacentSpace(step: 1)
  }

  func requestPreviousSpaceInKeyWindow() {
    selectAdjacentSpace(step: -1)
  }

  func requestToggleSidebarInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.toggleSidebarButtonTapped))
  }

  func requestToggleAgentPanelInKeyWindow() {
    performCommandPaletteAppAction(.toggleAgentPanel, windowID: nil)
  }

  func requestOpenAgentPanelPullRequestInKeyWindow() {
    performCommandPaletteAppAction(.openPullRequest, windowID: nil)
  }

  func requestForkAgentPanelSessionInKeyWindow(direction: SupatermPaneDirection) {
    guard let entry = preferredActiveEntry() else { return }
    forkAgentPanelSession(in: entry, direction: direction)
  }

  func requestCopyAgentPanelSessionIDInKeyWindow() {
    performCommandPaletteAppAction(.copyAgentSessionID, windowID: nil)
  }

  func requestToggleCommandPaletteInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.commandPaletteToggleRequested))
  }

  func requestBindingActionInKeyWindow(_ command: SupatermCommand) {
    _ = preferredActiveEntry()?.terminal.performBindingActionOnFocusedSurface(command)
  }

  func requestNavigateSearchInKeyWindow(_ direction: GhosttySearchDirection) {
    _ = preferredActiveEntry()?.terminal.navigateSearchOnFocusedSurface(direction)
  }

  @discardableResult
  func requestUpdateMenuActionInKeyWindow() -> Bool {
    guard let store = applicationStore ?? preferredActiveEntry()?.store else { return false }
    guard let action = Self.updateMenuItemAction(for: store.update) else {
      return false
    }
    store.send(.update(.perform(action)))
    return true
  }

  func setUpdateChannel(_ updateChannel: UpdateChannel) {
    (applicationStore ?? preferredActiveEntry()?.store)?
      .send(.update(.setUpdateChannel(updateChannel)))
  }

  func requestCloseSurfaceInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let surfaceID = entry.terminal.selectedSurfaceView?.id
    else {
      SupatermLog.debug(
        SupatermLog.terminal,
        "terminal.close.registryRequest.dropped",
        fields: ["reason=missingSurface"]
      )
      return
    }
    SupatermLog.debug(
      SupatermLog.terminal,
      "terminal.close.registryRequest",
      fields: [
        "surfaceID=\(SupatermLog.uuid(surfaceID))",
        "tabID=\(SupatermLog.uuid(entry.terminal.selectedTabID?.rawValue))",
      ]
    )
    entry.terminal.requestCloseSurface(surfaceID)
  }

  func ownsWindow(_ window: NSWindow) -> Bool {
    entry(for: window) != nil
  }

  func closesWindowDirectly(_ window: NSWindow?) -> Bool {
    guard let window else { return false }
    guard !ownsWindow(window) else { return false }
    return window.styleMask.contains(.closable)
  }

  func requestCloseTabInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let tabID = entry.terminal.selectedTabID
    else {
      return
    }
    entry.terminal.requestCloseTab(tabID)
  }

  @discardableResult
  func requestCloseAllWindows() -> Bool {
    let activeEntries = activeEntries()
    switch Self.closeAllWindowsPlan(for: closeAllWindowsCandidates(from: activeEntries)) {
    case .noWindows:
      return false

    case .closeImmediately(let windowIDs):
      closeWindows(windowIDs)
      return true

    case .confirm(let windowIDs):
      guard let entry = preferredActiveEntry() ?? activeEntries.first else {
        return false
      }
      entry.store.send(.terminal(.closeAllWindowsRequested(windowIDs)))
      return true
    }
  }

  static func closeAllWindowsPlan(for candidates: [CloseAllWindowsCandidate]) -> CloseAllWindowsPlan {
    let windowIDs = candidates.map(\.windowID)
    guard !windowIDs.isEmpty else { return .noWindows }
    guard candidates.contains(where: \.needsConfirmation) else {
      return .closeImmediately(windowIDs)
    }
    return .confirm(windowIDs)
  }

  func closeWindow(_ windowID: ObjectIdentifier) {
    guard let entry = entry(for: windowID) else { return }
    entry.requestConfirmedWindowClose()
  }

  func closeWindows(_ windowIDs: [ObjectIdentifier]) {
    for windowID in windowIDs {
      closeWindow(windowID)
    }
  }

  func terminateTerminalSessionsAndWait() async {
    for entry in activeEntries() {
      await entry.terminal.terminateTerminalSessionsAndWait()
    }
  }

  func setTerminatesTerminalSessionsOnWindowClose(_ terminates: Bool) {
    for entry in activeEntries() {
      entry.setTerminatesTerminalSessionsOnClose(terminates)
    }
  }

  func terminateAllTerminalSessions() {
    let windowIDs = activeEntries().compactMap { entry in
      entry.windowReference.value.map(ObjectIdentifier.init)
    }
    Task { @MainActor in
      await terminateTerminalSessionsAndWait()
      await terminateAllZmxSessionsAndWait()
      closeWindows(windowIDs)
    }
  }

  func terminateAllZmxSessionsAndWait() async {
    SupatermLog.debug(SupatermLog.zmx, "zmx.terminateAll.start")
    await Self.terminateAllZmxSessions(using: zmxClient)
    SupatermLog.debug(SupatermLog.zmx, "zmx.terminateAll.finished")
  }

  func restorationSnapshot() -> TerminalSessionCatalog {
    TerminalSessionCatalog(
      windows: activeEntries().map { entry in
        var snapshot = entry.terminal.restorationSnapshot()
        snapshot.frame = entry.windowReference.value.map { TerminalWindowFrame($0.frame) }
        snapshot.sidebarWidth = entry.store.terminal.sidebarWidth.map { Double($0) }
        return snapshot
      }
    )
  }

  var hasAnySurface: Bool {
    !liveSurfaceIDs().isEmpty
  }

  var hasUnreadNotifications: Bool {
    activeEntries().contains { $0.terminal.latestUnreadNotificationTarget() != nil }
  }

  func liveSurfaceIDs() -> Set<UUID> {
    activeEntries().reduce(into: Set<UUID>()) { result, entry in
      result.formUnion(entry.terminal.liveSurfaceIDs())
    }
  }

  func commandPaletteSnapshot(windowID: ObjectIdentifier?) -> TerminalCommandPaletteSnapshot {
    guard let entry = commandPaletteEntry(for: windowID) else {
      return .empty
    }

    let terminal = entry.terminal
    let updateState = processUpdateState
    let availability = commandAvailability(for: entry)
    let focusTargets = activeEntries().flatMap { activeEntry in
      activeEntry.terminal.commandPaletteFocusTargets(
        windowControllerID: activeEntry.windowControllerID
      )
    }

    return TerminalCommandPaletteSnapshot(
      availableAppActions: commandPaletteAppActions(
        availability: availability,
        hasUnreadNotifications: hasUnreadNotifications
      ),
      ghosttyShortcutDisplayByAction: terminal.commandPaletteGhosttyShortcutDisplayByAction(),
      updateEntries: Self.commandPaletteUpdateEntries(for: updateState),
      focusTargets: focusTargets,
      selectedSurfaceID: terminal.selectedSurfaceView?.id,
      selectedTabPaneCount: terminal.selectedTree?.leaves().count ?? 0,
      selectedPaneIsZoomed: terminal.selectedPaneIsZoomed,
      selectedSpaceID: terminal.displayedSpaceID,
      spaces: terminal.spaces,
      selectedTabID: terminal.selectedTabID,
      rootItems: terminal.rootItems
    )
  }

  func focusCommandPalettePane(_ target: TerminalCommandPaletteFocusTarget) {
    guard let entry = entry(forWindowControllerID: target.windowControllerID) else { return }
    guard let window = entry.windowReference.value else { return }
    window.makeKeyAndOrderFront(nil)
    entry.terminal.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
    focusPane(target.surfaceID, in: entry)
  }

  @discardableResult
  func focusNotificationSurface(_ surfaceID: UUID) -> Bool {
    for entry in activeEntries() {
      guard
        entry.terminal.tabID(containing: surfaceID) != nil,
        let window = entry.windowReference.value
      else {
        continue
      }
      NSApp.activate(ignoringOtherApps: true)
      if window.isMiniaturized {
        window.deminiaturize(nil)
      }
      window.makeKeyAndOrderFront(nil)
      entry.terminal.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
      return focusPane(surfaceID, in: entry)
    }
    return false
  }

  @discardableResult
  private func focusPane(_ surfaceID: UUID, in entry: Entry) -> Bool {
    markWindowFocused(entry.windowControllerID)
    return (try? entry.terminal.focusPane(TerminalPaneTarget(paneID: surfaceID))) != nil
  }

  @discardableResult
  func jumpToLatestUnread() -> Bool {
    guard
      let target = activeEntries()
        .compactMap({ $0.terminal.latestUnreadNotificationTarget() })
        .max(by: { $0.isOlder(than: $1) })
    else {
      return false
    }
    return focusNotificationSurface(target.surfaceID)
  }

  func performCommandPaletteUpdateAction(
    _ action: UpdateUserAction,
    windowID: ObjectIdentifier?
  ) {
    guard let entry = commandPaletteEntry(for: windowID) else { return }
    (applicationStore ?? entry.store).send(.update(.perform(action)))
  }

  func performCommandPaletteAppAction(
    _ action: TerminalCommandPaletteAppAction,
    windowID: ObjectIdentifier?
  ) {
    switch action {
    case .jumpToLatestUnread:
      jumpToLatestUnread()
    case .openSettings:
      (NSApp.delegate as? AppDelegate)?.performShowSettings(tab: .general)
    case .copyAgentSessionID:
      guard
        let entry = commandPaletteEntry(for: windowID),
        let session = selectedAgentPanel(in: entry)?.session
      else { return }
      entry.store.send(.terminal(.agentPanelCopyText(session.sessionID)))
    case .forkAgentSession:
      guard let entry = commandPaletteEntry(for: windowID) else { return }
      forkAgentPanelSession(in: entry, direction: .right)
    case .openPullRequest:
      guard
        let entry = commandPaletteEntry(for: windowID),
        let url = selectedAgentPanel(in: entry)?.pullRequestURL
      else { return }
      entry.store.send(.terminal(.agentPanelURLTapped(url)))
    case .toggleAgentPanel:
      guard
        let entry = commandPaletteEntry(for: windowID),
        let surfaceID = selectedAgentPanel(in: entry)?.surfaceID
      else { return }
      entry.store.send(.terminal(.agentPanelVisibilityToggled(surfaceID)))
    }
  }

  func activeEntries() -> [Entry] {
    entries.filter { $0.windowReference.value != nil }
  }

  func preferredActiveEntry() -> Entry? {
    if let keyWindow = NSApp.keyWindow, let entry = entry(for: keyWindow) {
      return entry
    }
    return activeEntries().last(where: { $0.terminal.windowActivity.isKeyWindow })
      ?? activeEntries().last
  }

  func shortcutEntry() -> Entry? {
    preferredActiveEntry() ?? entries.first
  }

  private func selectedAgentPanel(in entry: Entry) -> SelectedAgentPanel? {
    guard let surfaceID = entry.terminal.selectedSurfaceView?.id else { return nil }
    guard let presentation = entry.terminal.agentPanelPresentation(for: surfaceID) else { return nil }
    return SelectedAgentPanel(
      pullRequestURL: presentation.branchDetails?.displayedPullRequestStatus?.url,
      surfaceID: surfaceID,
      session: presentation.session
    )
  }

  private func forkAgentPanelSession(
    in entry: Entry,
    direction: SupatermPaneDirection
  ) {
    guard
      let panel = selectedAgentPanel(in: entry),
      let session = panel.session
    else { return }
    _ = try? entry.terminal.createPane(
      TerminalCreatePaneRequest(
        startupCommand: session.forkStartupCommand,
        cwd: session.workingDirectoryPath,
        direction: direction,
        focus: true,
        equalize: false,
        target: .pane(panel.surfaceID)
      )
    )
  }

  private func selectedGroupID(in entry: Entry) -> TerminalTabGroupID? {
    guard let tabID = entry.terminal.selectedTabID else { return nil }
    return entry.terminal.spaceManager.displayedInstance.tabCollection.groupID(containing: tabID)
  }

  private func commandAvailability(for entry: Entry) -> CommandAvailability {
    let selectedAgentPanel = selectedAgentPanel(in: entry)
    return CommandAvailability(
      hasWindow: true,
      hasTab: entry.terminal.selectedTabID != nil,
      hasSurface: entry.terminal.selectedSurfaceView != nil,
      hasAnySurface: hasAnySurface,
      hasAgentPanel: selectedAgentPanel != nil,
      hasAgentPanelPullRequest: selectedAgentPanel?.pullRequestURL != nil,
      hasAgentPanelSession: selectedAgentPanel?.session != nil
    )
  }

  private func commandPaletteAppActions(
    availability: CommandAvailability,
    hasUnreadNotifications: Bool
  ) -> Set<TerminalCommandPaletteAppAction> {
    var actions: Set<TerminalCommandPaletteAppAction> = [.openSettings]
    if hasUnreadNotifications {
      actions.insert(.jumpToLatestUnread)
    }
    if availability.hasAgentPanel {
      actions.insert(.toggleAgentPanel)
    }
    if availability.hasAgentPanelPullRequest {
      actions.insert(.openPullRequest)
    }
    if availability.hasAgentPanelSession {
      actions.formUnion([.copyAgentSessionID, .forkAgentSession])
    }
    return actions
  }

  private static func updateMenuItemAction(for state: UpdateFeature.State) -> UpdateUserAction? {
    state.phase.menuItemAction ?? (state.canCheckForUpdates ? .checkForUpdates : nil)
  }

  private static func commandPaletteUpdateEntries(
    for state: UpdateFeature.State
  ) -> [TerminalCommandPaletteUpdateEntry] {
    let summary = state.phase.summaryText.trimmingCharacters(in: .whitespacesAndNewlines)
    let detail = state.phase.detailMessage.trimmingCharacters(in: .whitespacesAndNewlines)

    var entries: [TerminalCommandPaletteUpdateEntry] = state.phase.actionPresentations.map { presentation in
      TerminalCommandPaletteUpdateEntry(
        id: "\(state.phase.debugIdentifier):\(presentation.title)",
        title: presentation.title,
        subtitle: summary.isEmpty ? nil : summary,
        description: detail.isEmpty ? nil : detail,
        leadingIcon: state.phase.iconName,
        badge: state.phase.badgeText,
        emphasis: presentation.isProminent,
        action: presentation.action
      )
    }

    if entries.isEmpty, let action = updateMenuItemAction(for: state) {
      entries.append(
        TerminalCommandPaletteUpdateEntry(
          id: "menu:\(state.phase.debugIdentifier):\(state.phase.menuItemTitle)",
          title: state.phase.menuItemTitle,
          subtitle: summary.isEmpty ? nil : summary,
          description: detail.isEmpty ? nil : detail,
          leadingIcon: state.phase.menuItemAction == .restartNow ? state.phase.iconName : nil,
          badge: state.phase.badgeText,
          emphasis: state.phase.menuItemAction == .restartNow,
          action: action
        )
      )
    }

    return entries
  }

  private func commandPaletteEntry(for windowID: ObjectIdentifier?) -> Entry? {
    windowID.flatMap(entry(for:)) ?? preferredActiveEntry()
  }

  private func performSpaceAction(
    _ action: TerminalHostState.SpaceAction,
    from windowControllerID: UUID
  ) {
    switch action {
    case .create(let name, let color):
      _ = try? createSpace(named: name, color: color, in: windowControllerID)
    case .delete(let spaceID):
      try? deleteSpace(spaceID)
    case .next:
      selectAdjacentSpace(step: 1, in: windowControllerID)
    case .previous:
      selectAdjacentSpace(step: -1, in: windowControllerID)
    case .rename(let spaceID, let name):
      try? renameSpace(spaceID, to: name)
    case .reorder(let spaceID, let insertionIndex):
      reorderSpace(spaceID, toInsertionIndex: insertionIndex)
    case .select(let spaceID):
      selectSpace(spaceID, in: windowControllerID)
    case .selectAfterAnimation(let spaceID):
      selectSpace(spaceID, in: windowControllerID, animated: false)
    case .selectSlot(let slot):
      selectSpaceSlot(slot, in: windowControllerID)
    case .setColor(let spaceID, let color):
      try? setSpaceColor(spaceID, to: color)
    }
  }

  private func persistDefaultSpace(_ spaceID: TerminalSpaceID) {
    guard spaceCatalog.defaultSelectedSpaceID != spaceID else { return }
    var catalog = TerminalSpaceCatalog.sanitized(spaceCatalog)
    catalog.defaultSelectedSpaceID = spaceID
    replaceSpaceCatalog(catalog)
  }

  private func replaceSpaceCatalog(_ catalog: TerminalSpaceCatalog) {
    $spaceCatalog.withLock { $0 = catalog }
  }

  private func normalizedSpaceName(_ name: String) -> String? {
    let name = name.trimmingCharacters(in: .whitespacesAndNewlines)
    return name.isEmpty ? nil : name
  }

  func ambientEntry(for context: SupatermCLIContext?) throws -> Entry {
    guard let entry = ambientEntries(for: context).first else {
      throw TerminalControlError.contextPaneNotFound
    }
    return entry
  }

  func ambientEntries(for context: SupatermCLIContext?) -> [Entry] {
    var entries = activeEntries()
    guard let context else {
      guard
        let preferred = preferredActiveEntry(),
        let index = entries.firstIndex(where: {
          $0.windowControllerID == preferred.windowControllerID
        })
      else {
        return entries
      }
      let preferredEntry = entries.remove(at: index)
      return [preferredEntry] + entries
    }
    guard let index = ambientIndex(in: entries, context: context) else { return [] }
    return [entries[index]]
  }

  func windowIndex(of entry: Entry) -> Int {
    let index = activeEntries().firstIndex { $0.windowControllerID == entry.windowControllerID }
    return (index ?? 0) + 1
  }

  private func ambientIndex(in entries: [Entry], context: SupatermCLIContext) -> Int? {
    let tabID = TerminalTabID(rawValue: context.tabID)
    return entries.firstIndex { entry in
      let surfaceTabID =
        entry.terminal.tabID(containing: context.surfaceID)
        ?? entry.terminal.spaceManager.pendingTabID(containingSurface: context.surfaceID)
      return surfaceTabID == tabID
        && (entry.terminal.spaceManager.instance(for: tabID) != nil
          || entry.terminal.spaceManager.pendingInstance(containingTab: tabID) != nil)
    }
  }

  private func spaceResult(
    for spaceID: TerminalSpaceID,
    in entry: Entry
  ) throws -> SupatermSelectSpaceResult {
    TerminalWindowRegistry.rewrite(
      try entry.terminal.selectSpaceResult(for: spaceID),
      windowIndex: windowIndex(of: entry)
    )
  }

  private func spaceTargetResult(
    for spaceID: TerminalSpaceID,
    in entry: Entry
  ) throws -> SupatermSpaceTarget {
    let spaces = TerminalSpaceCatalog.sanitized(spaceCatalog).spaces
    guard let spaceIndex = spaces.firstIndex(where: { $0.id == spaceID }) else {
      throw TerminalControlError.contextPaneNotFound
    }
    return SupatermSpaceTarget(
      windowIndex: windowIndex(of: entry),
      spaceIndex: spaceIndex + 1,
      spaceID: spaceID.rawValue,
      name: spaces[spaceIndex].name
    )
  }

  private func closeAllWindowsCandidates(from entries: [Entry]) -> [CloseAllWindowsCandidate] {
    entries.compactMap { entry in
      guard let window = entry.windowReference.value else { return nil }
      return CloseAllWindowsCandidate(
        windowID: ObjectIdentifier(window),
        needsConfirmation:
          entry.terminal.windowNeedsCloseConfirmation()
          || !entry.terminal.sessionSurfaceIDs().isEmpty
      )
    }
  }

  private func entry(for windowID: ObjectIdentifier) -> Entry? {
    activeEntries().first { entry in
      entry.windowReference.value.map(ObjectIdentifier.init) == windowID
    }
  }

  func entry(forWindowControllerID windowControllerID: UUID) -> Entry? {
    activeEntries().first { $0.windowControllerID == windowControllerID }
  }

  private func entry(in windowControllerID: UUID?) -> Entry? {
    windowControllerID.flatMap(entry(forWindowControllerID:)) ?? preferredActiveEntry()
  }

  private func entry(for window: NSWindow) -> Entry? {
    entries.first { $0.windowReference.value === window }
  }

  nonisolated private static func terminateAllZmxSessions(using zmxClient: ZmxClient) async {
    guard let sessions = await zmxClient.listSessions() else {
      SupatermLog.error(SupatermLog.zmx, "zmx.terminateAll.skipped", fields: ["reason=listFailed"])
      return
    }
    let surfaceIDs = sessions.map(\.surfaceID)
    SupatermLog.debug(
      SupatermLog.zmx,
      "zmx.terminateAll.plan",
      fields: [
        "count=\(surfaceIDs.count)",
        "surfaceIDs=\(TerminalHostState.logSurfaceIDs(surfaceIDs))",
      ]
    )
    await withTaskGroup(of: Void.self) { group in
      for surfaceID in surfaceIDs {
        group.addTask {
          await zmxClient.killSession(surfaceID)
        }
      }
    }
  }

  static func rewrite(
    _ result: SupatermNewTabResult,
    windowIndex: Int
  ) -> SupatermNewTabResult {
    SupatermNewTabResult(
      isFocused: result.isFocused,
      isSelectedSpace: result.isSelectedSpace,
      isSelectedTab: result.isSelectedTab,
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      paneIndex: result.paneIndex,
      paneID: result.paneID
    )
  }

  static func rewrite(
    _ result: SupatermSpaceTarget,
    windowIndex: Int
  ) -> SupatermSpaceTarget {
    SupatermSpaceTarget(
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      name: result.name
    )
  }

  static func rewrite(
    _ result: SupatermTabTarget,
    windowIndex: Int
  ) -> SupatermTabTarget {
    SupatermTabTarget(
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      title: result.title
    )
  }

  static func rewrite(
    _ result: SupatermPaneTarget,
    windowIndex: Int
  ) -> SupatermPaneTarget {
    SupatermPaneTarget(
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      paneIndex: result.paneIndex,
      paneID: result.paneID
    )
  }

  static func rewrite(
    _ result: SupatermFocusPaneResult,
    windowIndex: Int
  ) -> SupatermFocusPaneResult {
    SupatermFocusPaneResult(
      isFocused: result.isFocused,
      isSelectedTab: result.isSelectedTab,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermSelectTabResult,
    windowIndex: Int
  ) -> SupatermSelectTabResult {
    SupatermSelectTabResult(
      isFocused: result.isFocused,
      isSelectedSpace: result.isSelectedSpace,
      isSelectedTab: result.isSelectedTab,
      isTitleLocked: result.isTitleLocked,
      paneIndex: result.paneIndex,
      paneID: result.paneID,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermSelectSpaceResult,
    windowIndex: Int
  ) -> SupatermSelectSpaceResult {
    SupatermSelectSpaceResult(
      isFocused: result.isFocused,
      isSelectedSpace: result.isSelectedSpace,
      isSelectedTab: result.isSelectedTab,
      paneIndex: result.paneIndex,
      paneID: result.paneID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermCapturePaneResult,
    windowIndex: Int
  ) -> SupatermCapturePaneResult {
    SupatermCapturePaneResult(
      target: rewrite(result.target, windowIndex: windowIndex),
      text: result.text
    )
  }

  static func rewrite(
    _ result: SupatermPaneHealthResult,
    windowIndex: Int
  ) -> SupatermPaneHealthResult {
    SupatermPaneHealthResult(
      target: rewrite(result.target, windowIndex: windowIndex),
      isReady: result.isReady,
      hasSurface: result.hasSurface,
      hasBridgeSurface: result.hasBridgeSurface,
      isAttachedToWindow: result.isAttachedToWindow,
      isWindowVisible: result.isWindowVisible,
      canCaptureText: result.canCaptureText
    )
  }

  static func rewrite(
    _ result: SupatermRenameTabResult,
    windowIndex: Int
  ) -> SupatermRenameTabResult {
    SupatermRenameTabResult(
      isTitleLocked: result.isTitleLocked,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermPinTabResult,
    windowIndex: Int
  ) -> SupatermPinTabResult {
    SupatermPinTabResult(
      isPinned: result.isPinned,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermNewPaneResult,
    windowIndex: Int
  ) -> SupatermNewPaneResult {
    SupatermNewPaneResult(
      direction: result.direction,
      isFocused: result.isFocused,
      isSelectedTab: result.isSelectedTab,
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      paneIndex: result.paneIndex,
      paneID: result.paneID
    )
  }

  static func rewrite(
    _ error: TerminalCreateTabError,
    windowIndex: Int
  ) -> TerminalCreateTabError {
    switch error {
    case .contextPaneNotFound:
      return .contextPaneNotFound
    case .creationFailed:
      return .creationFailed
    case .spaceNotFound(_, let spaceIndex):
      return .spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
    case .windowNotFound:
      return .windowNotFound(windowIndex)
    }
  }

  static func rewrite(
    _ result: SupatermNotifyResult,
    windowIndex: Int
  ) -> SupatermNotifyResult {
    SupatermNotifyResult(
      attentionState: result.attentionState,
      desktopNotificationDisposition: result.desktopNotificationDisposition,
      resolvedTitle: result.resolvedTitle,
      windowIndex: windowIndex,
      spaceIndex: result.spaceIndex,
      spaceID: result.spaceID,
      tabIndex: result.tabIndex,
      tabID: result.tabID,
      paneIndex: result.paneIndex,
      paneID: result.paneID
    )
  }

  static func rewrite(
    _ error: TerminalCreatePaneError,
    windowIndex: Int
  ) -> TerminalCreatePaneError {
    switch error {
    case .contextPaneNotFound:
      return .contextPaneNotFound
    case .creationFailed:
      return .creationFailed
    case .paneNotFound(_, let spaceIndex, let tabIndex, let paneIndex):
      return .paneNotFound(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    case .spaceNotFound(_, let spaceIndex):
      return .spaceNotFound(windowIndex: windowIndex, spaceIndex: spaceIndex)
    case .tabNotFound(_, let spaceIndex, let tabIndex):
      return .tabNotFound(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex
      )
    case .windowNotFound:
      return .windowNotFound(windowIndex)
    }
  }
}
