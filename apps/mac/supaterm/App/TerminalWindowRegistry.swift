import AppKit
import ComposableArchitecture
import Darwin
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
    let canCheckForUpdates: Bool
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

  private struct ClaudeHookSession {
    var pendingQuestion: String?
    var processID: Int32?
    var surfaceID: UUID
    var tabID: TerminalTabID
  }

  private var claudeHookSessions: [String: ClaudeHookSession] = [:]
  private var claudeHookSessionSweepTimer: DispatchSourceTimer?
  private var entries: [Entry] = []
  var onChange: @MainActor () -> Void = {}

  init() {
    let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
    timer.schedule(deadline: .now() + 30, repeating: 30)
    timer.setEventHandler { [weak self] in
      Task { @MainActor [weak self] in
        self?.sweepClaudeHookSessions()
      }
    }
    timer.resume()
    claudeHookSessionSweepTimer = timer
  }

  deinit {
    claudeHookSessionSweepTimer?.cancel()
  }

  var hasShortcutSource: Bool {
    !entries.isEmpty
  }

  var needsQuitConfirmation: Bool {
    activeEntries().contains { $0.terminal.windowNeedsCloseConfirmation() }
  }

  var bypassesQuitConfirmation: Bool {
    activeEntries().contains { $0.store.update.phase.bypassesQuitConfirmation }
  }

  func register(
    keyboardShortcutForAction: @escaping (String) -> KeyboardShortcut?,
    windowControllerID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    requestConfirmedWindowClose: @escaping @MainActor () -> Void
  ) {
    guard !entries.contains(where: { $0.windowControllerID == windowControllerID }) else { return }
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
        canCheckForUpdates: false
      )
    }

    return .init(
      availability: .init(
        hasWindow: true,
        hasTab: entry.terminal.selectedTabID != nil,
        hasSurface: entry.terminal.selectedSurfaceView != nil
      ),
      closesKeyWindowDirectly: closesKeyWindowDirectly,
      hasSearch: entry.terminal.selectedSurfaceState?.searchNeedle != nil,
      updateMenuItemText: "Check for Updates...",
      visibleTabCount: entry.terminal.visibleTabs.count,
      spaceCount: entry.terminal.spaces.count,
      canCheckForUpdates: entry.store.update.canCheckForUpdates
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

  func requestBindingActionInKeyWindow(_ command: SupatermCommand) {
    preferredActiveEntry()?.store.send(.terminal(.bindingMenuItemSelected(command)))
  }

  func requestNavigateSearchInKeyWindow(_ direction: GhosttySearchDirection) {
    preferredActiveEntry()?.store.send(.terminal(.navigateSearchMenuItemSelected(direction)))
  }

  @discardableResult
  func requestCheckForUpdatesInKeyWindow() -> Bool {
    guard let entry = preferredActiveEntry() else { return false }
    entry.store.send(.update(.perform(.checkForUpdates)))
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
      update: updateSnapshot(updateEntry?.store.update),
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
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return Self.rewrite(try entry.terminal.createPane(localRequest), windowIndex: windowIndex)
      } catch let error as TerminalCreatePaneError {
        throw Self.rewrite(error, windowIndex: windowIndex)
      }
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

  func handleClaudeHook(_ request: SupatermClaudeHookRequest) throws -> TerminalClaudeHookResult {
    let event = request.event
    if let sessionID = event.sessionID {
      upsertClaudeHookSession(
        sessionID: sessionID,
        context: request.context,
        processID: request.processID
      )
    }

    switch event.hookEventName {
    case .sessionStart, .unsupported:
      return .init(desktopNotification: nil)

    case .preToolUse:
      guard let sessionID = event.sessionID else {
        return .init(desktopNotification: nil)
      }
      if let pendingQuestion = event.pendingQuestion(), var session = claudeHookSessions[sessionID] {
        session.pendingQuestion = pendingQuestion
        claudeHookSessions[sessionID] = session
      } else {
        clearClaudeHookPendingQuestion(sessionID: sessionID)
        _ = clearClaudeNotifications(sessionID: sessionID, context: request.context)
      }
      _ = setClaudeActivity(.running, sessionID: sessionID, context: request.context)
      return .init(desktopNotification: nil)

    case .userPromptSubmit:
      if let sessionID = event.sessionID {
        clearClaudeHookPendingQuestion(sessionID: sessionID)
        _ = clearClaudeNotifications(sessionID: sessionID, context: request.context)
        _ = setClaudeActivity(.running, sessionID: sessionID, context: request.context)
      }
      return .init(desktopNotification: nil)

    case .stop:
      if let sessionID = event.sessionID {
        clearClaudeHookPendingQuestion(sessionID: sessionID)
        _ = setClaudeActivity(.idle, sessionID: sessionID, context: request.context)
      }
      return .init(desktopNotification: nil)

    case .sessionEnd:
      if let sessionID = event.sessionID {
        _ = cleanupClaudeSession(sessionID: sessionID, context: request.context)
      }
      return .init(desktopNotification: nil)

    case .notification:
      if let sessionID = event.sessionID {
        _ = setClaudeActivity(.needsInput, sessionID: sessionID, context: request.context)
      }
      return try handleClaudeNotification(event, context: request.context)
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

  private func handleClaudeNotification(
    _ event: SupatermClaudeHookEvent,
    context: SupatermCLIContext?
  ) throws -> TerminalClaudeHookResult {
    let message = try event.notificationMessage()
    let session = event.sessionID.flatMap { claudeHookSessions[$0] }
    let subtitle = event.title ?? "Attention"
    let body =
      SupatermClaudeHookEvent.isGenericAttentionMessage(message)
      ? (session?.pendingQuestion ?? message)
      : message
    let title = "Claude Code"
    var candidateSurfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      candidateSurfaceIDs.append(surfaceID)
    }
    if let surfaceID = session?.surfaceID, !candidateSurfaceIDs.contains(surfaceID) {
      candidateSurfaceIDs.append(surfaceID)
    }

    for surfaceID in candidateSurfaceIDs {
      do {
        let result = try notify(
          .init(
            body: body,
            subtitle: subtitle,
            target: .contextPane(surfaceID),
            title: title,
            allowDesktopNotificationWhenAgentActive: true,
            source: .claude(sessionID: event.sessionID)
          )
        )
        return .init(
          desktopNotification: result.desktopNotificationDisposition.shouldDeliver
            ? .init(body: body, subtitle: subtitle, title: result.resolvedTitle)
            : nil
        )
      } catch let error as TerminalCreatePaneError {
        guard case .contextPaneNotFound = error else {
          throw error
        }
        if event.sessionID.flatMap({ claudeHookSessions[$0]?.surfaceID }) == surfaceID {
          if let sessionID = event.sessionID {
            _ = cleanupClaudeSession(sessionID: sessionID, context: context)
          }
          return .init(desktopNotification: nil)
        }
      }
    }

    return .init(desktopNotification: nil)
  }

  private func clearClaudeHookPendingQuestion(sessionID: String) {
    guard var session = claudeHookSessions[sessionID] else { return }
    session.pendingQuestion = nil
    claudeHookSessions[sessionID] = session
  }

  private func upsertClaudeHookSession(
    sessionID: String,
    context: SupatermCLIContext?,
    processID: Int32?
  ) {
    guard context != nil || claudeHookSessions[sessionID] != nil else { return }
    var session =
      claudeHookSessions[sessionID]
      ?? .init(
        pendingQuestion: nil,
        processID: nil,
        surfaceID: context?.surfaceID ?? UUID(),
        tabID: .init(rawValue: context?.tabID ?? UUID())
      )
    if let context {
      session.surfaceID = context.surfaceID
      session.tabID = .init(rawValue: context.tabID)
    }
    if let processID, processID > 0 {
      session.processID = processID
    }
    claudeHookSessions[sessionID] = session
  }

  @discardableResult
  private func setClaudeActivity(
    _ activity: TerminalHostState.ClaudeActivity,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    updateClaudeActivity(activity, sessionID: sessionID, context: context)
  }

  @discardableResult
  private func clearClaudeActivity(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    updateClaudeActivity(nil, sessionID: sessionID, context: context)
  }

  @discardableResult
  private func updateClaudeActivity(
    _ activity: TerminalHostState.ClaudeActivity?,
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let candidateSurfaceIDs = claudeCandidateSurfaceIDs(sessionID: sessionID, context: context)
    for surfaceID in candidateSurfaceIDs {
      for entry in activeEntries() {
        if let activity {
          if entry.terminal.setClaudeActivity(activity, for: surfaceID) {
            return true
          }
        } else if entry.terminal.clearClaudeActivity(for: surfaceID) {
          return true
        }
      }
    }
    let candidateTabIDs = claudeCandidateTabIDs(sessionID: sessionID, context: context)
    for tabID in candidateTabIDs {
      for entry in activeEntries() {
        if let activity {
          if entry.terminal.setClaudeActivity(activity, for: tabID) {
            return true
          }
        } else if entry.terminal.clearClaudeActivity(for: tabID) {
          return true
        }
      }
    }
    return false
  }

  @discardableResult
  private func clearClaudeNotifications(
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> Bool {
    var didClear = false
    let candidateTabIDs = claudeCandidateTabIDs(sessionID: sessionID, context: context)
    for tabID in candidateTabIDs {
      for entry in activeEntries() {
        didClear = entry.terminal.clearClaudeNotifications(sessionID: sessionID, for: tabID) || didClear
      }
    }
    return didClear
  }

  @discardableResult
  private func cleanupClaudeSession(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> Bool {
    let didClearNotifications = clearClaudeNotifications(sessionID: sessionID, context: context)
    let didClearActivity = clearClaudeActivity(sessionID: sessionID, context: context)
    claudeHookSessions.removeValue(forKey: sessionID)
    return didClearNotifications || didClearActivity
  }

  private func claudeCandidateSurfaceIDs(
    sessionID: String,
    context: SupatermCLIContext?
  ) -> [UUID] {
    var candidateSurfaceIDs: [UUID] = []
    if let surfaceID = context?.surfaceID {
      candidateSurfaceIDs.append(surfaceID)
    }
    if let surfaceID = claudeHookSessions[sessionID]?.surfaceID, !candidateSurfaceIDs.contains(surfaceID) {
      candidateSurfaceIDs.append(surfaceID)
    }
    return candidateSurfaceIDs
  }

  private func claudeCandidateTabIDs(
    sessionID: String?,
    context: SupatermCLIContext?
  ) -> [TerminalTabID] {
    var candidateTabIDs: [TerminalTabID] = []
    if let context {
      candidateTabIDs.append(.init(rawValue: context.tabID))
    }
    if let sessionID, let tabID = claudeHookSessions[sessionID]?.tabID, !candidateTabIDs.contains(tabID) {
      candidateTabIDs.append(tabID)
    }
    return candidateTabIDs
  }

  func sweepClaudeHookSessions() {
    let staleSessionIDs = claudeHookSessions.compactMap { sessionID, session -> String? in
      guard let processID = session.processID, processID > 0 else { return nil }
      errno = 0
      guard kill(processID, 0) == -1 else { return nil }
      guard POSIXErrorCode(rawValue: errno) == .ESRCH else { return nil }
      return sessionID
    }

    for sessionID in staleSessionIDs {
      _ = cleanupClaudeSession(sessionID: sessionID, context: nil)
    }
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
      tabIndex: result.tabIndex,
      paneIndex: result.paneIndex
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
      tabIndex: result.tabIndex,
      paneIndex: result.paneIndex
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
    .init(
      attentionState: result.attentionState,
      desktopNotificationDisposition: result.desktopNotificationDisposition,
      paneIndex: result.paneIndex,
      resolvedTitle: result.resolvedTitle,
      spaceIndex: result.spaceIndex,
      tabIndex: result.tabIndex,
      windowIndex: windowIndex
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
