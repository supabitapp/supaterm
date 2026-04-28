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

  var tabTitleMarkImageName: String {
    switch self {
    case .claude, .codex:
      return markImageName
    case .pi:
      return "pi-mark-glyph"
    }
  }
}
