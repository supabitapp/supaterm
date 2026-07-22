import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.createSpace(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.selectSpace(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.closeSpace(target) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    try executeTargeted(
      operation: { try $0.terminal.renameSpace(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.nextSpace(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.previousSpace(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }

  func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try executeTargeted(
      operation: { try $0.terminal.lastSpace(request) },
      rewrite: TerminalWindowRegistry.rewrite
    )
  }
}
