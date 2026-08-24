import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func licenseResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    let controlRequest: LicenseControlRequest
    switch request.method {
    case SupatermSocketMethod.licenseActivate:
      let payload = try request.decodeParams(SupatermLicenseActivationRequest.self)
      controlRequest = .activate(payload.key)
    case SupatermSocketMethod.licenseBuy:
      controlRequest = .buy
    case SupatermSocketMethod.licenseDeactivate:
      controlRequest = .deactivate
    case SupatermSocketMethod.licenseRefresh:
      controlRequest = .refresh
    case SupatermSocketMethod.licenseRenew:
      controlRequest = .renew
    case SupatermSocketMethod.licenseStatus:
      controlRequest = .status
    default:
      return nil
    }

    let result = try await socketRequestExecutor.executeLicense(controlRequest)
    switch result {
    case .status(let status):
      return try .ok(id: request.id, encodableResult: status)
    case .url(let url):
      return try .ok(id: request.id, encodableResult: url)
    }
  }
}
