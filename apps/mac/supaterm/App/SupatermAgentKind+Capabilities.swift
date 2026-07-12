import SupatermCLIShared

extension SupatermAgentKind {
  var drivesActivityFromTranscript: Bool {
    self == .codex
  }
}
