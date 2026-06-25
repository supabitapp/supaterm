import Darwin

public nonisolated func terminalAgentProcessIsAlive(_ processID: Int32) -> Bool {
  processID > 0 && kill(pid_t(processID), 0) == 0
}
