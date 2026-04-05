enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    guard let command else {
      return false
    }
    guard command.contains("SUPATERM_CLI_PATH") else {
      return false
    }
    return command.contains(" agent receive-agent-hook ")
  }
}
