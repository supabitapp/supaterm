import Darwin

public struct TerminalAgentProcessIdentity: Codable, Equatable, Hashable, Sendable {
  public let processID: Int32
  public let startTimeMicroseconds: UInt64

  public init(processID: Int32, startTimeMicroseconds: UInt64) {
    self.processID = processID
    self.startTimeMicroseconds = startTimeMicroseconds
  }

  init?<Seconds: BinaryInteger, Microseconds: BinaryInteger>(
    processID: Int32,
    seconds: Seconds,
    microseconds: Microseconds
  ) {
    guard
      processID > 0,
      let seconds = UInt64(exactly: seconds),
      let microseconds = UInt64(exactly: microseconds),
      microseconds < 1_000_000
    else {
      return nil
    }
    let (scaledSeconds, multipliedOverflow) = seconds.multipliedReportingOverflow(by: 1_000_000)
    guard !multipliedOverflow else { return nil }
    let (startTimeMicroseconds, addedOverflow) = scaledSeconds.addingReportingOverflow(microseconds)
    guard !addedOverflow, startTimeMicroseconds > 0 else { return nil }

    self.init(
      processID: processID,
      startTimeMicroseconds: startTimeMicroseconds
    )
  }
}

public enum TerminalAgentProcessInspector {
  public static func identity(for processID: Int32) -> TerminalAgentProcessIdentity? {
    guard let info = bsdInfo(for: processID) else { return nil }
    return TerminalAgentProcessIdentity(
      processID: processID,
      seconds: info.pbi_start_tvsec,
      microseconds: info.pbi_start_tvusec
    )
  }

  public static func isCurrent(_ identity: TerminalAgentProcessIdentity) -> Bool {
    self.identity(for: identity.processID) == identity
  }

  public static func foregroundProcessGroupID(for processID: Int32) -> Int32? {
    guard
      let processGroupID = bsdInfo(for: processID)?.e_tpgid,
      processGroupID > 0
    else {
      return nil
    }
    return Int32(exactly: processGroupID)
  }

  private static func bsdInfo(for processID: Int32) -> proc_bsdinfo? {
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
    guard
      returnedSize == expectedSize,
      info.pbi_pid == UInt32(processID),
      info.pbi_status != UInt32(SZOMB)
    else {
      return nil
    }
    return info
  }
}
