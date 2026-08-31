import SupatermCLIShared

extension SupatermAgentKind {
  var settingsInstallDescription: String {
    switch self {
    case .claude:
      return "\(notificationTitle) hooks: ~/.claude/settings.json"
    case .codex:
      return "\(notificationTitle) hooks: ~/.codex/hooks.json"
    case .pi:
      return "\(notificationTitle) settings: ~/.pi/agent/settings.json"
    }
  }
}
