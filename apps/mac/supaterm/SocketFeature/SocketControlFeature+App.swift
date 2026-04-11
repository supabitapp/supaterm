import Foundation
import SupatermCLIShared

extension SocketControlFeature {
  func appResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.appOnboarding:
      let result = try await socketRequestExecutor.executeApp(.onboardingSnapshot)
      guard case .onboardingSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      guard let snapshot else {
        throw SocketRequestError.onboardingUnavailable
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appDebug:
      let payload = try request.decodeParams(SupatermDebugRequest.self)
      let result = try await socketRequestExecutor.executeApp(.debugSnapshot(payload))
      guard case .debugSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    case SupatermSocketMethod.appTree:
      let result = try await socketRequestExecutor.executeApp(.treeSnapshot)
      guard case .treeSnapshot(let snapshot) = result else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: snapshot)

    default:
      return nil
    }
  }
}
