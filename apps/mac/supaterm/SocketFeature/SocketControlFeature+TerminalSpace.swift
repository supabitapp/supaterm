import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalSpaceResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    if let response = try await terminalSpaceMutationResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    return try await terminalSpaceNavigationResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    )
  }

  func terminalSpaceMutationResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalCreateSpace:
      let payload = try request.decodeParams(SupatermCreateSpaceRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .createSpace(
          TerminalCreateSpaceRequest(
            color: payload.color,
            name: payload.name,
            context: payload.context
          )
        )
      )
      guard case .createSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSetSpaceColor:
      let payload = try request.decodeParams(SupatermSetSpaceColorRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .setSpaceColor(
          TerminalSetSpaceColorRequest(
            color: payload.color,
            target: createSpaceTarget(from: payload.target)
          )
        )
      )
      guard case .setSpaceColor(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCloseSpace:
      let payload = try request.decodeParams(SupatermSpaceTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .closeSpace(createSpaceTarget(from: payload))
      )
      guard case .closeSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalRenameSpace:
      let payload = try request.decodeParams(SupatermRenameSpaceRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .renameSpace(
          TerminalRenameSpaceRequest(
            name: payload.name,
            target: createSpaceTarget(from: payload.target)
          )
        )
      )
      guard case .renameSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func terminalSpaceNavigationResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalSelectSpace:
      let payload = try request.decodeParams(SupatermSpaceTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .selectSpace(createSpaceTarget(from: payload))
      )
      guard case .selectSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNextSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .nextSpace(createSpaceNavigationRequest(from: payload))
      )
      guard case .nextSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalPreviousSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .previousSpace(createSpaceNavigationRequest(from: payload))
      )
      guard case .previousSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastSpace:
      let payload = try request.decodeParams(SupatermSpaceNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalSpace(
        .lastSpace(createSpaceNavigationRequest(from: payload))
      )
      guard case .lastSpace(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func createSpaceTarget(
    from payload: SupatermSpaceTargetRequest
  ) -> TerminalSpaceTarget {
    TerminalSpaceTarget(spaceID: payload.spaceID, context: payload.context)
  }

  func createSpaceNavigationRequest(
    from payload: SupatermSpaceNavigationRequest
  ) -> TerminalSpaceNavigationRequest {
    TerminalSpaceNavigationRequest(context: payload.context)
  }
}
