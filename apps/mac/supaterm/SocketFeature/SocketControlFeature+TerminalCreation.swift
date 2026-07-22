import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalCreationResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalNewTab:
      let payload = try request.decodeParams(SupatermNewTabRequest.self)
      let createTabRequest = createTabRequest(from: payload)
      let execution = try await socketRequestExecutor.executeTerminalCreation(
        .createTab(createTabRequest)
      )
      guard case .createTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNewPane:
      let payload = try request.decodeParams(SupatermNewPaneRequest.self)
      let createPaneRequest = createPaneRequest(from: payload)
      let execution = try await socketRequestExecutor.executeTerminalCreation(
        .createPane(createPaneRequest)
      )
      guard case .createPane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func createTabRequest(
    from payload: SupatermNewTabRequest
  ) -> TerminalCreateTabRequest {
    TerminalCreateTabRequest(
      startupCommand: payload.startupCommand,
      cwd: payload.cwd,
      focus: payload.focus,
      target: createTabTarget(from: payload.target)
    )
  }

  func createTabTarget(
    from target: SupatermNewTabTarget
  ) -> TerminalCreateTabRequest.Target {
    switch target {
    case .group(let id):
      return .group(id)
    case .pane(let id):
      return .pane(id)
    case .root(let id):
      return .root(id)
    case .space(let id):
      return .space(id)
    }
  }

  func createPaneRequest(
    from payload: SupatermNewPaneRequest
  ) -> TerminalCreatePaneRequest {
    TerminalCreatePaneRequest(
      startupCommand: payload.startupCommand,
      cwd: payload.cwd,
      direction: payload.direction,
      focus: payload.focus,
      equalize: payload.equalize,
      target: createPaneTarget(from: payload.target)
    )
  }

  func createPaneTarget(
    from target: SupatermNewPaneTarget
  ) -> TerminalCreatePaneRequest.Target {
    switch target {
    case .pane(let id):
      return .pane(id)
    case .tab(let id):
      return .tab(id)
    }
  }
}
