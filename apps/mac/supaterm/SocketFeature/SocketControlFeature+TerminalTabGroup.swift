import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalTabGroupResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalCreateTabGroup:
      let payload = try request.decodeParams(SupatermCreateTabGroupRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(
        .create(
          TerminalCreateTabGroupRequest(
            color: payload.color,
            isPinned: payload.isPinned,
            target: createSpaceTarget(from: payload.target),
            title: payload.title
          )
        )
      )
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalRenameTabGroup:
      let payload = try request.decodeParams(SupatermRenameTabGroupRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(
        .rename(
          TerminalRenameTabGroupRequest(
            groupID: payload.target.groupID,
            title: payload.title
          )
        )
      )
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalSetTabGroupColor:
      let payload = try request.decodeParams(SupatermSetTabGroupColorRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(
        .setColor(
          TerminalSetTabGroupColorRequest(
            color: payload.color,
            groupID: payload.target.groupID
          )
        )
      )
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalCollapseTabGroup:
      return try await tabGroupCollapsedResponse(
        request: request,
        isCollapsed: true,
        socketRequestExecutor: socketRequestExecutor
      )

    case SupatermSocketMethod.terminalExpandTabGroup:
      return try await tabGroupCollapsedResponse(
        request: request,
        isCollapsed: false,
        socketRequestExecutor: socketRequestExecutor
      )

    case SupatermSocketMethod.terminalMoveTabGroup:
      let payload = try request.decodeParams(SupatermMoveTabGroupRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(
        .move(
          TerminalMoveTabGroupRequest(
            groupID: payload.target.groupID,
            index: try zeroBasedIndex(payload.index, field: "index")
          )
        )
      )
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalUngroupTabGroup:
      return try await removedTabGroupResponse(
        request: request,
        operation: { .ungroup($0) },
        socketRequestExecutor: socketRequestExecutor
      )

    case SupatermSocketMethod.terminalCloseTabGroup:
      return try await removedTabGroupResponse(
        request: request,
        operation: { .close($0) },
        socketRequestExecutor: socketRequestExecutor
      )

    case SupatermSocketMethod.terminalPinTabGroup:
      let payload = try request.decodeParams(SupatermTabGroupTargetRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(.pin(payload.groupID))
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalUnpinTabGroup:
      let payload = try request.decodeParams(SupatermTabGroupTargetRequest.self)
      let result = try await socketRequestExecutor.executeTerminalTabGroup(.unpin(payload.groupID))
      return try groupMutationResponse(result, requestID: request.id)

    case SupatermSocketMethod.terminalMoveTab:
      return try await moveTabResponse(
        request: request,
        socketRequestExecutor: socketRequestExecutor
      )

    default:
      return nil
    }
  }

  private func moveTabResponse(
    request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse {
    let payload = try request.decodeParams(SupatermMoveTabRequest.self)
    let index = try payload.index.map { try zeroBasedIndex($0, field: "index") }
    let destination: TerminalMoveTabDestination
    switch payload.destination {
    case .group(let groupID):
      destination = .group(id: groupID, index: index)
    case .root(let isPinned):
      destination = .root(isPinned: isPinned, index: index)
    }
    let result = try await socketRequestExecutor.executeTerminalTabGroup(
      .moveTab(
        TerminalMoveTabRequest(
          destination: destination,
          target: createTabTarget(from: payload.target)
        )
      )
    )
    guard case .movedTab(let movedTab) = result else {
      throw SocketExecutorError.unexpectedResult
    }
    return try .ok(id: request.id, encodableResult: movedTab)
  }

  private func tabGroupCollapsedResponse(
    request: SupatermSocketRequest,
    isCollapsed: Bool,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse {
    let payload = try request.decodeParams(SupatermTabGroupTargetRequest.self)
    let result = try await socketRequestExecutor.executeTerminalTabGroup(
      .setCollapsed(
        TerminalSetTabGroupCollapsedRequest(
          groupID: payload.groupID,
          isCollapsed: isCollapsed
        )
      )
    )
    return try groupMutationResponse(result, requestID: request.id)
  }

  private func removedTabGroupResponse(
    request: SupatermSocketRequest,
    operation: (UUID) -> TerminalTabGroupRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse {
    let payload = try request.decodeParams(SupatermTabGroupTargetRequest.self)
    let result = try await socketRequestExecutor.executeTerminalTabGroup(
      operation(payload.groupID)
    )
    guard case .removedGroup(let removedGroup) = result else {
      throw SocketExecutorError.unexpectedResult
    }
    return try .ok(id: request.id, encodableResult: removedGroup)
  }

  private func groupMutationResponse(
    _ result: TerminalTabGroupResult,
    requestID: String
  ) throws -> SupatermSocketResponse {
    guard case .group(let group) = result else {
      throw SocketExecutorError.unexpectedResult
    }
    return try .ok(id: requestID, encodableResult: group)
  }

  private func zeroBasedIndex(
    _ index: Int,
    field: String
  ) throws -> Int {
    guard index > 0 else {
      throw SocketRequestError.invalidIndex(field)
    }
    return index - 1
  }
}
