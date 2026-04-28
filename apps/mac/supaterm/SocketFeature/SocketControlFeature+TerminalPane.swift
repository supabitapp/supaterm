import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalPaneResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    if let response = try await terminalPaneTargetResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    return try await terminalPaneInputResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    )
  }

  func terminalPaneTargetResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalFocusPane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .focusPane(try createPaneTarget(from: payload))
      )
      guard case .focusPane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastPane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .lastPane(try createPaneTarget(from: payload))
      )
      guard case .lastPane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalClosePane:
      let payload = try request.decodeParams(SupatermPaneTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .closePane(try createPaneTarget(from: payload))
      )
      guard case .closePane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func terminalPaneInputResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalSendText:
      let payload = try request.decodeParams(SupatermSendTextRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .sendText(
          TerminalSendTextRequest(
            target: try createPaneTarget(from: payload.target),
            text: payload.text
          )
        )
      )
      guard case .sendText(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSendKey:
      let payload = try request.decodeParams(SupatermSendKeyRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .sendKey(
          TerminalSendKeyRequest(
            key: payload.key,
            target: try createPaneTarget(from: payload.target)
          )
        )
      )
      guard case .sendKey(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCapturePane:
      let payload = try request.decodeParams(SupatermCapturePaneRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .capturePane(
          TerminalCapturePaneRequest(
            lines: payload.lines,
            scope: payload.scope,
            target: try createPaneTarget(from: payload.target)
          )
        )
      )
      guard case .capturePane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalResizePane:
      let payload = try request.decodeParams(SupatermResizePaneRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .resizePane(
          TerminalResizePaneRequest(
            amount: payload.amount,
            direction: payload.direction,
            target: try createPaneTarget(from: payload.target)
          )
        )
      )
      guard case .resizePane(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalSetPaneSize:
      let payload = try request.decodeParams(SupatermSetPaneSizeRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalPane(
        .setPaneSize(
          TerminalSetPaneSizeRequest(
            amount: payload.amount,
            axis: payload.axis,
            target: try createPaneTarget(from: payload.target),
            unit: payload.unit
          )
        )
      )
      guard case .setPaneSize(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func createPaneTarget(
    from payload: SupatermPaneTargetRequest
  ) throws -> TerminalPaneTarget {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex = payload.targetTabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }
    if let paneIndex = payload.targetPaneIndex, paneIndex < 1 {
      throw SocketRequestError.invalidIndex("pane")
    }

    switch (payload.targetSpaceIndex, payload.targetTabIndex, payload.targetPaneIndex) {
    case (.some, .some, .some):
      return .pane(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!,
        paneIndex: payload.targetPaneIndex!
      )

    case (.none, .none, .none):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.none, .some, _):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none, _):
      throw SocketRequestError.spaceRequiresTab
    case (.some, .some, .none):
      throw SocketRequestError.paneRequiresTab
    case (.none, .none, .some):
      throw SocketRequestError.paneRequiresTab
    }
  }
}
