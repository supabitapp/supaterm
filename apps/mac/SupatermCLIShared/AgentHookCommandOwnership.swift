enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    guard let command else {
      return false
    }
    guard command.contains("SUPATERM_CLI_PATH") else {
      return false
    }
    return command.contains(" internal agent-hook ") || command.contains(" agent-hook ")
  }
}
