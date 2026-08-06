import Darwin
import Foundation
import SupatermCLIShared

struct ProcessInvocation: Sendable, Equatable {
  let arguments: [String]
  let terminalType: String?
}

struct ProcessEntry: Sendable, Equatable {
  let processID: pid_t
  let parentProcessID: pid_t
  let processGroupID: pid_t
  let foregroundProcessGroupID: pid_t
  let terminalDevice: dev_t
  let name: String
}

struct ProcessTable: Sendable, Equatable {
  let entries: [ProcessEntry]

  func children(of processID: pid_t) -> [ProcessEntry] {
    entries.filter { $0.parentProcessID == processID }
  }

  func foregroundGroup(onTerminalOf entry: ProcessEntry) -> [ProcessEntry] {
    entries.filter {
      $0.terminalDevice == entry.terminalDevice
        && $0.processGroupID == entry.foregroundProcessGroupID
    }
  }

  func foregroundGroup(
    inZmxSession sessionName: String,
    invocation: @Sendable (pid_t) -> ProcessInvocation?
  ) -> [ProcessEntry] {
    guard let shell = zmxSessionShell(sessionName: sessionName, invocation: invocation) else {
      return []
    }
    return foregroundGroup(onTerminalOf: shell)
  }

  func commandName(
    processGroupID: pid_t?,
    zmxSessionName: String?,
    invocation: @Sendable (pid_t) -> ProcessInvocation?
  ) -> String? {
    let group: [ProcessEntry]
    if let zmxSessionName {
      group = foregroundGroup(inZmxSession: zmxSessionName, invocation: invocation)
    } else if let processGroupID {
      group = entries.filter { $0.processGroupID == processGroupID }
    } else {
      group = []
    }
    guard let leader = group.first(where: { $0.processID == $0.processGroupID }) ?? group.first else {
      return nil
    }
    return leader.name.isEmpty ? nil : leader.name
  }

  static func snapshot() -> ProcessTable {
    var request: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
    let stride = MemoryLayout<kinfo_proc>.stride
    var slack = 64

    while slack <= 4096 {
      var probedSize = 0
      guard sysctl(&request, 4, nil, &probedSize, nil, 0) == 0, probedSize > 0 else {
        return ProcessTable(entries: [])
      }

      var processes = [kinfo_proc](repeating: kinfo_proc(), count: probedSize / stride + slack)
      var readSize = processes.count * stride
      if sysctl(&request, 4, &processes, &readSize, nil, 0) == 0 {
        return ProcessTable(entries: processes.prefix(readSize / stride).map(entry(from:)))
      }
      guard errno == ENOMEM else { return ProcessTable(entries: []) }
      slack *= 4
    }

    return ProcessTable(entries: [])
  }

  static func invocation(forProcessID processID: pid_t) -> ProcessInvocation? {
    var request: [Int32] = [CTL_KERN, KERN_PROCARGS2, processID]
    var probedSize = 0
    guard sysctl(&request, 3, nil, &probedSize, nil, 0) == 0, probedSize > 0 else { return nil }

    var buffer = [UInt8](repeating: 0, count: probedSize)
    var readSize = probedSize
    guard sysctl(&request, 3, &buffer, &readSize, nil, 0) == 0 else { return nil }

    return invocation(inProcessArguments: Array(buffer.prefix(readSize)))
  }

  static func invocation(inProcessArguments buffer: [UInt8]) -> ProcessInvocation? {
    let countWidth = MemoryLayout<UInt32>.size
    guard buffer.count > countWidth else { return nil }
    let count =
      Int(buffer[0]) | Int(buffer[1]) << 8 | Int(buffer[2]) << 16 | Int(buffer[3]) << 24

    var index = countWidth
    while index < buffer.count, buffer[index] != 0 { index += 1 }
    guard index < buffer.count else { return nil }
    while index < buffer.count, buffer[index] == 0 { index += 1 }

    var arguments: [String] = []
    while arguments.count < count, index < buffer.count {
      guard
        let bytes = nextBytes(in: buffer, index: &index),
        let argument = String(bytes: bytes, encoding: .utf8)
      else {
        return nil
      }
      arguments.append(argument)
    }

    guard arguments.count == count else { return nil }

    let terminalTypePrefix = Array("TERM=".utf8)
    var terminalType: String?
    while index < buffer.count {
      while index < buffer.count, buffer[index] == 0 { index += 1 }
      guard index < buffer.count else { break }
      guard let variable = nextBytes(in: buffer, index: &index) else { return nil }
      if variable.starts(with: terminalTypePrefix) {
        terminalType = String(
          bytes: variable.dropFirst(terminalTypePrefix.count),
          encoding: .utf8
        )
      }
    }

    return ProcessInvocation(arguments: arguments, terminalType: terminalType)
  }

  private static func entry(from process: kinfo_proc) -> ProcessEntry {
    ProcessEntry(
      processID: process.kp_proc.p_pid,
      parentProcessID: process.kp_eproc.e_ppid,
      processGroupID: process.kp_eproc.e_pgid,
      foregroundProcessGroupID: process.kp_eproc.e_tpgid,
      terminalDevice: process.kp_eproc.e_tdev,
      name: name(from: process)
    )
  }

  private static func name(from process: kinfo_proc) -> String {
    withUnsafeBytes(of: process.kp_proc.p_comm) { raw in
      String(bytes: raw.prefix { $0 != 0 }, encoding: .utf8) ?? ""
    }
  }

  private static func nextBytes(in buffer: [UInt8], index: inout Int) -> ArraySlice<UInt8>? {
    let start = index
    while index < buffer.count, buffer[index] != 0 { index += 1 }
    guard index < buffer.count else { return nil }
    defer { index += 1 }
    return buffer[start..<index]
  }

  private func zmxSessionShell(
    sessionName: String,
    invocation: @Sendable (pid_t) -> ProcessInvocation?
  ) -> ProcessEntry? {
    for entry in entries where entry.name == SupatermBundleLayout.zmxExecutableName {
      guard invocation(entry.processID)?.arguments.contains(sessionName) == true else { continue }
      if let shell = children(of: entry.processID).first(where: {
        $0.name != SupatermBundleLayout.zmxExecutableName
      }) {
        return shell
      }
    }
    return nil
  }
}

public enum TerminalForegroundProcess {
  public static func commandName(
    processGroupID: Int32?,
    zmxSessionName: String?
  ) -> String? {
    let table = ProcessTable.snapshot()
    return table.commandName(
      processGroupID: processGroupID,
      zmxSessionName: zmxSessionName,
      invocation: { ProcessTable.invocation(forProcessID: $0) }
    )
  }
}
