import Foundation

nonisolated enum TerminalBarAgentPhase: String, Equatable, Sendable {
  case needsInput
  case running
  case idle
}

nonisolated enum TerminalBarAgentTone: String, Equatable, Sendable {
  case attention
  case active
  case muted
}

nonisolated struct TerminalBarAgentContext: Equatable, Sendable {
  let kindTitle: String
  let phase: TerminalBarAgentPhase
  let detail: String?
  let tone: TerminalBarAgentTone

  init(activity: TerminalHostState.AgentActivity) {
    kindTitle = activity.kind.notificationTitle
    phase =
      switch activity.phase {
      case .needsInput:
        .needsInput
      case .running:
        .running
      case .idle:
        .idle
      }
    detail = activity.detail
    tone =
      switch phase {
      case .needsInput:
        .attention
      case .running:
        .active
      case .idle:
        .muted
      }
  }

  var refreshID: String {
    "\(kindTitle):\(phase):\(detail ?? ""):\(tone)"
  }
}

nonisolated struct TerminalBarContextRefreshID: Equatable, Sendable {
  let selectedSpaceID: String?
  let selectedTabID: String
  let focusedPaneID: String
  let paneTitle: String
  let workingDirectoryPath: String?
  let agentID: String?
  let commandExitCode: Int?
  let commandDuration: UInt64?
}

nonisolated struct TerminalBarContext: Equatable, Sendable {
  let selectedSpaceID: String?
  let selectedTabID: String
  let focusedPaneID: String
  let paneTitle: String
  let workingDirectoryPath: String?
  let agentActivity: TerminalBarAgentContext?
  let commandExitCode: Int?
  let commandDuration: UInt64?

  var refreshID: TerminalBarContextRefreshID {
    TerminalBarContextRefreshID(
      selectedSpaceID: selectedSpaceID,
      selectedTabID: selectedTabID,
      focusedPaneID: focusedPaneID,
      paneTitle: paneTitle,
      workingDirectoryPath: workingDirectoryPath,
      agentID: agentActivity?.refreshID,
      commandExitCode: commandExitCode,
      commandDuration: commandDuration
    )
  }
}

extension TerminalHostState {
  var selectedBarContext: TerminalBarContext? {
    guard
      let selectedTabID,
      let focusedSurfaceID = currentFocusedSurfaceID()
    else {
      return nil
    }

    let focusedPaneID = focusedSurfaceID.uuidString
    let state = selectedSurfaceState
    let agentActivity = tabAgentPresentation(for: selectedTabID).detailActivity

    return TerminalBarContext(
      selectedSpaceID: selectedSpaceID?.rawValue.uuidString,
      selectedTabID: selectedTabID.rawValue.uuidString,
      focusedPaneID: focusedPaneID,
      paneTitle: selectedPaneDisplayTitle,
      workingDirectoryPath: state?.pwd,
      agentActivity: agentActivity.map(TerminalBarAgentContext.init),
      commandExitCode: state?.commandExitCode,
      commandDuration: state?.commandDuration
    )
  }
}
