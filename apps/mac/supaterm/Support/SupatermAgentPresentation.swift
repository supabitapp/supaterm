import SupatermCLIShared

public extension SupatermAgentKind {
  var markImageName: String {
    switch self {
    case .claude:
      return "claude-code-mark"
    case .codex:
      return "codex-mark"
    case .pi:
      return "pi-mark"
    }
  }
}
