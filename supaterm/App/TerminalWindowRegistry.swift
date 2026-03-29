import AppKit
import ComposableArchitecture
import Foundation
import SupatermCLIShared

@MainActor
final class TerminalWindowRegistry {
  private struct Entry {
    let sceneID: UUID
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let ghosttyShortcuts: GhosttyShortcutManager
    var windowID: ObjectIdentifier?
  }

  private var entries: [Entry] = []

  func register(
    sceneID: UUID,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState,
    ghosttyShortcuts: GhosttyShortcutManager
  ) {
    guard !entries.contains(where: { $0.sceneID == sceneID }) else { return }
    entries.append(
      .init(
        sceneID: sceneID,
        store: store,
        terminal: terminal,
        ghosttyShortcuts: ghosttyShortcuts,
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

  func prepareForTermination(killSessions: Bool) {
    for entry in entries {
      entry.terminal.prepareForTermination(killSessions: killSessions)
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

  func shareWorkspaceState() -> ShareWorkspaceState {
    activeShareEntry()?.terminal.shareWorkspaceStateSnapshot()
      ?? .init(
        workspaces: [],
        selectedWorkspaceId: nil,
        tabs: [],
        selectedTabId: nil,
        trees: [:],
        focusedPaneByTab: [:],
        panes: [:]
      )
  }

  func handleShareMessage(_ message: ShareClientMessage) throws {
    guard let entry = activeShareEntry() else { return }
    try entry.terminal.handleShareMessage(message)
  }

  func sharePaneRuntime(for paneId: UUID) -> SharePaneRuntime? {
    activeShareEntry()?.terminal.sharePaneRuntime(for: paneId)
  }

  func prepareShareSessions() -> [String] {
    activeShareEntry()?.terminal.prepareShareSessions() ?? []
  }

  private func activeShareEntry() -> Entry? {
    let active = activeEntries()
    if let keyWindowEntry = active.first(where: { $0.terminal.windowActivity.isKeyWindow }) {
      return keyWindowEntry
    }
    return active.first
  }

  func terminalCommandSnapshot() -> TerminalCommandSnapshot {
    guard let entry = activeShareEntry() else { return .empty }

    let terminal = entry.terminal
    let store = entry.store
    let hasTab = terminal.selectedTabID != nil
    let hasSurface = terminal.selectedSurfaceView != nil
    let hasVisibleTabs = !terminal.visibleTabs.isEmpty
    let hasWorkspaces = !terminal.workspaces.isEmpty

    return TerminalCommandSnapshot(
      newTerminal: {
        store.send(.terminal(.newTabButtonTapped(inheritingFromSurfaceID: terminal.selectedSurfaceView?.id)))
      },
      closeSurface: hasSurface
        ? {
          guard let selectedSurfaceID = terminal.selectedSurfaceView?.id else { return }
          store.send(.terminal(.closeSurfaceRequested(selectedSurfaceID)))
        } : nil,
      closeTab: hasTab
        ? {
          guard let selectedTabID = terminal.selectedTabID else { return }
          store.send(.terminal(.closeTabRequested(selectedTabID)))
        } : nil,
      nextTab: hasTab
        ? {
          store.send(.terminal(.nextTabMenuItemSelected))
        } : nil,
      previousTab: hasTab
        ? {
          store.send(.terminal(.previousTabMenuItemSelected))
        } : nil,
      selectTab: hasVisibleTabs
        ? {
          store.send(.terminal(.selectTabMenuItemSelected($0)))
        } : nil,
      selectLastTab: hasVisibleTabs
        ? {
          store.send(.terminal(.selectLastTabMenuItemSelected))
        } : nil,
      selectWorkspace: hasWorkspaces
        ? {
          store.send(.terminal(.selectWorkspaceMenuItemSelected($0)))
        } : nil,
      toggleSidebar: {
        store.send(.terminal(.toggleSidebarButtonTapped))
      },
      startSearch: hasSurface
        ? {
          store.send(.terminal(.startSearchMenuItemSelected))
        } : nil,
      searchSelection: hasSurface
        ? {
          store.send(.terminal(.searchSelectionMenuItemSelected))
        } : nil,
      navigateSearchNext: hasSurface
        ? {
          store.send(.terminal(.navigateSearchNextMenuItemSelected))
        } : nil,
      navigateSearchPrevious: hasSurface
        ? {
          store.send(.terminal(.navigateSearchPreviousMenuItemSelected))
        } : nil,
      endSearch: hasSurface
        ? {
          store.send(.terminal(.endSearchMenuItemSelected))
        } : nil,
      splitBelow: hasSurface
        ? {
          store.send(.terminal(.splitBelowMenuItemSelected))
        } : nil,
      splitRight: hasSurface
        ? {
          store.send(.terminal(.splitRightMenuItemSelected))
        } : nil,
      equalizePanes: hasSurface
        ? {
          store.send(.terminal(.equalizePanesMenuItemSelected))
        } : nil,
      togglePaneZoom: hasSurface
        ? {
          store.send(.terminal(.togglePaneZoomMenuItemSelected))
        } : nil,
      checkForUpdates: store.update.canCheckForUpdates
        ? {
          store.send(.update(.checkForUpdatesButtonTapped))
        } : nil,
      updateMenuItemText: store.update.phase.menuItemText,
      keyboardShortcutProvider: { action in
        entry.ghosttyShortcuts.keyboardShortcut(for: action)
      }
    )
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
