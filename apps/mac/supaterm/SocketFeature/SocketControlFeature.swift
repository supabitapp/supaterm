import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

private nonisolated enum SocketControlCancelID: Hashable, Sendable {
  case observation
  case requests
}

enum SocketRequestError: Error, Equatable, LocalizedError {
  case invalidIndex(String)
  case invalidStartupCommand
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
    case .invalidStartupCommand:
      return "Startup command is invalid."
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
    public init() {}
  }

  public enum Action {
    case requestReceived(SocketControlClient.Request)
    case shutdown
    case task
  }

  @Dependency(SocketControlClient.self) var socketControlClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(SocketRequestExecutor.self) var socketRequestExecutor

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { _, action in
      switch action {
      case .requestReceived(let request):
        return .run { [desktopNotificationClient, socketControlClient, socketRequestExecutor] _ in
          guard !Task.isCancelled else { return }
          guard await socketControlClient.isPending(request.handle) else { return }
          let response = await response(
            for: request.payload,
            desktopNotificationClient: desktopNotificationClient,
            socketControlClient: socketControlClient,
            socketRequestExecutor: socketRequestExecutor
          )
          guard !Task.isCancelled else { return }
          await socketControlClient.reply(request.handle, response)
        }
        .cancellable(id: SocketControlCancelID.requests)

      case .shutdown:
        return .merge(
          .cancel(id: SocketControlCancelID.observation),
          .cancel(id: SocketControlCancelID.requests),
          .run { [socketControlClient] _ in
            await socketControlClient.stop()
          }
        )

      case .task:
        return .run { [socketControlClient] send in
          do {
            let endpoint = try await socketControlClient.start()
            guard !Task.isCancelled else { return }
            SupatermLog.notice(
              SupatermLog.socket,
              "socket.started",
              fields: ["path=\(endpoint.path)"]
            )
            let requests = await socketControlClient.requests()
            for await request in requests {
              guard !Task.isCancelled else { return }
              await send(.requestReceived(request))
            }
          } catch is CancellationError {
            return
          } catch {
            SupatermLog.error(
              SupatermLog.socket,
              "socket.start.failed",
              fields: ["error=\(error.localizedDescription)"]
            )
          }
        }
        .cancellable(id: SocketControlCancelID.observation, cancelInFlight: true)
      }
    }
  }

  func response(
    for request: SupatermSocketRequest,
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async -> SupatermSocketResponse {
    do {
      return try await responseResult(
        for: request,
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
    } catch let error as SupatermSettingsCommandError {
      return .error(
        id: request.id,
        code: "invalid_request",
        message: error.localizedDescription
      )
    } catch let error as LicenseControlError {
      return .error(
        id: request.id,
        code: error.code,
        message: error.message
      )
    } catch let error as SupatermSkillsError {
      return skillsErrorResponse(error, requestID: request.id)
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
    desktopNotificationClient: DesktopNotificationClient,
    socketControlClient: SocketControlClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse {
    if let response = try await licenseResponseResult(
      for: request,
      socketRequestExecutor: socketRequestExecutor
    ) {
      return response
    }
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
    if let response = try await terminalProjectResponseResult(
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
