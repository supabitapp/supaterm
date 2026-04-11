import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.focusPane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.focusPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.lastPane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.lastPane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    switch target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.closePane(target)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closePane(
            .pane(windowIndex: 1, spaceIndex: spaceIndex, tabIndex: tabIndex, paneIndex: paneIndex)
          ),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.sendText(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSendTextRequest(
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        ),
        text: request.text
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.sendText(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.sendKey(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSendKeyRequest(
        key: request.key,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.sendKey(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.capturePane(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalCapturePaneRequest(
        lines: request.lines,
        scope: request.scope,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.capturePane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.resizePane(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalResizePaneRequest(
        amount: request.amount,
        direction: request.direction,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        )
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.resizePane(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }

  func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
    switch request.target {
    case .contextPane:
      for (offset, entry) in registry.activeEntries().enumerated() {
        do {
          let result = try entry.terminal.setPaneSize(request)
          return TerminalWindowRegistry.rewrite(result, windowIndex: offset + 1)
        } catch let error as TerminalControlError {
          if case .contextPaneNotFound = error {
            continue
          }
          throw error
        }
      }
      throw TerminalControlError.contextPaneNotFound

    case .pane(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      let entry = try registry.entry(for: windowIndex)
      let localRequest = TerminalSetPaneSizeRequest(
        amount: request.amount,
        axis: request.axis,
        target: .pane(
          windowIndex: 1,
          spaceIndex: spaceIndex,
          tabIndex: tabIndex,
          paneIndex: paneIndex
        ),
        unit: request.unit
      )
      do {
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.setPaneSize(localRequest),
          windowIndex: windowIndex
        )
      } catch let error as TerminalControlError {
        throw TerminalWindowRegistry.rewrite(error, windowIndex: windowIndex)
      }
    }
  }
}
