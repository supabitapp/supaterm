enum AgentHookCommandOwnership {
  static func isSupatermManagedCommand(_ command: String?) -> Bool {
    SupatermManagedHookCommand.isManagedCommand(command)
  }
}
