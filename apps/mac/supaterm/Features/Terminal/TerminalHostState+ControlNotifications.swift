import Foundation
import SupatermCLIShared
import SupatermGhosttyFeature
import SupatermTerminalCore
import SupatermTerminalModels
import SupatermTerminalStateFeature

extension TerminalHostState {
  @discardableResult
  public func clearRecentStructuredNotification(for surfaceID: UUID) -> Bool {
    notificationStore.clearRecentStructured(for: surfaceID)
  }

  func notify(
    _ request: TerminalNotifyRequest,
    origin: NotificationOrigin
  ) throws -> SupatermNotifyResult {
    let resolvedTarget = try resolveNotifyTarget(request.target)
    let paneLocation = try resolvedPaneLocation(
      spaceID: resolvedTarget.spaceID,
      tabID: resolvedTarget.tabID,
      surfaceID: resolvedTarget.anchorSurface.id,
      tree: resolvedTarget.tree
    )
    let selectionState = Self.newPaneSelectionState(
      selectedTabID: spaceManager.selectedTabID,
      targetTabID: resolvedTarget.tabID,
      windowActivity: windowActivity,
      focusedSurfaceID: focusHistoryByTab[resolvedTarget.tabID]?.current,
      surfaceID: resolvedTarget.anchorSurface.id
    )
    let attentionState: SupatermNotificationAttentionState = .unread
    let desktopNotificationDisposition = resolvedDesktopNotificationDisposition(
      allowDesktopNotificationWhenAgentActive: request.allowDesktopNotificationWhenAgentActive,
      isFocused: selectionState.isFocused,
      tabID: resolvedTarget.tabID
    )
    let resolvedTitle = resolvedNotificationTitle(
      request.title,
      for: resolvedTarget.tabID
    )
    let createdAt = Date()
    coalesceStructuredNotificationIfNeeded(
      body: request.body,
      origin: origin,
      surfaceID: resolvedTarget.anchorSurface.id,
      title: resolvedTitle
    )
    notificationStore.append(
      PaneNotification(
        attentionState: attentionState,
        body: request.body,
        createdAt: createdAt,
        title: resolvedTitle,
        origin: origin
      ),
      for: resolvedTarget.anchorSurface.id
    )
    updateRecentStructuredNotificationIfNeeded(
      body: request.body,
      createdAt: createdAt,
      origin: origin,
      surfaceID: resolvedTarget.anchorSurface.id,
      title: resolvedTitle
    )

    return SupatermNotifyResult(
      attentionState: attentionState,
      desktopNotificationDisposition: desktopNotificationDisposition,
      resolvedTitle: resolvedTitle,
      windowIndex: 1,
      spaceIndex: paneLocation.spaceIndex,
      spaceID: resolvedTarget.spaceID.rawValue,
      tabIndex: paneLocation.tabIndex,
      tabID: resolvedTarget.tabID.rawValue,
      paneIndex: paneLocation.paneIndex,
      paneID: resolvedTarget.anchorSurface.id
    )
  }

  func handleDesktopNotification(
    body: String,
    surfaceID: UUID,
    title: String
  ) {
    let subtitle = ""
    guard !shouldSuppressDesktopNotification(body: body, surfaceID: surfaceID, title: title) else {
      return
    }
    guard
      let result = try? notify(
        TerminalNotifyRequest(
          body: body,
          subtitle: subtitle,
          target: .contextPane(surfaceID),
          title: Self.trimmedNonEmpty(title)
        ),
        origin: .terminalDesktop
      )
    else {
      return
    }
    emit(
      .notificationReceived(
        TerminalNotificationEvent(
          attentionState: result.attentionState,
          body: body,
          desktopNotificationDisposition: result.desktopNotificationDisposition,
          resolvedTitle: result.resolvedTitle,
          sourceSurfaceID: surfaceID,
          subtitle: subtitle
        )
      )
    )
  }

  func handleDirectInteraction(on surfaceID: UUID) {
    clearNotificationAttention(for: surfaceID)
  }
}
