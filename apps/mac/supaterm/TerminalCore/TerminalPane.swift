import SupatermCLIShared

public nonisolated struct TerminalReference: Codable, Equatable, Hashable, Sendable {
  public let machineID: MachineID
  public let terminalID: TerminalID

  public init(machineID: MachineID, terminalID: TerminalID) {
    self.machineID = machineID
    self.terminalID = terminalID
  }
}

public nonisolated struct TerminalPane: Codable, Equatable, Identifiable, Sendable {
  public let id: PaneID
  public let terminal: TerminalReference

  public init(id: PaneID, terminal: TerminalReference) {
    self.id = id
    self.terminal = terminal
  }
}
