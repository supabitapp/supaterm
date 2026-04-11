import Foundation
import SupatermCLIShared

extension SocketControlFeature {
  func systemResponseResult(
    for request: SupatermSocketRequest,
    socketControlClient: SocketControlClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.systemIdentity:
      guard let endpoint = await socketControlClient.currentEndpoint() else {
        return .error(
          id: request.id,
          code: "internal_error",
          message: "Supaterm socket endpoint is unavailable."
        )
      }
      return try .ok(id: request.id, encodableResult: endpoint)

    case SupatermSocketMethod.systemPing:
      return .ok(id: request.id, result: ["pong": true])

    default:
      return nil
    }
  }
}
