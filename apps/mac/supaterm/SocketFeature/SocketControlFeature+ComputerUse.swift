import Foundation
import SupatermCLIShared
import SupatermComputerUseFeature

extension SocketControlFeature {
  func computerUseResponseResult(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.computerUsePermissions:
      let result = await computerUseClient.permissions()
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseApps:
      let result = try await computerUseClient.apps()
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseLaunch:
      let payload = try request.decodeParams(SupatermComputerUseLaunchRequest.self)
      let result = try await computerUseClient.launch(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseWindows:
      let payload = try request.decodeParams(SupatermComputerUseWindowsRequest.self)
      let result = try await computerUseClient.windows(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseSnapshot:
      let payload = try request.decodeParams(SupatermComputerUseSnapshotRequest.self)
      let result = try await computerUseClient.snapshot(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseClick:
      let payload = try request.decodeParams(SupatermComputerUseClickRequest.self)
      let result = try await computerUseClient.click(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseType:
      let payload = try request.decodeParams(SupatermComputerUseTypeRequest.self)
      let result = try await computerUseClient.type(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseKey:
      let payload = try request.decodeParams(SupatermComputerUseKeyRequest.self)
      let result = try await computerUseClient.key(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseScroll:
      let payload = try request.decodeParams(SupatermComputerUseScrollRequest.self)
      let result = try await computerUseClient.scroll(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseSetValue:
      let payload = try request.decodeParams(SupatermComputerUseSetValueRequest.self)
      let result = try await computerUseClient.setValue(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUsePage:
      let payload = try request.decodeParams(SupatermComputerUsePageRequest.self)
      let result = try await computerUseClient.page(payload)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }
}
