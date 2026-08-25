import SupatermTerminalCore

extension TerminalCommandExecutor {
  func execute(_ request: TerminalProjectRequest) throws -> TerminalProjectResult {
    try registry.execute(request)
  }
}
