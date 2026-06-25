import ComposableArchitecture
import Foundation
import SupatermSupport
import SupatermTerminalFeature
import SupatermTerminalPresentationFeature

extension TerminalWindowFeature {
  private struct ResolvedCommandPalette {
    let visibleRows: [TerminalCommandPaletteRow]
    let selectedRowID: TerminalCommandPaletteRow.ID?

    var selectedRow: TerminalCommandPaletteRow? {
      guard let selectedRowID else { return nil }
      return visibleRows.first(where: { $0.id == selectedRowID })
    }
  }

  func sendCommand(_ command: TerminalClient.Command) -> Effect<Action> {
    .run { [terminalClient] _ in
      await terminalClient.send(command)
    }
  }

  func openCommandPaletteState(windowID: ObjectIdentifier?) -> TerminalCommandPaletteState {
    let rows = TerminalCommandPalettePresentation.rows(from: commandPaletteSnapshot(windowID: windowID))
    return TerminalCommandPaletteState(
      selectedRowID: TerminalCommandPalettePresentation.normalizedSelection(nil, in: rows)
    )
  }

  func commandPaletteSnapshot(windowID: ObjectIdentifier?) -> TerminalCommandPaletteSnapshot {
    MainActor.assumeIsolated {
      terminalCommandPaletteClient.snapshot(windowID)
    }
  }

  private func resolvedCommandPalette(for state: State) -> ResolvedCommandPalette? {
    guard let commandPalette = state.commandPalette else { return nil }
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      from: commandPaletteSnapshot(windowID: state.windowID),
      query: commandPalette.query
    )
    let selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      commandPalette.selectedRowID,
      in: visibleRows
    )
    return ResolvedCommandPalette(
      visibleRows: visibleRows,
      selectedRowID: selectedRowID
    )
  }

  func updateCommandPaletteQuery(
    _ query: String,
    state: inout State
  ) {
    guard state.commandPalette != nil else { return }
    state.commandPalette?.query = query
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(
      from: commandPaletteSnapshot(windowID: state.windowID),
      query: query
    )
    state.commandPalette?.selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      nil,
      in: visibleRows
    )
  }

  func updateCommandPaletteSelection(
    index: Int,
    state: inout State
  ) {
    guard let resolved = resolvedCommandPalette(for: state) else { return }
    guard let row = TerminalCommandPalettePresentation.row(atVisibleIndex: index, in: resolved.visibleRows)
    else { return }
    state.commandPalette?.selectedRowID = row.id
  }

  func moveCommandPaletteSelection(
    offset: Int,
    state: inout State
  ) {
    guard let resolved = resolvedCommandPalette(for: state) else { return }
    state.commandPalette?.selectedRowID = TerminalCommandPalettePresentation.movedSelection(
      resolved.selectedRowID,
      by: offset,
      in: resolved.visibleRows
    )
  }

  func executeSelectedCommandPaletteCommand(
    state: inout State
  ) -> Effect<Action> {
    guard let resolved = resolvedCommandPalette(for: state) else { return .none }
    guard let row = resolved.selectedRow else { return .none }
    return executeCommandPaletteCommand(row.command, state: &state)
  }

  func executeCommandPaletteSlot(
    _ slot: Int,
    state: inout State
  ) -> Effect<Action> {
    guard let resolved = resolvedCommandPalette(for: state) else { return .none }
    guard let row = TerminalCommandPalettePresentation.rowForSlot(slot, in: resolved.visibleRows)
    else { return .none }
    state.commandPalette?.selectedRowID = row.id
    return executeCommandPaletteCommand(row.command, state: &state)
  }

  private func executeCommandPaletteCommand(
    _ command: TerminalCommandPaletteCommand,
    state: inout State
  ) -> Effect<Action> {
    let windowID = state.windowID
    state.commandPalette = nil

    switch command {
    case .ghosttyBindingAction(let action):
      return sendCommand(.performGhosttyBindingActionOnFocusedSurface(action))
    case .focusPane(let target):
      return .run { [terminalCommandPaletteClient] _ in
        await terminalCommandPaletteClient.focusPane(target)
      }
    case .update(let action):
      return .run { [terminalCommandPaletteClient, windowID] _ in
        await terminalCommandPaletteClient.performUpdateAction(windowID, action)
      }
    case .submitGitHubIssue:
      return .run { [externalNavigationClient] _ in
        _ = await externalNavigationClient.open(SupatermExternalURL.submitGitHubIssue)
      }
    case .toggleSidebar:
      return .send(.toggleSidebarButtonTapped)
    case .createSpace:
      return .send(.spaceCreateButtonTapped)
    case .renameSpace(let space):
      return .send(.spaceRenameRequested(space))
    case .togglePinned(let tabID):
      return sendCommand(.togglePinned(tabID))
    case .selectSpace(let spaceID):
      return sendCommand(.selectSpace(spaceID))
    case .selectTab(let tabID):
      return sendCommand(.selectTab(tabID))
    }
  }
}
