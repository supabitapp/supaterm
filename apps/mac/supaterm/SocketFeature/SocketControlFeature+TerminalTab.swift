import Foundation
import SupatermCLIShared
import SupatermTerminalCore

extension SocketControlFeature {
  func terminalTabResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    if let response = try await terminalTabLayoutResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await terminalTabTargetResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    return try await terminalTabNavigationResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    )
  }

  func terminalTabLayoutResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalTilePanes:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .tilePanes(.init(target: try createTabTarget(from: payload)))
      )
      guard case .tilePanes(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalEqualizePanes:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .equalizePanes(.init(target: try createTabTarget(from: payload)))
      )
      guard case .equalizePanes(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalMainVerticalPanes:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .mainVerticalPanes(.init(target: try createTabTarget(from: payload)))
      )
      guard case .mainVerticalPanes(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func terminalTabTargetResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalSelectTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .selectTab(try createTabTarget(from: payload))
      )
      guard case .selectTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalPinTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .pinTab(try createTabTarget(from: payload))
      )
      guard case .pinTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalUnpinTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .unpinTab(try createTabTarget(from: payload))
      )
      guard case .unpinTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalCloseTab:
      let payload = try request.decodeParams(SupatermTabTargetRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .closeTab(try createTabTarget(from: payload))
      )
      guard case .closeTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalRenameTab:
      let payload = try request.decodeParams(SupatermRenameTabRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .renameTab(
          .init(
            target: try createTabTarget(from: payload.target),
            title: payload.title
          )
        )
      )
      guard case .renameTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func terminalTabNavigationResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalNextTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .nextTab(createTabNavigationRequest(from: payload))
      )
      guard case .nextTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalPreviousTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .previousTab(createTabNavigationRequest(from: payload))
      )
      guard case .previousTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalLastTab:
      let payload = try request.decodeParams(SupatermTabNavigationRequest.self)
      let execution = try await socketRequestExecutor.executeTerminalTab(
        .lastTab(createTabNavigationRequest(from: payload))
      )
      guard case .lastTab(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      return try .ok(id: request.id, encodableResult: result)

    default:
      return nil
    }
  }

  func createTabTarget(
    from payload: SupatermTabTargetRequest
  ) throws -> TerminalTabTarget {
    if let windowIndex = payload.targetWindowIndex, windowIndex < 1 {
      throw SocketRequestError.invalidIndex("window")
    }
    if let spaceIndex = payload.targetSpaceIndex, spaceIndex < 1 {
      throw SocketRequestError.invalidIndex("space")
    }
    if let tabIndex = payload.targetTabIndex, tabIndex < 1 {
      throw SocketRequestError.invalidIndex("tab")
    }

    switch (payload.targetSpaceIndex, payload.targetTabIndex) {
    case (.some, .some):
      return .tab(
        windowIndex: payload.targetWindowIndex ?? 1,
        spaceIndex: payload.targetSpaceIndex!,
        tabIndex: payload.targetTabIndex!
      )

    case (.none, .none):
      guard let contextPaneID = payload.contextPaneID else {
        throw SocketRequestError.missingTarget
      }
      if payload.targetWindowIndex != nil {
        throw SocketRequestError.windowRequiresSpace
      }
      return .contextPane(contextPaneID)

    case (.none, .some):
      throw SocketRequestError.tabRequiresSpace
    case (.some, .none):
      throw SocketRequestError.spaceRequiresTab
    }
  }

  func createTabNavigationRequest(
    from payload: SupatermTabNavigationRequest
  ) -> TerminalTabNavigationRequest {
    .init(
      contextPaneID: payload.contextPaneID,
      spaceIndex: payload.targetSpaceIndex,
      windowIndex: payload.targetWindowIndex
    )
  }
}
