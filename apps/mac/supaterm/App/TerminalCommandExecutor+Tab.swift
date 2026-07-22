import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func selectTab(_ target: TerminalTabTarget) throws -> SupatermSelectTabResult {
    try executeTargeted(
      operation: { try $0.terminal.selectTab(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func closeTab(_ target: TerminalTabTarget) throws -> SupatermCloseTabResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let resolvedClose = try entry.terminal.resolveClose(target)
        if resolvedClose.shouldCloseWindow, let window = entry.windowReference.value {
          registry.closeWindow(ObjectIdentifier(window))
          return TerminalWindowRegistry.rewrite(resolvedClose.result, windowIndex: offset + 1)
        }
        return TerminalWindowRegistry.rewrite(
          try entry.terminal.closeTab(target),
          windowIndex: offset + 1
        )
      } catch TerminalControlError.contextPaneNotFound {
        continue
      }
    }
    throw TerminalControlError.contextPaneNotFound
  }

  func pinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    try executeTargeted(
      operation: { try $0.terminal.pinTab(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func unpinTab(_ target: TerminalTabTarget) throws -> SupatermPinTabResult {
    try executeTargeted(
      operation: { try $0.terminal.unpinTab(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func renameTab(_ request: TerminalRenameTabRequest) throws -> SupatermRenameTabResult {
    try executeTargeted(
      operation: { try $0.terminal.renameTab(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func equalizePanes(_ request: TerminalEqualizePanesRequest) throws
    -> SupatermEqualizePanesResult
  {
    try executeTargeted(
      operation: { try $0.terminal.equalizePanes(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func mainVerticalPanes(
    _ request: TerminalMainVerticalPanesRequest
  ) throws -> SupatermMainVerticalPanesResult {
    try executeTargeted(
      operation: { try $0.terminal.mainVerticalPanes(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func tilePanes(_ request: TerminalTilePanesRequest) throws -> SupatermTilePanesResult {
    try executeTargeted(
      operation: { try $0.terminal.tilePanes(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func nextTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    try executeTargeted(
      operation: { try $0.terminal.nextTab(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func previousTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    try executeTargeted(
      operation: { try $0.terminal.previousTab(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func lastTab(_ request: TerminalTabNavigationRequest) throws -> SupatermSelectTabResult {
    try executeTargeted(
      operation: { try $0.terminal.lastTab(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }
}
