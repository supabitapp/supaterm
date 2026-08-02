import Foundation
import SupaTheme
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func createSpace(_ request: TerminalCreateSpaceRequest) throws -> SupatermCreateSpaceResult {
    try registry.createSpaceResult(
      named: request.name,
      color: request.color.map(ThemeTint.init(socketColor:)),
      context: request.context
    )
  }

  func selectSpace(_ target: TerminalSpaceTarget) throws -> SupatermSelectSpaceResult {
    try registry.selectSpaceResult(
      TerminalSpaceID(rawValue: target.spaceID),
      context: target.context
    )
  }

  func closeSpace(_ target: TerminalSpaceTarget) throws -> SupatermCloseSpaceResult {
    try registry.deleteSpaceResult(
      TerminalSpaceID(rawValue: target.spaceID),
      context: target.context
    )
  }

  func renameSpace(_ request: TerminalRenameSpaceRequest) throws -> SupatermSpaceTarget {
    try registry.renameSpaceResult(
      TerminalSpaceID(rawValue: request.target.spaceID),
      to: request.name,
      context: request.target.context
    )
  }

  func setSpaceColor(_ request: TerminalSetSpaceColorRequest) throws -> SupatermSpaceTarget {
    try registry.setSpaceColorResult(
      TerminalSpaceID(rawValue: request.target.spaceID),
      to: ThemeTint(socketColor: request.color),
      context: request.target.context
    )
  }

  func nextSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try registry.adjacentSpaceResult(step: 1, context: request.context)
  }

  func previousSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try registry.adjacentSpaceResult(step: -1, context: request.context)
  }

  func lastSpace(_ request: TerminalSpaceNavigationRequest) throws -> SupatermSelectSpaceResult {
    try registry.lastSpaceResult(context: request.context)
  }
}
