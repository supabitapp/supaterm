nonisolated enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    guard let command else {
      return false
    }
    return command.contains("SUPATERM_CLI_PATH") && command.contains("agent-hook")
  }
}
