import SupatermSocketFeature

extension SocketRequestExecutor {
  static func live(commandExecutor: TerminalCommandExecutor) -> Self {
    Self(
      executeApp: { try commandExecutor.execute($0) },
      executeTerminalCreation: { try commandExecutor.execute($0) },
      executeTerminalPane: { try commandExecutor.execute($0) },
      executeTerminalTab: { try commandExecutor.execute($0) },
      executeTerminalSpace: { try commandExecutor.execute($0) }
    )
  }
}
