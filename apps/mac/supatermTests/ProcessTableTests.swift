import Darwin
import Foundation
import Testing

@testable import SupatermSupport

struct ProcessTableTests {
  private static func entry(
    _ processID: pid_t,
    parentProcessID: pid_t,
    processGroupID: pid_t,
    name: String
  ) -> ProcessEntry {
    ProcessEntry(
      identity: TerminalAgentProcessIdentity(
        processID: processID,
        startTimeMicroseconds: UInt64(processID)
      ),
      parentProcessID: parentProcessID,
      processGroupID: processGroupID,
      name: name
    )
  }

  private static func processArguments(
    count: Int,
    executablePath: String,
    arguments: [String],
    environment: [String] = []
  ) -> [UInt8] {
    var buffer: [UInt8] = []
    let value = UInt32(count)
    buffer.append(contentsOf: [
      UInt8(value & 0xFF),
      UInt8((value >> 8) & 0xFF),
      UInt8((value >> 16) & 0xFF),
      UInt8((value >> 24) & 0xFF),
    ])
    buffer.append(contentsOf: Array(executablePath.utf8))
    buffer.append(contentsOf: [0, 0, 0])
    for argument in arguments {
      buffer.append(contentsOf: Array(argument.utf8))
      buffer.append(0)
    }
    for variable in environment {
      buffer.append(contentsOf: Array(variable.utf8))
      buffer.append(0)
    }
    return buffer
  }

  @Test
  func parsesArgumentsAndTerminalTypeAfterExecutablePathPadding() throws {
    let parsed = ProcessTable.invocation(
      inProcessArguments: Self.processArguments(
        count: 3,
        executablePath: "/usr/bin/ssh",
        arguments: ["ssh", "-p", "2222"],
        environment: ["HOME=/Users/khoi", "TERM=xterm-custom", "COLORTERM=truecolor"]
      )
    )

    let invocation = try #require(parsed)
    #expect(invocation.executablePath == "/usr/bin/ssh")
    #expect(invocation.arguments == ["ssh", "-p", "2222"])
    #expect(invocation.terminalType == "xterm-custom")
  }

  @Test
  func rejectsTruncatedArgumentVectors() {
    #expect(
      ProcessTable.invocation(
        inProcessArguments: Self.processArguments(
          count: 4,
          executablePath: "/usr/bin/ssh",
          arguments: ["ssh", "example.com"]
        )
      ) == nil
    )
    #expect(ProcessTable.invocation(inProcessArguments: [1, 0]) == nil)
  }

  @Test
  func snapshotSeesTheCurrentProcess() throws {
    let table = ProcessTable.snapshot()
    let current = try #require(table.entries.first { $0.processID == getpid() })

    #expect(current.parentProcessID == getppid())
    #expect(current.processGroupID == getpgrp())
    #expect(current.identity.startTimeMicroseconds > 0)
  }

  @Test
  func readsInvocationOfTheCurrentProcess() throws {
    let invocation = try #require(ProcessTable.invocation(forProcessID: getpid()))

    #expect(!invocation.arguments.isEmpty)
    #expect(invocation.terminalType == ProcessInfo.processInfo.environment["TERM"])
  }

  @Test
  func convertsProcessStartTimeToMicroseconds() {
    #expect(
      TerminalAgentProcessIdentity(
        processID: 1,
        seconds: 1_234,
        microseconds: 567_890
      )?.startTimeMicroseconds == 1_234_567_890
    )
  }

  @Test
  func rejectsInvalidProcessStartTimes() {
    let invalidTimes: [(seconds: Int64, microseconds: Int64)] = [
      (-1, 0),
      (1, -1),
      (1, 1_000_000),
      (0, 0),
      (Int64.max, 999_999),
    ]

    for time in invalidTimes {
      #expect(
        TerminalAgentProcessIdentity(
          processID: 1,
          seconds: time.seconds,
          microseconds: time.microseconds
        ) == nil
      )
    }
  }

  @Test
  func readsAndValidatesTheCurrentProcessIdentity() throws {
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))

    #expect(identity.processID == getpid())
    #expect(identity.startTimeMicroseconds > 0)
    #expect(TerminalAgentProcessInspector.isCurrent(identity))
    #expect(
      !TerminalAgentProcessInspector.isCurrent(
        TerminalAgentProcessIdentity(
          processID: identity.processID,
          startTimeMicroseconds: identity.startTimeMicroseconds + 1
        )
      )
    )
  }

  @Test
  func readsArgumentsOnlyForTheCurrentProcessIdentity() throws {
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let arguments = try #require(TerminalAgentProcessInspector.commandLineArguments(for: identity))

    #expect(arguments == ProcessTable.invocation(forProcessID: getpid())?.arguments)
    #expect(
      TerminalAgentProcessInspector.commandLineArguments(
        for: TerminalAgentProcessIdentity(
          processID: identity.processID,
          startTimeMicroseconds: identity.startTimeMicroseconds + 1
        )
      ) == nil
    )
  }

  @Test(arguments: [Int32.min, -1, 0])
  func nonpositiveProcessIDHasNoIdentity(processID: Int32) {
    #expect(TerminalAgentProcessInspector.identity(for: processID) == nil)
  }

  @Test
  func processTreeReturnsExactGroupMembersAndDescendants() {
    let root = Self.entry(
      10,
      parentProcessID: 1,
      processGroupID: 10,
      name: "root"
    )
    let child = Self.entry(
      20,
      parentProcessID: 10,
      processGroupID: 20,
      name: "child"
    )
    let grandchild = Self.entry(
      30,
      parentProcessID: 20,
      processGroupID: 30,
      name: "grandchild"
    )
    let groupMember = Self.entry(
      40,
      parentProcessID: 1,
      processGroupID: 20,
      name: "group"
    )
    let snapshot = TerminalAgentProcessTreeSnapshot(
      entries: [root, child, grandchild, groupMember]
    )

    #expect(snapshot.identities(inProcessGroup: 20) == [child.identity, groupMember.identity])
    #expect(
      snapshot.descendants(of: [root.identity])
        == [root.identity, child.identity, grandchild.identity]
    )
  }

  @Test
  func processTreeRejectsAReusedRootIdentity() {
    let current = Self.entry(
      10,
      parentProcessID: 1,
      processGroupID: 10,
      name: "root"
    )
    let child = Self.entry(
      20,
      parentProcessID: 10,
      processGroupID: 10,
      name: "child"
    )
    let snapshot = TerminalAgentProcessTreeSnapshot(entries: [current, child])
    let reused = TerminalAgentProcessIdentity(
      processID: current.processID,
      startTimeMicroseconds: current.identity.startTimeMicroseconds + 1
    )

    #expect(snapshot.descendants(of: [reused]).isEmpty)
  }
}
