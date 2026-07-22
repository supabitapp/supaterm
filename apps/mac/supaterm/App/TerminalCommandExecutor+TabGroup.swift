import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func execute(_ request: TerminalTabGroupRequest) throws -> TerminalTabGroupResult {
    switch request {
    case .create(let createRequest):
      return try executeCreateGroup(createRequest)
    case .moveTab(let moveRequest):
      return try executeMoveTab(moveRequest)
    case .close(let groupID):
      return try executeCloseGroup(groupID)
    default:
      return try executeGroupMutation(request)
    }
  }

  private func executeCreateGroup(
    _ request: TerminalCreateTabGroupRequest
  ) throws -> TerminalTabGroupResult {
    try executeTargeted(
      operation: { try $0.terminal.executeTabGroup(.create(request)) },
      rewrite: rewrite
    )
  }

  private func executeMoveTab(
    _ request: TerminalMoveTabRequest
  ) throws -> TerminalTabGroupResult {
    try executeTargeted(
      operation: { try $0.terminal.executeTabGroup(.moveTab(request)) },
      rewrite: rewrite
    )
  }

  private func executeCloseGroup(_ groupID: UUID) throws -> TerminalTabGroupResult {
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        let resolvedClose = try entry.terminal.resolveGroupClose(groupID)
        if resolvedClose.shouldCloseWindow, let window = entry.windowReference.value {
          registry.closeWindow(ObjectIdentifier(window))
          return rewrite(.removedGroup(resolvedClose.result), windowIndex: offset + 1)
        }
        return rewrite(
          try entry.terminal.executeTabGroup(.close(groupID)),
          windowIndex: offset + 1
        )
      } catch TerminalControlError.groupNotFound {
        continue
      }
    }
    throw TerminalControlError.groupNotFound(groupID)
  }

  private func executeGroupMutation(
    _ request: TerminalTabGroupRequest
  ) throws -> TerminalTabGroupResult {
    let groupID = request.groupID
    for (offset, entry) in registry.activeEntries().enumerated() {
      do {
        return rewrite(
          try entry.terminal.executeTabGroup(request),
          windowIndex: offset + 1
        )
      } catch TerminalControlError.groupNotFound {
        continue
      }
    }
    throw TerminalControlError.groupNotFound(groupID)
  }

  private func rewrite(
    _ result: TerminalTabGroupResult,
    windowIndex: Int
  ) -> TerminalTabGroupResult {
    switch result {
    case .group(let result):
      return .group(
        SupatermTabGroupMutationResult(
          group: result.group,
          windowIndex: windowIndex,
          spaceIndex: result.spaceIndex,
          spaceID: result.spaceID
        )
      )
    case .movedTab(let result):
      return .movedTab(
        SupatermMoveTabResult(
          target: TerminalWindowRegistry.rewrite(result.target, windowIndex: windowIndex)
        )
      )
    case .removedGroup(let result):
      return .removedGroup(
        SupatermRemoveTabGroupResult(
          removedGroupID: result.removedGroupID,
          spaceID: result.spaceID,
          spaceIndex: result.spaceIndex,
          windowIndex: windowIndex
        )
      )
    }
  }
}

extension TerminalTabGroupRequest {
  fileprivate var groupID: UUID {
    switch self {
    case .close(let groupID), .pin(let groupID), .ungroup(let groupID), .unpin(let groupID):
      return groupID
    case .move(let request):
      return request.groupID
    case .rename(let request):
      return request.groupID
    case .setCollapsed(let request):
      return request.groupID
    case .setColor(let request):
      return request.groupID
    case .create, .moveTab:
      preconditionFailure("Request does not target a group")
    }
  }
}
