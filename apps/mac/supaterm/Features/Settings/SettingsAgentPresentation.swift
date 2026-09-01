import SupatermCLIShared

extension SupatermAgentKind {
  var settingsInstallDescription: String {
    "\(notificationTitle) hooks: \(settingsPathDescription)"
  }

  var settingsPathDescription: String {
    switch self {
    case .claude:
      return "~/.claude/settings.json"
    case .codex:
      return "~/.codex/hooks.json"
    case .pi:
      preconditionFailure("Pi has no managed integration")
    }
  }
}
