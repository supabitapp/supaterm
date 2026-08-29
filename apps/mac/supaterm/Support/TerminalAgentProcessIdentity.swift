import Darwin
import Foundation

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
    guard let process = process(for: processID) else { return nil }
    return TerminalAgentProcessIdentity(
      processID: processID,
      seconds: process.kp_proc.p_starttime.tv_sec,
      microseconds: process.kp_proc.p_starttime.tv_usec
    )
  }

  public static func isCurrent(_ identity: TerminalAgentProcessIdentity) -> Bool {
    self.identity(for: identity.processID) == identity
  }

  public static func commandLineArguments(
    for identity: TerminalAgentProcessIdentity
  ) -> [String]? {
    guard isCurrent(identity),
      let arguments = ProcessTable.invocation(forProcessID: identity.processID)?.arguments,
      isCurrent(identity)
    else {
      return nil
    }
    return arguments
  }

  public static func workingDirectoryPath(
    for identity: TerminalAgentProcessIdentity
  ) -> String? {
    guard isCurrent(identity) else { return nil }
    var info = proc_vnodepathinfo()
    let size = MemoryLayout<proc_vnodepathinfo>.size
    guard
      proc_pidinfo(
        identity.processID,
        PROC_PIDVNODEPATHINFO,
        0,
        &info,
        Int32(size)
      ) == Int32(size),
      isCurrent(identity)
    else {
      return nil
    }
    let path = withUnsafePointer(to: &info.pvi_cdir.vip_path) { pointer in
      pointer.withMemoryRebound(to: CChar.self, capacity: Int(MAXPATHLEN)) {
        String(cString: $0)
      }
    }
    return path.isEmpty ? nil : path
  }

  public static func codexWorkingDirectoryPath(
    for identity: TerminalAgentProcessIdentity
  ) -> String? {
    guard let processWorkingDirectoryPath = workingDirectoryPath(for: identity) else {
      return nil
    }
    return codexWorkingDirectoryPath(
      processWorkingDirectoryPath: processWorkingDirectoryPath,
      commandLineArguments: commandLineArguments(for: identity) ?? []
    )
  }

  static func codexWorkingDirectoryPath(
    processWorkingDirectoryPath: String,
    commandLineArguments: [String]
  ) -> String {
    var declaredPath: String?
    for index in commandLineArguments.indices {
      let argument = commandLineArguments[index]
      if argument == "--cd" || argument == "-C" {
        let valueIndex = commandLineArguments.index(after: index)
        if valueIndex < commandLineArguments.endIndex {
          declaredPath = commandLineArguments[valueIndex]
        }
      } else if argument.hasPrefix("--cd=") {
        declaredPath = String(argument.dropFirst("--cd=".count))
      } else if argument.hasPrefix("-C"), argument.count > 2 {
        declaredPath = String(argument.dropFirst(2))
      }
    }
    guard let declaredPath, !declaredPath.isEmpty else {
      return processWorkingDirectoryPath
    }
    return URL(
      fileURLWithPath: declaredPath,
      relativeTo: URL(fileURLWithPath: processWorkingDirectoryPath, isDirectory: true)
    )
    .standardizedFileURL
    .path(percentEncoded: false)
  }

  public static func foregroundProcessGroupID(for processID: Int32) -> Int32? {
    guard
      let processGroupID = process(for: processID)?.kp_eproc.e_tpgid,
      processGroupID > 0
    else {
      return nil
    }
    return processGroupID
  }

  private static func process(for processID: Int32) -> kinfo_proc? {
    guard processID > 0 else { return nil }
    var request: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, processID]
    var process = kinfo_proc()
    var size = MemoryLayout<kinfo_proc>.size
    guard
      sysctl(&request, 4, &process, &size, nil, 0) == 0,
      size == MemoryLayout<kinfo_proc>.size,
      process.kp_proc.p_pid == processID,
      process.kp_proc.p_stat != Int8(SZOMB)
    else {
      return nil
    }
    return process
  }
}
