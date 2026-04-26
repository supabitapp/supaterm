import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermComputerUseFeature
import SupatermSupport
import SupatermTerminalCore

private enum SocketControlCancelID {
  static let requests = "SocketControlFeature.requests"
}

enum SocketRequestError: Error, Equatable, LocalizedError {
  case invalidIndex(String)
  case missingTarget
  case missingSpaceTarget
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
    case .missingSpaceTarget:
      return "Provide a target space or run the command inside a Supaterm pane."
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

enum SocketExecutorError: Error {
  case unexpectedResult
}

@MainActor
@Reducer
public struct SocketControlFeature {
  @ObservableState
  public struct State: Equatable {
    public var endpoint: SupatermSocketEndpoint?
    public var startErrorMessage: String?

    public init(
      endpoint: SupatermSocketEndpoint? = nil,
      startErrorMessage: String? = nil
    ) {
      self.endpoint = endpoint
      self.startErrorMessage = startErrorMessage
    }
  }

  public enum Action {
    case requestReceived(SocketControlClient.Request)
    case shutdown
    case started(SupatermSocketEndpoint)
    case startFailed(String)
    case task
  }

  @Dependency(SocketControlClient.self) var socketControlClient
  @Dependency(ComputerUseClient.self) var computerUseClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(SocketRequestExecutor.self) var socketRequestExecutor

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .requestReceived(let request):
        return .run { [computerUseClient, desktopNotificationClient, socketControlClient, socketRequestExecutor] _ in
          let response = await response(
            for: request.payload,
            computerUseClient: computerUseClient,
            desktopNotificationClient: desktopNotificationClient,
            socketControlClient: socketControlClient,
            socketRequestExecutor: socketRequestExecutor
          )
          await socketControlClient.reply(request.handle, response)
        }

      case .started(let endpoint):
        state.endpoint = endpoint
        state.startErrorMessage = nil
        return .none

      case .startFailed(let message):
        state.startErrorMessage = message
        return .none

      case .shutdown:
        return .merge(
          .cancel(id: SocketControlCancelID.requests),
          .run { [socketControlClient] _ in
            await socketControlClient.stop()
          }
        )

      case .task:
        return .run { [socketControlClient] send in
          do {
            let endpoint = try await socketControlClient.start()
            await send(.started(endpoint))
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

  func response(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient,
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async -> SupatermSocketResponse {
    do {
      return try await responseResult(
        for: request,
        computerUseClient: computerUseClient,
        desktopNotificationClient: desktopNotificationClient,
        socketControlClient: socketControlClient,
        socketRequestExecutor: socketRequestExecutor
      )
    } catch let error as SocketRequestError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as DecodingError {
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
    } catch let error as ComputerUseError {
      return .error(
        id: request.id,
        code: error.code,
        message: error.localizedDescription
      )
    } catch let error as TerminalCreateTabError {
      return createTabErrorResponse(error, requestID: request.id)
    } catch let error as TerminalCreatePaneError {
      return terminalErrorResponse(error, requestID: request.id)
    } catch let error as TerminalControlError {
      return controlErrorResponse(error, requestID: request.id)
    } catch {
      return .error(
        id: request.id,
        code: "internal_error",
        message: error.localizedDescription
      )
    }
  }

  func responseResult(
    for request: SupatermSocketRequest,
    computerUseClient: ComputerUseClient,
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse {
    if let response = try await appResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await systemResponseResult(
      for: request,
      socketControlClient: socketControlClient
    ) {
      return response
    }
    if let response = try await computerUseResponseResult(
      for: request,
      computerUseClient: computerUseClient
    ) {
      return response
    }
    if let response = try await notificationResponseResult(
      for: request,
      desktopNotificationClient: desktopNotificationClient,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await terminalControlResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    return .error(
      id: request.id,
      code: "method_not_found",
      message: "Unknown method '\(request.method)'."
    )
  }

  func terminalControlResponseResult(
    for request: SupatermSocketRequest,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    if let response = try await terminalCreationResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await terminalPaneResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    if let response = try await terminalTabResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
    return try await terminalSpaceResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    )
  }
}
