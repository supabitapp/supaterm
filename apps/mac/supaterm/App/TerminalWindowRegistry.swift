import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
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

  private final class WindowReference {
    weak var value: NSWindow?
  }

  private struct Entry {
    let keyboardShortcutForAction: (String) -> KeyboardShortcut?
    let requestConfirmedWindowClose: @MainActor () -> Void
    let windowControllerID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let windowReference: WindowReference
  }

  private struct AgentHookSessionKey: Hashable {
    let agent: SupatermAgentKind
    let sessionID: String
  }

  private struct AgentHookSession {
    var surfaceID: UUID
  }

  private struct AgentHookNotification {
    let body: String
    let semantic: TerminalHostState.NotificationSemantic
    let subtitle: String
  }

  private var agentHookSessions: [AgentHookSessionKey: AgentHookSession] = [:]
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
    terminal.onCommandFinished = { [weak self] surfaceID in
      self?.clearAgentHookSessions(for: surfaceID)
    }
    entries.append(
      .init(
        keyboardShortcutForAction: keyboardShortcutForAction,
        requestConfirmedWindowClose: requestConfirmedWindowClose,
        windowControllerID: windowControllerID,
        store: store,
        terminal: terminal,
        windowReference: WindowReference()
      )
    )
    onChange()
  }

  func unregister(windowControllerID: UUID) {
    entries.removeAll { $0.windowControllerID == windowControllerID }
    onChange()
  }

  func updateWindow(_ window: NSWindow?, for windowControllerID: UUID) {
    guard let index = entries.firstIndex(where: { $0.windowControllerID == windowControllerID }) else { return }
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
      hasSearch: entry.terminal.selectedSurfaceState?.searchState != nil,
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
    guard let action = Self.updateMenuItemAction(for: entry.store.withState(\.update)) else { return false }
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

  func treeSnapshot() -> SupatermTreeSnapshot {
    let windows: [SupatermTreeSnapshot.Window] = activeEntries().enumerated().map { offset, entry in
      let snapshot = entry.terminal.treeSnapshot()
      return SupatermTreeSnapshot.Window(
        index: offset + 1,
        isKey: entry.terminal.windowActivity.isKeyWindow,
        spaces: snapshot.windows.first?.spaces ?? []
      )
    }
    return .init(windows: windows)
  }

  func restorationSnapshot() -> TerminalSessionCatalog {
    TerminalSessionCatalog(
      windows: activeEntries().map { $0.terminal.restorationSnapshot() }
    )
  }

  func onboardingSnapshot() -> SupatermOnboardingSnapshot? {
    guard let entry = entries.first else { return nil }
    return SupatermOnboardingSnapshotBuilder.snapshot { command in
      entry.keyboardShortcutForAction(command.ghosttyBindingAction)
    }
  }

  func debugSnapshot(_ request: SupatermDebugRequest) -> SupatermAppDebugSnapshot {
    let activeEntries = activeEntries()
    let windows = activeEntries.enumerated().map { offset, entry in
      entry.terminal.debugWindowSnapshot(index: offset + 1)
    }
    let resolution = SupatermDebugSnapshotResolver.resolve(
      windows: windows,
      context: request.context
    )
    let updateEntry =
      activeEntries.first(where: { $0.terminal.windowActivity.isKeyWindow })
      ?? activeEntries.first
    var problems = resolution.problems
    if windows.isEmpty {
      problems.append("No active windows.")
    }

    return .init(
      build: .init(
        version: AppBuild.version,
        buildNumber: AppBuild.buildNumber,
        isDevelopmentBuild: AppBuild.isDevelopmentBuild,
        usesStubUpdateChecks: AppBuild.usesStubUpdateChecks
      ),
      update: updateSnapshot(updateEntry.map { $0.store.withState(\.update) }),
      summary: .init(
        windowCount: windows.count,
        spaceCount: windows.reduce(0) { $0 + $1.spaces.count },
        tabCount: windows.reduce(0) { partial, window in
          partial + window.spaces.reduce(0) { $0 + $1.tabs.count }
        },
        paneCount: windows.reduce(0) { partial, window in
          partial
            + window.spaces.reduce(0) { spacePartial, space in
              spacePartial + space.tabs.reduce(0) { $0 + $1.panes.count }
            }
        },
        keyWindowIndex: windows.first(where: \.isKey)?.index
      ),
      currentTarget: resolution.currentTarget,
      windows: windows,
      problems: problems
    )
  }

  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    switch request.target {
    case .contextPane:
      return try createContextTab(request)

    case .space(let windowIndex, let spaceIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreateTabRequest(
        command: request.command,
        cwd: request.cwd,
        focus: request.focus,
        target: .space(windowIndex: 1, spaceIndex: spaceIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.createTab(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreateTabError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    switch request.target {
    case .contextPane:
      return try createContextPane(request)

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.createPane(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreatePaneError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.createPane(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreatePaneError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.focusPane(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.focusPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastPane(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.lastPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closePane(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.closePane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.selectTab(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.selectTab(.tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closeTab(_ target: TerminalTabTarget) throws -> SupatermCloseTabResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closeTab(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.closeTab(.tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.sendText(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalSendTextRequest(
        target: .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex),
        text: request.text
      )
      do {
        return Self.rewrite(try entry.terminal.sendText(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.capturePane(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCapturePaneRequest(
        lines: request.lines,
        scope: request.scope,
        target: .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.capturePane(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.resizePane(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalResizePaneRequest(
        amount: request.amount,
        direction: request.direction,
        target: .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.resizePane(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func renameTab(_ request: TerminalRenameTabRequest) throws -> SupatermRenameTabResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.renameTab(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalRenameTabRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex),
        title: request.title
      )
      do {
        return Self.rewrite(try entry.terminal.renameTab(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func equalizePanes(_ request: TerminalEqualizePanesRequest) throws -> SupatermEqualizePanesResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.equalizePanes(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalEqualizePanesRequest(
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.equalizePanes(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    if request.target.contextPaneID != nil && request.target.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.createSpace(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.target.windowIndex {
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreateSpaceRequest(
        name: request.name,
        target: .init(contextPaneID: request.target.contextPaneID, windowIndex: 1)
      )
      do {
        return Self.rewrite(try entry.terminal.createSpace(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }

    guard let entry = preferredActiveEntry() ?? activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try Self.rewrite(entry.terminal.createSpace(request), windowIndex: 1)
  }

  func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.selectSpace(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.selectSpace(.space(windowIndex: 1, spaceIndex: spaceIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    switch target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closeSpace(target)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.closeSpace(.space(windowIndex: 1, spaceIndex: spaceIndex)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    switch request.target {
    case .contextPane:
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.renameSpace(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .space(let windowIndex, let spaceIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalRenameSpaceRequest(
        name: request.name,
        target: .space(windowIndex: 1, spaceIndex: spaceIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.renameSpace(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.nextSpace(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.nextSpace(.init(contextPaneID: request.contextPaneID, windowIndex: 1)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = preferredActiveEntry() ?? activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try Self.rewrite(entry.terminal.nextSpace(request), windowIndex: 1)
  }

  func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.previousSpace(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.previousSpace(.init(contextPaneID: request.contextPaneID, windowIndex: 1)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = preferredActiveEntry() ?? activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try Self.rewrite(entry.terminal.previousSpace(request), windowIndex: 1)
  }

  func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastSpace(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    if let windowIndex = request.windowIndex {
      let entry = try entry(for: windowIndex)
      do {
        return Self.rewrite(
          try entry.terminal.lastSpace(.init(contextPaneID: request.contextPaneID, windowIndex: 1)),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
    guard let entry = preferredActiveEntry() ?? activeEntries().first else {
      throw TerminalControlError.windowNotFound(1)
    }
    return try Self.rewrite(entry.terminal.lastSpace(request), windowIndex: 1)
  }

  func nextTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.nextTab(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try entry(for: windowIndex)
    do {
      return Self.rewrite(
        try entry.terminal.nextTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw Self.rewrite(error, windowIndex: windowIndex)
    }
  }

  func previousTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.previousTab(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try entry(for: windowIndex)
    do {
      return Self.rewrite(
        try entry.terminal.previousTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw Self.rewrite(error, windowIndex: windowIndex)
    }
  }

  func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    if request.contextPaneID != nil && request.windowIndex == nil {
      for (offset, entry) in activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastTab(request)
          return Self.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound
    }

    let windowIndex = request.windowIndex ?? 1
    let entry = try entry(for: windowIndex)
    do {
      return Self.rewrite(
        try entry.terminal.lastTab(
          .init(contextPaneID: request.contextPaneID, spaceIndex: request.spaceIndex, windowIndex: 1)
        ),
        windowIndex: windowIndex
      )
    } catch let error as TerminalControlError {
      throw Self.rewrite(error, windowIndex: windowIndex)
    }
  }

  private func createContextTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    for (offset, entry) in activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createTab(request)
        return Self.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreateTabError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreateTabError.contextPaneNotFound
  }

  private static func updateMenuItemAction(for state: UpdateFeature.State) -> UpdateUserAction? {
    if let action = state.phase.menuItemAction {
      return action
    }
    return state.canCheckForUpdates ? .checkForUpdates : nil
  }

  func notify(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    switch request.target {
    case .contextPane:
      return try notifyContextPane(request)

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalNotifyRequest(
        body: request.body,
        subtitle: request.subtitle,
        target: .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex),
        title: request.title
      )
      do {
        return Self.rewrite(try entry.terminal.notify(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreatePaneError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalNotifyRequest(
        body: request.body,
        subtitle: request.subtitle,
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex),
        title: request.title
      )
      do {
        return Self.rewrite(try entry.terminal.notify(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreatePaneError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func handleAgentHook(_ request: SupatermAgentHookRequest) throws -> TerminalAgentHookResult {
    let event = request.event
    if let sessionID = event.sessionID, let context = request.context {
      agentHookSessions[.init(agent: request.agent, sessionID: sessionID)] = .init(
        surfaceID: context.surfaceID
      )
    }

    switch event.hookEventName {
    case .sessionStart, .unsupported:
      return .init(desktopNotification: nil)

    case .preToolUse:
      guard let sessionID = event.sessionID else {
        return .init(desktopNotification: nil)
      }
      clearRecentStructuredNotifications(
        agent: request.agent,
        context: request.context,
        sessionID: sessionID
      )
      _ = setAgentActivity(
        .init(kind: request.agent, phase: .running),
        agent: request.agent,
        sessionID: sessionID,
        context: request.context
      )
      return .init(desktopNotification: nil)

    case .userPromptSubmit:
      if let sessionID = event.sessionID {
        clearRecentStructuredNotifications(
          agent: request.agent,
          context: request.context,
          sessionID: sessionID
        )
        _ = setAgentActivity(
          .init(kind: request.agent, phase: .running),
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
      }
      return .init(desktopNotification: nil)

    case .stop:
      if let sessionID = event.sessionID {
        _ = setAgentActivity(
          .init(kind: request.agent, phase: .idle),
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
      }
      guard
        let body = event.lastAssistantMessage?.trimmingCharacters(in: .whitespacesAndNewlines),
        !body.isEmpty
      else {
        return .init(desktopNotification: nil)
      }
      return try handleAgentEventNotification(
        request.agent,
        event: event,
        context: request.context,
        notification: .init(
          body: body,
          semantic: .completion,
          subtitle: "Turn complete"
        )
      )

    case .sessionEnd:
      if let sessionID = event.sessionID {
        _ = clearAgentActivity(agent: request.agent, sessionID: sessionID, context: request.context)
        agentHookSessions.removeValue(forKey: .init(agent: request.agent, sessionID: sessionID))
      }
      return .init(desktopNotification: nil)

    case .notification:
      if let sessionID = event.sessionID {
        _ = setAgentActivity(
          .init(kind: request.agent, phase: .needsInput),
          agent: request.agent,
          sessionID: sessionID,
          context: request.context
        )
      }
      return try handleAgentEventNotification(
        request.agent,
        event: event,
        context: request.context,
        notification: .init(
          body: try event.notificationMessage(),
          semantic: .attention,
          subtitle: event.title ?? "Attention"
        )
      )
    }
  }

  private func createContextPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    for (offset, entry) in activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createPane(request)
        return Self.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  private func notifyContextPane(_ request: TerminalNotifyRequest) throws -> SupatermNotifyResult {
    for (offset, entry) in activeEntries().enumerated() {
      do {
        let result = try entry.terminal.notify(request)
        return Self.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  private func notifyStructuredAgent(
    _ request: TerminalNotifyRequest,
    semantic: TerminalHostState.NotificationSemantic
  ) throws -> SupatermNotifyResult {
    for (offset, entry) in activeEntries().enumerated() {
      do {
        let result = try entry.terminal.notifyStructuredAgent(request, semantic: semantic)
        return Self.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  private func handleAgentEventNotification(
    _ agent: SupatermAgentKind,
    event: SupatermAgentHookEvent,
    context: SupatermCLIContext?,
    notification: AgentHookNotification
  ) throws -> TerminalAgentHookResult {
    let title = agent.notificationTitle
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: event.sessionID,
      context: context
    )

    for surfaceID in candidateSurfaceIDs {
      do {
        let result = try notifyStructuredAgent(
          .init(
            body: notification.body,
            subtitle: notification.subtitle,
            target: .contextPane(surfaceID),
            title: title,
            allowDesktopNotificationWhenAgentActive: true
          ),
          semantic: notification.semantic
        )
        return .init(
          desktopNotification: result.desktopNotificationDisposition.shouldDeliver
            ? .init(
              body: notification.body,
              subtitle: notification.subtitle,
              title: result.resolvedTitle
            )
            : nil
        )
      } catch let error as TerminalCreatePaneError {
        guard case .contextPaneNotFound = error else {
          throw error
        }
        if let sessionID = event.sessionID {
          let key = AgentHookSessionKey(agent: agent, sessionID: sessionID)
          if agentHookSessions[key]?.surfaceID == surfaceID {
            agentHookSessions.removeValue(forKey: key)
          }
          return .init(desktopNotification: nil)
        }
      }
    }

    return .init(desktopNotification: nil)
  }

  @discardableResult
  private func setAgentActivity(
    _ activity: TerminalHostState.AgentActivity,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    updateAgentActivity(activity, agent: agent, sessionID: sessionID, context: context)
  }

  private func clearRecentStructuredNotifications(
    agent: SupatermAgentKind,
    context: SupatermCLIContext?,
    sessionID: String
  ) {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(
      agent: agent,
      sessionID: sessionID,
      context: context
    )
    for surfaceID in candidateSurfaceIDs {
      for entry in activeEntries()
      where entry.terminal.clearRecentStructuredNotification(for: surfaceID) {
        break
      }
    }
  }

  @discardableResult
  private func clearAgentActivity(
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    updateAgentActivity(nil, agent: agent, sessionID: sessionID, context: context)
  }

  @discardableResult
  private func updateAgentActivity(
    _ activity: TerminalHostState.AgentActivity?,
    agent: SupatermAgentKind,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = agentCandidateSurfaceIDs(agent: agent, sessionID: sessionID, context: context)
    for surfaceID in candidateSurfaceIDs {
      for entry in activeEntries() {
        if let activity {
          if entry.terminal.setAgentActivity(activity, for: surfaceID) {
            return true
          }
        } else if entry.terminal.clearAgentActivity(for: surfaceID) {
          return true
        }
      }
    }
    return false
  }

  private func agentCandidateSurfaceIDs(
    agent: SupatermAgentKind,
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> [UUID] {
    var candidateSurfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      candidateSurfaceIDs.append(surfaceID)
    }
    if let sessionID,
      let surfaceID = agentHookSessions[.init(agent: agent, sessionID: sessionID)]?.surfaceID,
      !candidateSurfaceIDs.contains(surfaceID)
    {
      candidateSurfaceIDs.append(surfaceID)
    }
    return candidateSurfaceIDs
  }

  private func clearAgentHookSessions(for surfaceID: UUID) {
    agentHookSessions = agentHookSessions.filter { $0.value.surfaceID != surfaceID }
  }

  private func activeEntries() -> [Entry] {
    entries.filter { $0.windowReference.value != nil }
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

  private func entry(for windowIndex: Int) throws -> Entry {
    let activeEntries = activeEntries()
    let offset = windowIndex - 1
    guard activeEntries.indices.contains(offset) else {
      throw TerminalCreatePaneError.windowNotFound(windowIndex)
    }
    return activeEntries[offset]
  }

  private func entry(for window: NSWindow) -> Entry? {
    entries.first { $0.windowReference.value === window }
  }

  private func preferredActiveEntry() -> Entry? {
    if let keyWindow = NSApp.keyWindow, let entry = entry(for: keyWindow) {
      return entry
    }
    return activeEntries().first(where: { $0.terminal.windowActivity.isKeyWindow }) ?? activeEntries().first
  }

  private func shortcutEntry() -> Entry? {
    preferredActiveEntry() ?? entries.first
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
    case .lastPaneNotFound:
      return .lastPaneNotFound
    case .lastSpaceNotFound:
      return .lastSpaceNotFound
    case .lastTabNotFound:
      return .lastTabNotFound
    case .paneNotFound(_, let spaceIndex, let tabIndex, let paneIndex):
      return .paneNotFound(
        windowIndex: windowIndex,
        spaceIndex: spaceIndex,
        tabIndex: tabIndex,
        paneIndex: paneIndex
      )
    case .resizeFailed:
      return .resizeFailed
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

  private func updateSnapshot(_ state: UpdateFeature.State?) -> SupatermAppDebugSnapshot.Update {
    guard let state else {
      return .init(
        canCheckForUpdates: false,
        phase: "idle",
        detail: ""
      )
    }
    return .init(
      canCheckForUpdates: state.canCheckForUpdates,
      phase: updatePhaseDescription(state.phase),
      detail: state.phase.detailMessage
    )
  }

  private func updatePhaseDescription(_ phase: UpdatePhase) -> String {
    phase.debugIdentifier
  }
}
