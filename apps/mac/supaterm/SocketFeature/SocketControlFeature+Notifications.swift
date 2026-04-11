import Foundation
import Sharing
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension SocketControlFeature {
  func notificationResponseResult(
    for request: SupatermSocketRequest,
    desktopNotificationClient: DesktopNotificationClient,
    socketRequestExecutor: SocketRequestExecutor
  ) async throws -> SupatermSocketResponse? {
    switch request.method {
    case SupatermSocketMethod.terminalNotify:
      let payload = try request.decodeParams(SupatermNotifyRequest.self)
      let notifyRequest = try notifyRequest(from: payload)
      let execution = try await socketRequestExecutor.executeApp(.notify(notifyRequest))
      guard case .notify(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      @Shared(.supatermSettings) var supatermSettings = .default
      if supatermSettings.systemNotificationsEnabled
        && result.desktopNotificationDisposition.shouldDeliver
      {
        await desktopNotificationClient.deliver(
          .init(
            body: payload.body,
            subtitle: payload.subtitle,
            title: result.resolvedTitle
          )
        )
      }
      return try .ok(id: request.id, encodableResult: result)

    case SupatermSocketMethod.terminalAgentHook:
      let payload = try request.decodeParams(SupatermAgentHookRequest.self)
      let execution = try await socketRequestExecutor.executeApp(.agentHook(payload))
      guard case .agentHook(let result) = execution else {
        throw SocketExecutorError.unexpectedResult
      }
      @Shared(.supatermSettings) var supatermSettings = .default
      if supatermSettings.systemNotificationsEnabled,
        let desktopNotification = result.desktopNotification
      {
        await desktopNotificationClient.deliver(desktopNotification)
      }
      return .ok(id: request.id)

    default:
      return nil
    }
  }

  func notifyRequest(
    from payload: SupatermNotifyRequest
  ) throws -> TerminalNotifyRequest {
    try validateTargetPayload(
      windowIndex: payload.targetWindowIndex,
      spaceIndex: payload.targetSpaceIndex,
      tabIndex: payload.targetTabIndex,
      paneIndex: payload.targetPaneIndex
    )

    return .init(
      body: payload.body,
      subtitle: payload.subtitle,
      target: try createNotifyTarget(from: payload),
      title: payload.title
    )
  }

  func createNotifyTarget(
    from payload: SupatermNotifyRequest
  ) throws -> TerminalNotifyRequest.Target {
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
