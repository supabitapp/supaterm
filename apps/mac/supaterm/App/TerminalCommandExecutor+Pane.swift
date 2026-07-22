import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func focusPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    try executeTargeted(
      operation: { try $0.terminal.focusPane(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func lastPane(_ target: TerminalPaneTarget) throws -> SupatermFocusPaneResult {
    try executeTargeted(
      operation: { try $0.terminal.lastPane(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func closePane(_ target: TerminalPaneTarget) throws -> SupatermClosePaneResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let resolvedClose = try entry.terminal.resolveClose(target)
        if resolvedClose.shouldCloseWindow, let window = entry.windowReference.value {
          registry.closeWindow(ObjectIdentifier(window))
          return TerminalWindowRegistry.rewrite(resolvedClose.result, windowIndex: offset + 1)
        }
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closePane(target),
          windowIndex: offset + 1
        )
      } catch TerminalControlError.contextPaneNotFound {
        continue
      }
    }
    throw TerminalControlError.contextPaneNotFound
  }

  func sendText(_ request: TerminalSendTextRequest) throws -> SupatermSendTextResult {
    try executeTargeted(
      operation: { try $0.terminal.sendText(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func sendKey(_ request: TerminalSendKeyRequest) throws -> SupatermSendKeyResult {
    try executeTargeted(
      operation: { try $0.terminal.sendKey(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func capturePane(_ request: TerminalCapturePaneRequest) throws -> SupatermCapturePaneResult {
    try executeTargeted(
      operation: { try $0.terminal.capturePane(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func paneHealth(_ request: TerminalPaneHealthRequest) throws -> SupatermPaneHealthResult {
    try executeTargeted(
      operation: { try $0.terminal.paneHealth(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func resizePane(_ request: TerminalResizePaneRequest) throws -> SupatermResizePaneResult {
    try executeTargeted(
      operation: { try $0.terminal.resizePane(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func setPaneSize(_ request: TerminalSetPaneSizeRequest) throws -> SupatermSetPaneSizeResult {
    try executeTargeted(
      operation: { try $0.terminal.setPaneSize(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }
}
