import Foundation
import SupatermCLIShared
import SupatermComputerUseFeature

extension SocketControlFeature {
  func computerUseResponseResult(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient
  ) async throws -> SupatermSocketResponse? {
    if let response = try await computerUseStateResponse(for: request, computerUseClient: computerUseClient) {
      return response
    }
    if let response = try await computerUseTargetResponse(for: request, computerUseClient: computerUseClient) {
      return response
    }
    if let response = try await computerUseActionResponse(for: request, computerUseClient: computerUseClient) {
      return response
    }
    return try await computerUsePageResponse(for: request, computerUseClient: computerUseClient)
  }

  private func computerUseStateResponse(
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

    case SupatermSocketMethod.computerUseScreenSize:
      let result = try await computerUseClient.screenSize()
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseCursorPosition:
      let result = try await computerUseClient.cursorPosition()
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseCursorState:
      let result = try await computerUseClient.cursorState()
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseMoveCursor:
      let payload = try request.decodeParams(SupatermComputerUseMoveCursorRequest.self)
      let result = try await computerUseClient.moveCursor(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseCursorSet:
      let payload = try request.decodeParams(SupatermComputerUseCursorRequest.self)
      let result = try await computerUseClient.cursorSet(payload)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func computerUseTargetResponse(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
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

    case SupatermSocketMethod.computerUseScreenshot:
      let payload = try request.decodeParams(SupatermComputerUseScreenshotRequest.self)
      let result = try await computerUseClient.screenshot(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseZoom:
      let payload = try request.decodeParams(SupatermComputerUseZoomRequest.self)
      let result = try await computerUseClient.zoom(payload)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func computerUseActionResponse(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
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

    case SupatermSocketMethod.computerUseHotkey:
      let payload = try request.decodeParams(SupatermComputerUseHotkeyRequest.self)
      let result = try await computerUseClient.hotkey(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseScroll:
      let payload = try request.decodeParams(SupatermComputerUseScrollRequest.self)
      let result = try await computerUseClient.scroll(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseSetValue:
      let payload = try request.decodeParams(SupatermComputerUseSetValueRequest.self)
      let result = try await computerUseClient.setValue(payload)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  private func computerUsePageResponse(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.computerUsePage:
      let payload = try request.decodeParams(SupatermComputerUsePageRequest.self)
      let result = try await computerUseClient.page(payload)
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.computerUseRecording:
      let payload = try request.decodeParams(SupatermComputerUseRecordingRequest.self)
      let result = try await computerUseClient.recording(payload)
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }
}
