import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalProjectResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    let operation: TerminalProjectRequest
    switch request.method {
    case SupatermSocketMethod.terminalAddProject:
      operation = .add(try request.decodeParams(SupatermAddProjectRequest.self))
    case SupatermSocketMethod.terminalRenameProject:
      operation = .rename(try request.decodeParams(SupatermRenameProjectRequest.self))
    case SupatermSocketMethod.terminalSetProjectColor:
      operation = .setColor(try request.decodeParams(SupatermSetProjectColorRequest.self))
    case SupatermSocketMethod.terminalSetProjectCollapsed:
      operation = .setCollapsed(try request.decodeParams(SupatermSetProjectCollapsedRequest.self))
    case SupatermSocketMethod.terminalReorderProject:
      let payload = try request.decodeParams(SupatermReorderProjectRequest.self)
      guard payload.index > 0 else { throw SocketRequestError.invalidIndex("index") }
      operation = .reorder(payload)
    case SupatermSocketMethod.terminalRemoveProject:
      operation = .remove(try request.decodeParams(SupatermRemoveProjectRequest.self))
    case SupatermSocketMethod.terminalPinProject:
      operation = .pin(try request.decodeParams(SupatermProjectTargetRequest.self))
    case SupatermSocketMethod.terminalUnpinProject:
      operation = .unpin(try request.decodeParams(SupatermProjectTargetRequest.self))
    default:
      return nil
    }

    let result = try await socketRequestExecutor.executeTerminalProject(operation)
    return try terminalProjectResponse(id: request.id, result: result)
  }

  private func terminalProjectResponse(
    id: String,
    result: TerminalProjectResult
  ) throws -> SupatermSocketResponse {
    switch result {
    case .collapsed(let collapsed):
      return try .ok(id: id, encodableResult: collapsed)
    case .project(let project):
      return try .ok(id: id, encodableResult: project)
    case .removedProject(let removedProject):
      return try .ok(id: id, encodableResult: removedProject)
    }
  }
}
