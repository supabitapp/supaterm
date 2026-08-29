import Foundation

struct TerminalSidebarPanePresentation: Equatable, Identifiable, Sendable {
  enum Indicator: Equatable, Sendable {
    case agent(TerminalHostState.TabAgentStatus)
    case attention
  }

  let id: UUID
  let title: String
  let indicator: Indicator?
}

extension TerminalHostState {
  func sidebarPanePresentations(for tabID: TerminalTabID) -> [TerminalSidebarPanePresentation] {
    guard let tree = trees[tabID] else { return [] }
    let focusedSurfaceID = focusHistoryByTab[tabID]?.current
    return tree.leaves().enumerated().map { index, surface in
      let agentStatus = paneAgentStatus(
        for: surface.id,
        in: tabID,
        focusedSurfaceID: focusedSurfaceID
      )
      let indicator: TerminalSidebarPanePresentation.Indicator?
      if let agentStatus {
        indicator = .agent(agentStatus)
      } else {
        let notifications = notificationStore.notifications(for: surface.id) ?? []
        let hasAttention =
          Self.surfaceAttentionState(in: notifications) == .unread
          || surface.bridge.state.bellCount > 0
        indicator = hasAttention ? .attention : nil
      }
      return TerminalSidebarPanePresentation(
        id: surface.id,
        title: Self.resolvedSidebarPaneTitle(
          titleOverride: surface.bridge.state.titleOverride,
          title: surface.bridge.state.title,
          pwd: surface.bridge.state.pwd,
          defaultValue: "Pane \(index + 1)"
        ),
        indicator: indicator
      )
    }
  }
}
