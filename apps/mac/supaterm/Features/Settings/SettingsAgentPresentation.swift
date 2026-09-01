import SupatermCLIShared

extension SupatermManagedAgentKind {
  var settingsInstallDescription: String {
    "\(notificationTitle) hooks: \(settingsPathDescription)"
  }

  var settingsPathDescription: String {
    switch self {
    case .claude:
      return "~/.claude/settings.json"
    case .codex:
      return "~/.codex/hooks.json"
    }
  }
}
