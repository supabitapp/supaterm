import Foundation
import SupatermSupport

struct TerminalSidebarPanePresentation: Equatable, Identifiable, Sendable {
  enum Icon: Equatable, Sendable {
    case terminal
    case agent(String)
  }

  enum Indicator: Equatable, Sendable {
    case agent(TerminalHostState.TabAgentStatus)
    case attention
  }

  let id: UUID
  let title: String
  let icon: Icon
  let indicator: Indicator?

  init(
    id: UUID,
    title: String,
    icon: Icon = .terminal,
    indicator: Indicator?
  ) {
    self.id = id
    self.title = title
    self.icon = icon
    self.indicator = indicator
  }
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
        icon: sidebarPaneIcon(for: surface.id),
        indicator: indicator
      )
    }
  }

  private func sidebarPaneIcon(for surfaceID: UUID) -> TerminalSidebarPanePresentation.Icon {
    let resolution = resolvedAgentState(for: surfaceID).resolution
    let resolvedAgentID: String? =
      switch resolution {
      case .native(let candidates):
        candidates.max { $0.revision < $1.revision }.map {
          AgentDetectionAgentIdentity($0.presentation.agent).id
        }
      case .terminal(let observation, _):
        observation.agent.id
      }
    let agentID = agentDetectionStore.processMatch(for: surfaceID)?.agentID ?? resolvedAgentID
    guard let agentID, let imageName = TerminalCodingAgentCatalog.markImageName(for: agentID) else {
      return .terminal
    }
    return .agent(imageName)
  }
}
