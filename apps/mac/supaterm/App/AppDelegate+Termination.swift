import AppKit
import SupatermCLIShared
import SupatermTerminalModels

extension AppDelegate {
  struct TerminationPlan {
    let reply: NSApplication.TerminateReply
    let terminatesSessions: Bool
  }

  static func terminationPlan(
    hasVisibleAppWindows: Bool,
    confirmQuitMode: ConfirmQuitMode = .auto,
    hasActiveAgentWorkForQuit: Bool = false,
    needsQuitConfirmation: Bool,
    bypassesQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool = false,
    confirmQuit: () -> QuitConfirmationDecision
  ) -> TerminationPlan {
    let defaultPlan = TerminationPlan(reply: .terminateNow, terminatesSessions: terminatesSessionsOnQuit)
    guard hasVisibleAppWindows else { return defaultPlan }
    guard !bypassesQuitConfirmation else { return defaultPlan }
    guard
      shouldConfirmQuit(
        mode: confirmQuitMode,
        hasActiveAgentWorkForQuit: hasActiveAgentWorkForQuit,
        needsQuitConfirmation: needsQuitConfirmation,
        terminatesSessionsOnQuit: terminatesSessionsOnQuit
      )
    else {
      return defaultPlan
    }
    switch confirmQuit() {
    case .cancel:
      return TerminationPlan(reply: .terminateCancel, terminatesSessions: false)
    case .quitPreservingSessions:
      return TerminationPlan(reply: .terminateNow, terminatesSessions: false)
    case .quitTerminatingSessions:
      return TerminationPlan(reply: .terminateNow, terminatesSessions: true)
    }
  }

  static func shouldConfirmQuit(
    mode: ConfirmQuitMode,
    hasActiveAgentWorkForQuit: Bool,
    needsQuitConfirmation: Bool,
    terminatesSessionsOnQuit: Bool
  ) -> Bool {
    switch mode {
    case .always:
      return true
    case .never:
      return false
    case .auto:
      return hasActiveAgentWorkForQuit || needsQuitConfirmation || terminatesSessionsOnQuit
    }
  }
}
