import SupatermCLIShared

extension SupatermAgentKind {
  var settingsInstallDescription: String {
    switch self {
    case .claude, .codex:
      return "\(notificationTitle) hooks: \(settingsPathDescription)"
    case .pi:
      return "\(notificationTitle) settings: \(settingsPathDescription)"
    }
  }

  var settingsFooterText: String {
    switch self {
    case .claude, .codex:
      return "Applied to `\(settingsPathDescription)`."
    case .pi:
      return "Managed in `\(settingsPathDescription)`."
    }
  }

  var settingsMarkImageName: String {
    switch self {
    case .claude:
      return "claude-code-mark"
    case .codex:
      return "codex-mark"
    case .pi:
      return "pi-mark"
    }
  }

  var settingsPathDescription: String {
    switch self {
    case .claude:
      return "~/.claude/settings.json"
    case .codex:
      return "~/.codex/hooks.json"
    case .pi:
      return "~/.pi/agent/settings.json"
    }
  }

  var settingsSubtitle: String {
    "Display agent activity in tabs and forward notifications to Supaterm."
  }
}
