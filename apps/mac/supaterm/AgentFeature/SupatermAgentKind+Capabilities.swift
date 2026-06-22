import SupatermCLIShared

extension SupatermAgentKind {
  public var drivesActivityFromTranscript: Bool {
    self == .codex
  }

  public var keepsPanelTrackingWhenNotRunning: Bool {
    self == .claude
  }

  public var recoversSessionsFromToolHooks: Bool {
    self == .codex
  }
}
