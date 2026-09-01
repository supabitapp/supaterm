import Foundation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension SocketControlFeature {
  func notificationResponseResult(
    for request: SupatermSocketRequest,
    notificationOutputClient: NotificationOutputClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalNotify:
      let payload = try request.decodeParams(SupatermNotifyRequest.self)
      let notifyRequest = notifyRequest(from: payload)
      let execution = try await socketRequestExecutor.executeApp(.notify(notifyRequest))
      guard case .notify(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      @Shared(.supatermSettings) var supatermSettings = .default
      await notificationOutputClient.deliver(
        NotificationRequest(
          body: payload.body,
          disposition: result.notificationDisposition,
          subtitle: payload.subtitle,
          title: result.resolvedTitle,
          sourceSurfaceID: result.paneID
        ),
        supatermSettings.notificationOutput
      )
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalAgentHook:
      let payload = try request.decodeParams(SupatermAgentHookRequest.self)
      let execution = try await socketRequestExecutor.executeApp(.agentHook(payload))
      guard case .agentHook(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      @Shared(.supatermSettings) var supatermSettings = .default
      if let notification = result.notification {
        await notificationOutputClient.deliver(
          notification,
          supatermSettings.notificationOutput
        )
      }
      return .ok(id: request.id)

    default:
      return nil
    }
  }

  func notifyRequest(
    from payload: SupatermNotifyRequest
  ) -> TerminalNotifyRequest {
    TerminalNotifyRequest(
      body: payload.body,
      target: .pane(payload.paneID),
      title: payload.title
    )
  }
}
