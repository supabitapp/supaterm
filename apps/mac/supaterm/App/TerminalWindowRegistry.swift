import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SwiftUI

@MainActor
final class TerminalWindowRegistry {
  struct CloseAllWindowsCandidate {
    let window: NSWindow
    let needsConfirmation: Bool
  }

  enum CloseAllWindowsPlan {
    case noWindows
    case closeImmediately([NSWindow])
    case confirm(confirmWindow: NSWindow, windows: [NSWindow])
  }

  struct CommandAvailability: Equatable {
    let hasWindow: Bool
    let hasTab: Bool
    let hasSurface: Bool
  }

  private final class WindowReference {
    weak var value: NSWindow?
  }

  private struct Entry {
    let keyboardShortcut: (String) -> KeyboardShortcut?
    let sceneID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let windowReference: WindowReference
  }

  private var entries: [Entry] = []
  private var isPresentingCloseAllWindowsAlert = false
  var onChange: @MainActor () -> Void = {}

  var hasShortcutSource: Bool {
    !entries.isEmpty
  }

  func register(
    keyboardShortcut: @escaping (String) -> KeyboardShortcut?,
    sceneID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    guard !entries.contains(where: { $0.sceneID == sceneID }) else { return }
    entries.append(
      .init(
        keyboardShortcut: keyboardShortcut,
        sceneID: sceneID,
        store: store,
        terminal: terminal,
        windowReference: WindowReference()
      )
    )
    onChange()
  }

  func unregister(sceneID: UUID) {
    entries.removeAll { $0.sceneID == sceneID }
    onChange()
  }

  func updateWindow(_ window: NSWindow?, for sceneID: UUID) {
    guard let index = entries.firstIndex(where: { $0.sceneID == sceneID }) else { return }
    entries[index].windowReference.value = window
    onChange()
  }

  func requestQuit(for window: NSWindow) -> Bool {
    guard let entry = entry(for: window) else { return false }
    let windowID = ObjectIdentifier(window)
    entry.store.send(.quitRequested(windowID))
    return true
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

  func keyboardShortcut(for action: String) -> KeyboardShortcut? {
    shortcutEntry()?.keyboardShortcut(action)
  }

  func requestNewTabInKeyWindow() {
    guard let entry = preferredActiveEntry() else { return }
    entry.store.send(
      .terminal(
        .newTabButtonTapped(inheritingFromSurfaceID: entry.terminal.selectedSurfaceView?.id)
      )
    )
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
    switch Self.closeAllWindowsPlan(for: closeAllWindowsCandidates()) {
    case .noWindows:
      return false

    case .closeImmediately(let windows):
      closeAllWindowsImmediately(windows)
      return true

    case .confirm(let confirmWindow, let windows):
      guard !isPresentingCloseAllWindowsAlert else { return true }
      isPresentingCloseAllWindowsAlert = true

      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.messageText = "Close All Windows?"
      alert.informativeText = "All terminal sessions will be terminated."
      alert.addButton(withTitle: "Close All Windows")
      alert.addButton(withTitle: "Cancel")
      alert.beginSheetModal(for: confirmWindow) { [weak self] response in
        guard let self else { return }
        self.isPresentingCloseAllWindowsAlert = false
        if response == .alertFirstButtonReturn {
          alert.window.orderOut(nil)
          self.closeAllWindowsImmediately(windows)
        }
      }
      return true
    }
  }

  static func closeAllWindowsPlan(for candidates: [CloseAllWindowsCandidate]) -> CloseAllWindowsPlan {
    let windows = candidates.map(\.window)
    guard !windows.isEmpty else { return .noWindows }
    guard let confirmWindow = candidates.first(where: \.needsConfirmation)?.window else {
      return .closeImmediately(windows)
    }
    return .confirm(confirmWindow: confirmWindow, windows: windows)
  }

  func treeSnapshot() -> SupatermTreeSnapshot {
    let windows: [SupatermTreeSnapshot.Window] = activeEntries().enumerated().map { offset, entry in
      let snapshot = entry.terminal.treeSnapshot()
      return SupatermTreeSnapshot.Window(
        index: offset + 1,
        isKey: entry.terminal.windowActivity.isKeyWindow,
        workspaces: snapshot.windows.first?.workspaces ?? []
      )
    }
    return .init(windows: windows)
  }

  func onboardingSnapshot() -> SupatermOnboardingSnapshot? {
    guard let entry = entries.first else { return nil }
    return SupatermOnboardingSnapshotBuilder.snapshot { action in
      entry.keyboardShortcut(action)
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
        workspaceCount: windows.reduce(0) { $0 + $1.workspaces.count },
        tabCount: windows.reduce(0) { partial, window in
          partial + window.workspaces.reduce(0) { $0 + $1.tabs.count }
        },
        paneCount: windows.reduce(0) { partial, window in
          partial
            + window.workspaces.reduce(0) { workspacePartial, workspace in
              workspacePartial + workspace.tabs.reduce(0) { $0 + $1.panes.count }
            }
        },
        keyWindowIndex: windows.first(where: \.isKey)?.index
      ),
      currentTarget: resolution.currentTarget,
      windows: windows,
      problems: problems
    )
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    switch request.target {
    case .contextPane:
      return try createContextPane(request)

    case .pane(let windowIndex, let tabIndex, let paneIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        direction: request.direction,
        focus: request.focus,
        target: .pane(windowIndex: 1, tabIndex: tabIndex, paneIndex: paneIndex)
      )
      return rewrite(try entry.terminal.createPane(localRequest), windowIndex: windowIndex)

    case .tab(let windowIndex, let tabIndex):
      let entry = try entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        command: request.command,
        direction: request.direction,
        focus: request.focus,
        target: .tab(windowIndex: 1, tabIndex: tabIndex)
      )
      return rewrite(try entry.terminal.createPane(localRequest), windowIndex: windowIndex)
    }
  }

  private func createContextPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    for (offset, entry) in activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createPane(request)
        return rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }

  private func activeEntries() -> [Entry] {
    entries.filter { $0.windowReference.value != nil }
  }

  private func closeAllWindowsCandidates() -> [CloseAllWindowsCandidate] {
    activeEntries().compactMap { entry in
      guard let window = entry.windowReference.value else { return nil }
      return .init(
        window: window,
        needsConfirmation: entry.terminal.windowNeedsCloseConfirmation()
      )
    }
  }

  private func closeAllWindowsImmediately(_ windows: [NSWindow]) {
    for window in windows {
      window.close()
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

  private func rewrite(
    _ result: SupatermNewPaneResult,
    windowIndex: Int
  ) -> SupatermNewPaneResult {
    .init(
      direction: result.direction,
      isFocused: result.isFocused,
      isSelectedTab: result.isSelectedTab,
      paneIndex: result.paneIndex,
      tabIndex: result.tabIndex,
      windowIndex: windowIndex
    )
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
    switch phase {
    case .idle:
      return "idle"
    case .permissionRequest:
      return "permission_request"
    case .checking:
      return "checking"
    case .updateAvailable:
      return "update_available"
    case .downloading:
      return "downloading"
    case .extracting:
      return "extracting"
    case .installing:
      return "installing"
    case .notFound:
      return "not_found"
    case .error:
      return "error"
    }
  }
}
