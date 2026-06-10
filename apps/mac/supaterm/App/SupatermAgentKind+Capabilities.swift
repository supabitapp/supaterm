import SupatermCLIShared

extension SupatermAgentKind {
  var drivesActivityFromTranscript: Bool {
    self == .codex
  }

  var keepsPanelTrackingWhenNotRunning: Bool {
    self == .claude
  }

  var recoversSessionsFromToolHooks: Bool {
    self == .codex
  }
}
