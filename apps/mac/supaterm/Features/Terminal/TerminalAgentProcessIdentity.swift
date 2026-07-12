import Darwin
import Foundation

nonisolated struct TerminalAgentProcessIdentity: Codable, Equatable, Hashable, Sendable {
  let processID: Int32
  let startTimeMicroseconds: UInt64
}

nonisolated enum TerminalAgentProcessInspector {
  static func identity(for processID: Int32) -> TerminalAgentProcessIdentity? {
    guard processID > 0 else { return nil }
    var info = proc_bsdinfo()
    let expectedSize = Int32(MemoryLayout<proc_bsdinfo>.size)
    let returnedSize = proc_pidinfo(
      processID,
      PROC_PIDTBSDINFO,
      0,
      &info,
      expectedSize
    )
    guard returnedSize == expectedSize,
      info.pbi_pid == UInt32(processID),
      info.pbi_status != UInt32(SZOMB),
      info.pbi_start_tvusec < 1_000_000
    else {
      return nil
    }
    let (seconds, multipliedOverflow) = info.pbi_start_tvsec.multipliedReportingOverflow(
      by: 1_000_000
    )
    guard !multipliedOverflow else { return nil }
    let (startTimeMicroseconds, addedOverflow) = seconds.addingReportingOverflow(
      info.pbi_start_tvusec
    )
    guard !addedOverflow, startTimeMicroseconds > 0 else { return nil }
    return TerminalAgentProcessIdentity(
      processID: processID,
      startTimeMicroseconds: startTimeMicroseconds
    )
  }

  static func isCurrent(_ identity: TerminalAgentProcessIdentity) -> Bool {
    self.identity(for: identity.processID) == identity
  }
}
