import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func createTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    switch request.target {
    case .contextPane:
      return try createContextTab(request)

    case .space(let windowIndex, let spaceIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreateTabRequest(
        startupCommand: request.startupCommand,
        cwd: request.cwd,
        focus: request.focus,
        target: .space(windowIndex: 1, spaceIndex: spaceIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createTab(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreateTabError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    switch request.target {
    case .contextPane:
      return try createContextPane(request)

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        startupCommand: request.startupCommand,
        cwd: request.cwd,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createPane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }

    case .tab(let windowIndex, let spaceIndex, let tabIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCreatePaneRequest(
        startupCommand: request.startupCommand,
        cwd: request.cwd,
        direction: request.direction,
        focus: request.focus,
        equalize: request.equalize,
        target: .tab(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex)
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.createPane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalCreatePaneError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func createContextTab(_ request: TerminalCreateTabRequest) throws -> SupatermNewTabResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createTab(request)
        return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreateTabError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreateTabError.contextPaneNotFound
  }

  func createContextPane(_ request: TerminalCreatePaneRequest) throws -> SupatermNewPaneResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let result = try entry.terminal.createPane(request)
        return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
      } catch let error as TerminalCreatePaneError {
        if case .contextPaneNotFound = error {
          continue
        }
        throw error
      }
    }
    throw TerminalCreatePaneError.contextPaneNotFound
  }
}
