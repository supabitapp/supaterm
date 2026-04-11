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
      let createTabRequest = try createTabRequest(from: payload)
      let execution = try await socketRequestExecutor.executeTerminalCreation(
        .createTab(createTabRequest)
      )
      guard case .createTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalNewPane:
      let payload = try request.decodeParams(SupatermNewPaneRequest.self)
      let createPaneRequest = try createPaneRequest(from: payload)
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
  ) throws -> TerminalCreateTabRequest {
    try validateCreateTabPayload(payload)

    return .init(
      command: payload.command,
      cwd: payload.cwd,
      focus: payload.focus,
      target: try createTabTarget(from: payload)
    )
  }

  func validateCreateTabPayload(
    _ payload: SupatermNewTabRequest
  ) throws {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if payload.targetWindowIndex != nil && payload.targetSpaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }

  func createTabTarget(
    from payload: SupatermNewTabRequest
  ) throws -> TerminalCreateTabRequest.Target {
    switch payload.targetSpaceIndex {
    case .some(let spaceIndex):
      return .space(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: spaceIndex
      )

    case .none:
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingSpaceTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)
    }
  }

  func createPaneRequest(
    from payload: SupatermNewPaneRequest
  ) throws -> TerminalCreatePaneRequest {
    try validateCreatePanePayload(payload)

    return .init(
      command: payload.command,
      cwd: payload.cwd,
      direction: payload.direction,
      focus: payload.focus,
      equalize: payload.equalize,
      target: try createPaneTarget(from: payload)
    )
  }

  func validateCreatePanePayload(
    _ payload: SupatermNewPaneRequest
  ) throws {
    try validateTargetPayload(
      windowIndex: payload.targetWindowIndex,
      spaceIndex: payload.targetSpaceIndex,
      tabIndex: payload.targetTabIndex,
      paneIndex: payload.targetPaneIndex
    )
  }

  func createPaneTarget(
    from payload: SupatermNewPaneRequest
  ) throws -> TerminalCreatePaneRequest.Target {
    switch (payload.targetSpaceIndex, payload.targetTabIndex, payload.targetPaneIndex) {
    case (nil, nil, nil):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.some, .some, nil):
      return .tab(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!
      )

    case (.some, .some, .some):
      return .pane(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!,
        paneIndex: payload.targetPaneIndex!
      )

    case (.none, .some, _):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none, _):
      throw SocketRequestError.spaceRequiresTab
    case (.none, .none, .some):
      throw SocketRequestError.paneRequiresTab
    }
  }
}
