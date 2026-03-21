import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared

@MainActor
final class TerminalWindowRegistry {
  private struct Entry {
    let ghosttyShortcuts: GhosttyShortcutManager
    let sceneID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    var windowID: ObjectIdentifier?
  }

  private var entries: [Entry] = []

  func register(
    ghosttyShortcuts: GhosttyShortcutManager,
    sceneID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    guard !entries.contains(where: { $0.sceneID == sceneID }) else { return }
    entries.append(
      .init(
        ghosttyShortcuts: ghosttyShortcuts,
        sceneID: sceneID,
        store: store,
        terminal: terminal,
        windowID: nil
      )
    )
  }

  func unregister(sceneID: UUID) {
    entries.removeAll { $0.sceneID == sceneID }
  }

  func updateWindowID(
    _ windowID: ObjectIdentifier?,
    for sceneID: UUID
  ) {
    guard let index = entries.firstIndex(where: { $0.sceneID == sceneID }) else { return }
    entries[index].windowID = windowID
  }

  func requestQuit(for window: NSWindow) -> Bool {
    let windowID = ObjectIdentifier(window)
    guard let entry = entries.first(where: { $0.windowID == windowID }) else { return false }
    entry.store.send(.quitRequested(windowID))
    return true
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
      entry.ghosttyShortcuts.keyboardShortcut(for: action)
    }
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
    entries.filter { $0.windowID != nil }
  }

  private func entry(for windowIndex: Int) throws -> Entry {
    let activeEntries = activeEntries()
    let offset = windowIndex - 1
    guard activeEntries.indices.contains(offset) else {
      throw TerminalCreatePaneError.windowNotFound(windowIndex)
    }
    return activeEntries[offset]
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
}
