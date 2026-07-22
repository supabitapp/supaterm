import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermTerminalCore
import SupatermUpdateFeature
import SwiftUI

@MainActor
final class TerminalWindowRegistry {
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
    var hasAgentPanelSession = false
  }

  struct MenuContext: Equatable {
    let availability: CommandAvailability
    let closesKeyWindowDirectly: Bool
    let hasSearch: Bool
    let hasSelectedGroup: Bool
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
    let surfaceID: UUID
    let session: PaneAgentPanelSession?
  }

  var commandExecutor: TerminalCommandExecutor? {
    didSet {
      guard let commandExecutor else { return }
      for entry in activeEntries() {
        commandExecutor.resumeAgentMonitoring(in: entry.terminal)
      }
    }
  }

  private var entries: [Entry] = []
  private let zmxClient: ZmxClient
  var onChange: @MainActor () -> Void = {}

  init(zmxClient: ZmxClient = .live) {
    self.zmxClient = zmxClient
  }

  var hasShortcutSource: Bool {
    !entries.isEmpty
  }

  var bypassesQuitConfirmation: Bool {
    activeEntries().contains { $0.store.update.phase.bypassesQuitConfirmation }
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
    terminal.onSurfaceCommandFinished = { [weak self] surfaceID in
      self?.commandExecutor?.handleCommandFinished(for: surfaceID)
    }
    terminal.onSurfaceRemoved = { [weak self] surfaceID in
      self?.commandExecutor?.handleSurfaceRemoved(surfaceID)
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
    if let entry = entries.first(where: { $0.windowControllerID == windowControllerID }) {
      for surfaceID in entry.terminal.liveSurfaceIDs() {
        commandExecutor?.handleSurfaceRemoved(surfaceID)
      }
    }
    entries.removeAll { $0.windowControllerID == windowControllerID }
    onChange()
  }

  func updateWindow(_ window: NSWindow?, for windowControllerID: UUID) {
    guard let index = entries.firstIndex(where: { $0.windowControllerID == windowControllerID })
    else { return }
    entries[index].windowReference.value = window
    if window != nil {
      commandExecutor?.resumeAgentMonitoring(in: entries[index].terminal)
    } else {
      for surfaceID in entries[index].terminal.liveSurfaceIDs() {
        commandExecutor?.handleSurfaceRemoved(surfaceID)
      }
    }
    onChange()
  }

  func commandAvailability() -> CommandAvailability {
    guard let entry = preferredActiveEntry() else {
      return CommandAvailability(hasWindow: false, hasTab: false, hasSurface: false, hasAnySurface: hasAnySurface)
    }

    return commandAvailability(for: entry)
  }

  func menuContext(keyWindow: NSWindow? = NSApp.keyWindow) -> MenuContext {
    let closesKeyWindowDirectly = closesWindowDirectly(keyWindow)
    guard let entry = preferredActiveEntry() else {
      return MenuContext(
        availability: CommandAvailability(
          hasWindow: false, hasTab: false, hasSurface: false, hasAnySurface: hasAnySurface),
        closesKeyWindowDirectly: closesKeyWindowDirectly,
        hasSearch: false,
        hasSelectedGroup: false,
        updateMenuItemText: "Check for Updates...",
        visibleTabCount: 0,
        spaceCount: 0,
        isUpdateMenuItemEnabled: false
      )
    }

    let updateState = entry.store.update
    let updateMenuItemAction = Self.updateMenuItemAction(for: updateState)

    return MenuContext(
      availability: commandAvailability(for: entry),
      closesKeyWindowDirectly: closesKeyWindowDirectly,
      hasSearch: entry.terminal.selectedSurfaceState?.searchNeedle != nil,
      hasSelectedGroup: selectedGroupID(in: entry) != nil,
      updateMenuItemText: updateState.phase.menuItemTitle,
      visibleTabCount: entry.terminal.visibleTabs.count,
      spaceCount: entry.terminal.spaces.count,
      isUpdateMenuItemEnabled: updateMenuItemAction != nil
    )
  }

  func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    shortcutEntry()?.keyboardShortcutForAction(action)
  }

  func requestNewTabInKeyWindow() {
    guard let entry = preferredActiveEntry() else { return }
    entry.store.send(
      .terminal(
        .newTabButtonTapped(inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id)
      )
    )
  }

  func requestNewTabInSelectedGroupInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let groupID = selectedGroupID(in: entry)
    else {
      return
    }
    entry.store.send(
      .terminal(
        .newTabInGroupRequested(
          groupID,
          inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id
        )
      )
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
    preferredActiveEntry()?.store.send(.terminal(.nextTabMenuItemSelected))
  }

  func requestPreviousTabInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.previousTabMenuItemSelected))
  }

  func requestSelectTabInKeyWindow(_ slot: Int) {
    preferredActiveEntry()?.store.send(.terminal(.selectTabMenuItemSelected(slot)))
  }

  func requestSelectLastTabInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.selectLastTabMenuItemSelected))
  }

  func requestSelectSpaceInKeyWindow(_ slot: Int) {
    preferredActiveEntry()?.store.send(.terminal(.selectSpaceMenuItemSelected(slot)))
  }

  func requestToggleSidebarInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.toggleSidebarButtonTapped))
  }

  func requestToggleAgentPanelInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let surfaceID = selectedAgentPanel(in: entry)?.surfaceID
    else { return }
    entry.store.send(.terminal(.agentPanelVisibilityToggled(surfaceID)))
  }

  func requestForkAgentPanelSessionInKeyWindow(direction: SupatermPaneDirection) {
    guard
      let entry = preferredActiveEntry(),
      let selectedAgentPanel = selectedAgentPanel(in: entry),
      let session = selectedAgentPanel.session
    else { return }
    entry.store.send(
      .terminal(
        .agentPanelForkSessionRequested(
          surfaceID: selectedAgentPanel.surfaceID,
          direction: direction,
          session: session
        )
      )
    )
  }

  func requestCopyAgentPanelSessionIDInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let session = selectedAgentPanel(in: entry)?.session
    else { return }
    entry.store.send(.terminal(.agentPanelCopyText(session.sessionID)))
  }

  func requestToggleCommandPaletteInKeyWindow() {
    preferredActiveEntry()?.store.send(.terminal(.commandPaletteToggleRequested))
  }

  func requestBindingActionInKeyWindow(_ command: SupatermCommand) {
    preferredActiveEntry()?.store.send(.terminal(.bindingMenuItemSelected(command)))
  }

  func requestNavigateSearchInKeyWindow(_ direction: GhosttySearchDirection) {
    preferredActiveEntry()?.store.send(.terminal(.navigateSearchMenuItemSelected(direction)))
  }

  @discardableResult
  func requestUpdateMenuActionInKeyWindow() -> Bool {
    guard let entry = preferredActiveEntry() else { return false }
    guard let action = Self.updateMenuItemAction(for: entry.store.update) else {
      return false
    }
    entry.store.send(.update(.perform(action)))
    return true
  }

  func setUpdateChannel(_ updateChannel: UpdateChannel) {
    for entry in entries {
      entry.store.send(.update(.setUpdateChannel(updateChannel)))
    }
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
    entry.store.send(.terminal(.closeSurfaceRequested(surfaceID)))
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
    entry.store.send(.terminal(.closeTabRequested(tabID)))
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

  func terminateLiveTerminalSessionsAndWait() async {
    for entry in activeEntries() {
      await entry.terminal.terminateLiveTerminalSessionsAndWait()
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
      await terminateLiveTerminalSessionsAndWait()
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
        return snapshot
      }
    )
  }

  var hasAnySurface: Bool {
    !liveSurfaceIDs().isEmpty
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
    let updateState = entry.store.update
    let focusTargets = activeEntries().flatMap { activeEntry in
      activeEntry.terminal.commandPaletteFocusTargets(
        windowControllerID: activeEntry.windowControllerID
      )
    }

    return TerminalCommandPaletteSnapshot(
      ghosttyCommands: terminal.commandPaletteGhosttyCommands(),
      ghosttyShortcutDisplayByAction: terminal.commandPaletteGhosttyShortcutDisplayByAction(),
      hasFocusedSurface: terminal.selectedSurfaceView != nil,
      updateEntries: Self.commandPaletteUpdateEntries(for: updateState),
      focusTargets: focusTargets,
      selectedSpaceID: terminal.selectedSpaceID,
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
    _ = try? entry.terminal.focusPane(TerminalPaneTarget(paneID: target.surfaceID))
  }

  @discardableResult
  func focusNotificationSurface(_ surfaceID: UUID) -> Bool {
    for entry in activeEntries() {
      guard entry.terminal.tabID(containing: surfaceID) != nil else { continue }
      do {
        guard let window = entry.windowReference.value else { continue }
        NSApp.activate(ignoringOtherApps: true)
        if window.isMiniaturized {
          window.deminiaturize(nil)
        }
        window.makeKeyAndOrderFront(nil)
        entry.terminal.updateWindowActivity(WindowActivityState(isKeyWindow: true, isVisible: true))
        _ = try entry.terminal.focusPane(TerminalPaneTarget(paneID: surfaceID))
        return true
      } catch let error as TerminalControlError {
        if case .contextPaneNotFound = error {
          continue
        }
        return false
      } catch {
        return false
      }
    }
    return false
  }

  func performCommandPaletteUpdateAction(
    _ action: UpdateUserAction,
    windowID: ObjectIdentifier?
  ) {
    guard let entry = commandPaletteEntry(for: windowID) else { return }
    entry.store.send(.update(.perform(action)))
  }

  func activeEntries() -> [Entry] {
    entries.filter { $0.windowReference.value != nil }
  }

  func preferredActiveEntry() -> Entry? {
    if let keyWindow = NSApp.keyWindow, let entry = entry(for: keyWindow) {
      return entry
    }
    return activeEntries().first(where: { $0.terminal.windowActivity.isKeyWindow })
      ?? activeEntries().first
  }

  func shortcutEntry() -> Entry? {
    preferredActiveEntry() ?? entries.first
  }

  private func selectedAgentPanel(in entry: Entry) -> SelectedAgentPanel? {
    guard let surfaceID = entry.terminal.selectedSurfaceView?.id else { return nil }
    guard let presentation = entry.terminal.agentPanelPresentation(for: surfaceID) else { return nil }
    return SelectedAgentPanel(surfaceID: surfaceID, session: presentation.session)
  }

  private func selectedGroupID(in entry: Entry) -> TerminalTabGroupID? {
    guard
      let tabID = entry.terminal.selectedTabID,
      let tabManager = entry.terminal.spaceManager.activeTabManager
    else {
      return nil
    }
    return tabManager.groupID(containing: tabID)
  }

  private func commandAvailability(for entry: Entry) -> CommandAvailability {
    let selectedAgentPanel = selectedAgentPanel(in: entry)
    return CommandAvailability(
      hasWindow: true,
      hasTab: entry.terminal.selectedTabID != nil,
      hasSurface: entry.terminal.selectedSurfaceView != nil,
      hasAnySurface: hasAnySurface,
      hasAgentPanel: selectedAgentPanel != nil,
      hasAgentPanelSession: selectedAgentPanel?.session != nil
    )
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

  private func closeAllWindowsCandidates(from entries: [Entry]) -> [CloseAllWindowsCandidate] {
    entries.compactMap { entry in
      guard let window = entry.windowReference.value else { return nil }
      return CloseAllWindowsCandidate(
        windowID: ObjectIdentifier(window),
        needsConfirmation:
          entry.terminal.windowNeedsCloseConfirmation() || !entry.terminal.liveSurfaceIDs().isEmpty
      )
    }
  }

  private func entry(for windowID: ObjectIdentifier) -> Entry? {
    activeEntries().first { entry in
      entry.windowReference.value.map(ObjectIdentifier.init) == windowID
    }
  }

  private func entry(forWindowControllerID windowControllerID: UUID) -> Entry? {
    activeEntries().first { $0.windowControllerID == windowControllerID }
  }

  private func entry(for window: NSWindow) -> Entry? {
    entries.first { $0.windowReference.value === window }
  }

  nonisolated private static func terminateAllZmxSessions(using zmxClient: ZmxClient) async {
    guard let sessionIDs = await zmxClient.listSessions() else {
      SupatermLog.error(SupatermLog.zmx, "zmx.terminateAll.skipped", fields: ["reason=listFailed"])
      return
    }
    let surfaceIDs = sessionIDs.compactMap { ZmxSessionID.surfaceID(from: $0) }
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
