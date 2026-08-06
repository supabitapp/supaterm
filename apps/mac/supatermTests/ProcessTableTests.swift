import Darwin
import Foundation
import Testing

@testable import SupatermSupport

struct ProcessTableTests {
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
  }

  @Test
  func readsInvocationOfTheCurrentProcess() throws {
    let invocation = try #require(ProcessTable.invocation(forProcessID: getpid()))

    #expect(!invocation.arguments.isEmpty)
    #expect(invocation.terminalType == ProcessInfo.processInfo.environment["TERM"])
  }

  @Test
  func selectsChildrenAndForegroundGroupMembers() {
    let leader = ProcessEntry(
      processID: 10,
      parentProcessID: 1,
      processGroupID: 10,
      foregroundProcessGroupID: 20,
      terminalDevice: 5,
      name: "login"
    )
    let foreground = ProcessEntry(
      processID: 20,
      parentProcessID: 10,
      processGroupID: 20,
      foregroundProcessGroupID: 20,
      terminalDevice: 5,
      name: "ssh"
    )
    let otherTerminal = ProcessEntry(
      processID: 30,
      parentProcessID: 10,
      processGroupID: 20,
      foregroundProcessGroupID: 20,
      terminalDevice: 6,
      name: "ssh"
    )
    let table = ProcessTable(entries: [leader, foreground, otherTerminal])

    #expect(table.children(of: 10) == [foreground, otherTerminal])
    #expect(table.foregroundGroup(onTerminalOf: leader) == [foreground])
  }

  @Test
  func resolvesForegroundCommandThroughZmxSessionOwnership() {
    let sessionName = "spt-session"
    let table = ProcessTable(
      entries: [
        ProcessEntry(
          processID: 100,
          parentProcessID: 1,
          processGroupID: 100,
          foregroundProcessGroupID: 100,
          terminalDevice: 5,
          name: "zmx"
        ),
        ProcessEntry(
          processID: 200,
          parentProcessID: 100,
          processGroupID: 200,
          foregroundProcessGroupID: 300,
          terminalDevice: 6,
          name: "zsh"
        ),
        ProcessEntry(
          processID: 300,
          parentProcessID: 200,
          processGroupID: 300,
          foregroundProcessGroupID: 300,
          terminalDevice: 6,
          name: "codex"
        ),
      ]
    )

    let command = table.commandName(
      processGroupID: nil,
      zmxSessionName: sessionName,
      invocation: { processID in
        processID == 100 ? ProcessInvocation(arguments: ["zmx", "attach", sessionName], terminalType: nil) : nil
      }
    )

    #expect(command == "codex")
  }
}
