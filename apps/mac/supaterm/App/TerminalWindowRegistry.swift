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
  }

  struct MenuContext: Equatable {
    let availability: CommandAvailability
    let closesKeyWindowDirectly: Bool
    let hasSearch: Bool
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
    let windowControllerID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let windowReference: WindowReference
  }

  var commandExecutor: TerminalCommandExecutor?

  private var entries: [Entry] = []
  var onChange: @MainActor () -> Void = {}

  var hasShortcutSource: Bool {
    !entries.isEmpty
  }

  var needsQuitConfirmation: Bool {
    activeEntries().contains { $0.terminal.windowNeedsCloseConfirmation() }
  }

  var bypassesQuitConfirmation: Bool {
    activeEntries().contains { $0.store.withState(\.update.phase.bypassesQuitConfirmation) }
  }

  func register(
    keyboardShortcutForAction: @escaping (String) -> KeyboardShortcut?,
    windowControllerID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    requestConfirmedWindowClose: @escaping @MainActor () -> Void
  ) {
    guard !entries.contains(where: { $0.windowControllerID == windowControllerID }) else { return }
    let entry = Entry(
      keyboardShortcutForAction: keyboardShortcutForAction,
      requestConfirmedWindowClose: requestConfirmedWindowClose,
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

  func commandAvailability() -> CommandAvailability {
    guard let entry = preferredActiveEntry() else {
      return .init(hasWindow: false, hasTab: false, hasSurface: false)
    }

    return .init(
      hasWindow: true,
      hasTab: entry.terminal.selectedTabID != nil,
      hasSurface: entry.terminal.selectedSurfaceView != nil
    )
  }

  func menuContext(keyWindow: NSWindow? = NSApp.keyWindow) -> MenuContext {
    let closesKeyWindowDirectly = closesWindowDirectly(keyWindow)
    guard let entry = preferredActiveEntry() else {
      return .init(
        availability: .init(hasWindow: false, hasTab: false, hasSurface: false),
        closesKeyWindowDirectly: closesKeyWindowDirectly,
        hasSearch: false,
        updateMenuItemText: "Check for Updates...",
        visibleTabCount: 0,
        spaceCount: 0,
        isUpdateMenuItemEnabled: false
      )
    }

    let updateState = entry.store.withState(\.update)
    let updateMenuItemAction = Self.updateMenuItemAction(for: updateState)

    return .init(
      availability: .init(
        hasWindow: true,
        hasTab: entry.terminal.selectedTabID != nil,
        hasSurface: entry.terminal.selectedSurfaceView != nil
      ),
      closesKeyWindowDirectly: closesKeyWindowDirectly,
      hasSearch: entry.terminal.selectedSurfaceState?.searchNeedle != nil,
      updateMenuItemText: updateState.phase.menuItemTitle,
      visibleTabCount: entry.terminal.visibleTabs.count,
      spaceCount: entry.terminal.spaces.count,
      isUpdateMenuItemEnabled: updateMenuItemAction != nil
    )
  }

  func keyboardShortcut(for command: SupatermCommand) -> KeyboardShortcut? {
    keyboardShortcut(forAction: command.ghosttyBindingAction)
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
    guard let action = Self.updateMenuItemAction(for: entry.store.withState(\.update)) else {
      return false
    }
    entry.store.send(.update(.perform(action)))
    return true
  }

  func requestCloseSurfaceInKeyWindow() {
    guard
      let entry = preferredActiveEntry(),
      let surfaceID = entry.terminal.selectedSurfaceView?.id
    else {
      return
    }
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

  func restorationSnapshot() -> TerminalSessionCatalog {
    TerminalSessionCatalog(
      windows: activeEntries().map { $0.terminal.restorationSnapshot() }
    )
  }

  func activeEntries() -> [Entry] {
    entries.filter { $0.windowReference.value != nil }
  }

  func entry(for windowIndex: Int) throws -> Entry {
    let activeEntries = activeEntries()
    let offset = windowIndex - 1
    guard activeEntries.indices.contains(offset) else {
      throw TerminalCreatePaneError.windowNotFound(windowIndex)
    }
    return activeEntries[offset]
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

  private static func updateMenuItemAction(for state: UpdateFeature.State) -> UpdateUserAction? {
    if let action = state.phase.menuItemAction {
      return action
    }
    return state.canCheckForUpdates ? .checkForUpdates : nil
  }

  private func closeAllWindowsCandidates(from entries: [Entry]) -> [CloseAllWindowsCandidate] {
    entries.compactMap { entry in
      guard let window = entry.windowReference.value else { return nil }
      return .init(
        windowID: ObjectIdentifier(window),
        needsConfirmation: entry.terminal.windowNeedsCloseConfirmation()
      )
    }
  }

  private func entry(for windowID: ObjectIdentifier) -> Entry? {
    activeEntries().first { entry in
      entry.windowReference.value.map(ObjectIdentifier.init) == windowID
    }
  }

  private func entry(for window: NSWindow) -> Entry? {
    entries.first { $0.windowReference.value === window }
  }

  static func rewrite(
    _ result: SupatermNewTabResult,
    windowIndex: Int
  ) -> SupatermNewTabResult {
    .init(
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
    .init(
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
    .init(
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
    .init(
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
    .init(
      isFocused: result.isFocused,
      isSelectedTab: result.isSelectedTab,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermSelectTabResult,
    windowIndex: Int
  ) -> SupatermSelectTabResult {
    .init(
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
    .init(
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
    .init(
      target: rewrite(result.target, windowIndex: windowIndex),
      text: result.text
    )
  }

  static func rewrite(
    _ result: SupatermRenameTabResult,
    windowIndex: Int
  ) -> SupatermRenameTabResult {
    .init(
      isTitleLocked: result.isTitleLocked,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermPinTabResult,
    windowIndex: Int
  ) -> SupatermPinTabResult {
    .init(
      isPinned: result.isPinned,
      target: rewrite(result.target, windowIndex: windowIndex)
    )
  }

  static func rewrite(
    _ result: SupatermNewPaneResult,
    windowIndex: Int
  ) -> SupatermNewPaneResult {
    .init(
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
    _ error: TerminalControlError,
    windowIndex: Int
  ) -> TerminalControlError {
    switch error {
    case .captureFailed:
      return .captureFailed
    case .contextPaneNotFound:
      return .contextPaneNotFound
    case .invalidSpaceName:
      return .invalidSpaceName
    case .lastPaneNotFound:
      return .lastPaneNotFound
    case .lastSpaceNotFound:
      return .lastSpaceNotFound
    case .lastTabNotFound:
      return .lastTabNotFound
    case .onlyRemainingSpace:
      return .onlyRemainingSpace
    case .paneNotFound(_, let spaceIndex, let tabIndex, let paneIndex):
      return .paneNotFound(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    case .resizeFailed:
      return .resizeFailed
    case .spaceNameUnavailable:
      return .spaceNameUnavailable
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

  static func rewrite(
    _ result: SupatermNotifyResult,
    windowIndex: Int
  ) -> SupatermNotifyResult {
    .init(
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
