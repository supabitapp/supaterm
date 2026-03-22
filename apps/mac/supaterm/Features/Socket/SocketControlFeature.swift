import ComposableArchitecture
import Foundation
import SupatermCLIShared

private enum SocketControlCancelID {
  static let requests = "SocketControlFeature.requests"
}

private enum SocketRequestError: Error, Equatable, LocalizedError {
  case invalidIndex(String)
  case missingTarget
  case onboardingUnavailable
  case paneRequiresTab
  case spaceRequiresTab
  case tabRequiresSpace
  case windowRequiresSpace

  var errorDescription: String? {
    switch self {
    case .invalidIndex(let field):
      return "\(field) must be 1 or greater."
    case .missingTarget:
      return "Provide a target space and tab or run the command inside a Supaterm pane."
    case .onboardingUnavailable:
      return "No Supaterm window is available."
    case .paneRequiresTab:
      return "pane target requires a tab target."
    case .spaceRequiresTab:
      return "space target requires a tab target."
    case .tabRequiresSpace:
      return "tab target requires a space target."
    case .windowRequiresSpace:
      return "window target requires a space target."
    }
  }
}

@Reducer
struct SocketControlFeature {
  @ObservableState
  struct State: Equatable {
    var socketPath: String?
    var startErrorMessage: String?
  }

  enum Action {
    case requestReceived(SocketControlClient.Request)
    case started(String)
    case startFailed(String)
    case task
  }

  @Dependency(SocketControlClient.self) var socketControlClient
  @Dependency(TerminalWindowsClient.self) var terminalWindowsClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .requestReceived(let request):
        return .run { [socketControlClient, terminalWindowsClient] _ in
          let response = await response(
            for: request.payload,
            terminalWindowsClient: terminalWindowsClient
          )
          await socketControlClient.reply(request.handle, response)
        }

      case .started(let socketPath):
        state.socketPath = socketPath
        state.startErrorMessage = nil
        return .none

      case .startFailed(let message):
        state.startErrorMessage = message
        return .none

      case .task:
        return .run { [socketControlClient] send in
          do {
            let socketPath = try await socketControlClient.start()
            await send(.started(socketPath))
            let requests = await socketControlClient.requests()
            for await request in requests {
              await send(.requestReceived(request))
            }
          } catch {
            await send(.startFailed(error.localizedDescription))
          }
        }
        .cancellable(id: SocketControlCancelID.requests, cancelInFlight: true)
      }
    }
  }

  private func response(
    for request: SupatermSocketRequest,
    terminalWindowsClient: TerminalWindowsClient
  ) async -> SupatermSocketResponse {
    do {
      switch request.method {
      case SupatermSocketMethod.appOnboarding:
        guard let snapshot = await terminalWindowsClient.onboardingSnapshot() else {
          throw SocketRequestError.onboardingUnavailable
        }
        return try .ok(id: request.id, encodableResult: snapshot)

      case SupatermSocketMethod.appDebug:
        let payload = try request.decodeParams(SupatermDebugRequest.self)
        let snapshot = await terminalWindowsClient.debugSnapshot(payload)
        return try .ok(id: request.id, encodableResult: snapshot)

      case SupatermSocketMethod.appTree:
        let snapshot = await terminalWindowsClient.treeSnapshot()
        return try .ok(id: request.id, encodableResult: snapshot)

      case SupatermSocketMethod.systemPing:
        return .ok(id: request.id, result: ["pong": true])

      case SupatermSocketMethod.terminalNewPane:
        let payload = try request.decodeParams(SupatermNewPaneRequest.self)
        let createPaneRequest = try createPaneRequest(from: payload)
        let result = try await terminalWindowsClient.createPane(createPaneRequest)
        return try .ok(id: request.id, encodableResult: result)

      default:
        return .error(
          id: request.id,
          code: "method_not_found",
          message: "Unknown method '\(request.method)'."
        )
      }
    } catch let error as SocketRequestError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as SupatermSocketProtocolError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as TerminalCreatePaneError {
      return createPaneErrorResponse(error, requestID: request.id)
    } catch {
      return .error(
        id: request.id,
        code: "internal_error",
        message: error.localizedDescription
      )
    }
  }

  private func createPaneRequest(
    from payload: SupatermNewPaneRequest
  ) throws -> TerminalCreatePaneRequest {
    try validateCreatePanePayload(payload)

    return .init(
      command: payload.command,
      direction: payload.direction,
      focus: payload.focus,
      target: try createPaneTarget(from: payload)
    )
  }

  private func validateCreatePanePayload(
    _ payload: SupatermNewPaneRequest
  ) throws {
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
    if payload.targetPaneIndex != nil && payload.targetTabIndex == nil {
      throw SocketRequestError.paneRequiresTab
    }
    if payload.targetTabIndex != nil && payload.targetSpaceIndex == nil {
      throw SocketRequestError.tabRequiresSpace
    }
    if payload.targetSpaceIndex != nil && payload.targetTabIndex == nil {
      throw SocketRequestError.spaceRequiresTab
    }
    if payload.targetWindowIndex != nil && payload.targetSpaceIndex == nil {
      throw SocketRequestError.windowRequiresSpace
    }
  }

  private func createPaneTarget(
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

  private func createPaneErrorResponse(
    _ error: TerminalCreatePaneError,
    requestID: String
  ) -> SupatermSocketResponse {
    switch error {
    case .contextPaneNotFound:
      return .error(
        id: requestID,
        code: "not_found",
        message: "The current pane could not be resolved."
      )

    case .creationFailed:
      return .error(
        id: requestID,
        code: "internal_error",
        message: "Failed to create a new pane."
      )

    case .paneNotFound(let windowIndex, let spaceIndex, let tabIndex, let paneIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Pane \(paneIndex) was not found in tab \(tabIndex) of space \(spaceIndex) of window \(windowIndex)."
      )

    case .spaceNotFound(let windowIndex, let spaceIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Space \(spaceIndex) was not found in window \(windowIndex)."
      )

    case .tabNotFound(let windowIndex, let spaceIndex, let tabIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Tab \(tabIndex) was not found in space \(spaceIndex) of window \(windowIndex)."
      )

    case .windowNotFound(let windowIndex):
      return .error(
        id: requestID,
        code: "not_found",
        message: "Window \(windowIndex) was not found."
      )
    }
  }
}
