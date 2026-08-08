import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPSSHCommandTests {
  @Test
  func publicRuntimeHelpUsesQualifiedUsageAndOptionOnlyCallsRequireDestination() throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let help = try cli.run(["ssh", "--help"])
    #expect(help.exitCode == 0)
    #expect(help.stdout.contains("USAGE: sp ssh"))

    let missingDestination = try cli.run(["ssh", "--name", "Production"])
    #expect(missingDestination.exitCode == 64)
    #expect(missingDestination.stderr.contains("sp ssh requires one interactive SSH destination."))
  }

  @Test
  func publicParserPreservesLeadingSupatermOptionsAndSSHArguments() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "ssh",
        "--socket", "/tmp/supaterm.sock",
        "--instance=work-mac",
        "--name", "Production",
        "-i", "~/.ssh/work",
        "-o", "ProxyJump=bastion.example.com",
        "-p", "2222",
        "user@example.com",
      ]) as? SP.SSH
    )

    #expect(command.connection.explicitSocketPath == "/tmp/supaterm.sock")
    #expect(command.connection.instance == "work-mac")
    #expect(command.name == "Production")
    #expect(
      command.arguments == [
        "-i", "~/.ssh/work",
        "-o", "ProxyJump=bastion.example.com",
        "-p", "2222",
        "user@example.com",
      ]
    )
  }

  @Test
  func publicParserLeavesEverythingAfterSSHArgumentsUntouched() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "ssh",
        "--name", "Production",
        "-o", "RemoteCommand=--name other",
        "user@example.com",
      ]) as? SP.SSH
    )

    #expect(command.name == "Production")
    #expect(
      command.arguments == [
        "-o", "RemoteCommand=--name other", "user@example.com",
      ]
    )
  }

  @Test
  func internalParserPreservesSSHExecutableAndArgumentsAfterSeparator() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "internal", "ssh", "--term", "xterm-ghostty", "--ssh", "/usr/bin/ssh", "--",
        "-p", "2222", "example.com",
      ]) as? SP.InternalSSH
    )

    #expect(command.invocation.term == "xterm-ghostty")
    #expect(command.invocation.ssh == "/usr/bin/ssh")
    #expect(command.invocation.arguments == ["-p", "2222", "example.com"])

    let session = try #require(
      try SP.parseAsRoot(["internal", "ssh-session", "--", "example.com"])
        as? SP.InternalSSHSession
    )
    #expect(session.invocation.arguments == ["example.com"])
  }

  @Test
  func requestCreatesFocusedAmbientTabAndRenamesReturnedTab() throws {
    let transport = SPSSHTransportStub()
    let context = SupatermCLIContext(
      surfaceID: transport.sourcePaneID,
      tabID: transport.sourceTabID
    )
    let runner = SPSSHCommandRunner(
      transport: transport,
      context: context,
      cliPath: "/Applications/Supaterm Runtime.app/Contents/MacOS/sp",
      shellPath: "/bin/zsh"
    )

    try runner.run(
      arguments: ["-p", "2222", "user@example.com"],
      name: "Production"
    )

    #expect(
      transport.requests.map(\.method) == [
        SupatermSocketMethod.appTree,
        SupatermSocketMethod.terminalNewTab,
        SupatermSocketMethod.terminalRenameTab,
      ]
    )

    let request = try transport.requests[1].decodeParams(SupatermNewTabRequest.self)
    #expect(request.cwd == nil)
    #expect(request.focus)
    #expect(request.target == .pane(transport.sourcePaneID))
    #expect(request.context == context)
    let expectedStartupCommand =
      "/usr/bin/env '/Applications/Supaterm Runtime.app/Contents/MacOS/sp' internal ssh-session -- "
      + "-p 2222 user@example.com; exec /bin/zsh -l"
    #expect(request.startupCommand == expectedStartupCommand)

    let rename = try transport.requests[2].decodeParams(SupatermRenameTabRequest.self)
    #expect(rename.target == SupatermTabTargetRequest(tabID: transport.createdTabID))
    #expect(rename.title == "Production")
  }

  @Test
  func controlRejectsMissingDestinationBeforeConnecting() {
    #expect(throws: ValidationError.self) {
      try SPSSHControl.run(
        arguments: ["-p", "2222"],
        name: nil,
        explicitSocketPath: nil,
        instance: nil,
        environment: [:],
        executablePath: "/usr/bin/sp"
      )
    }
  }

  @Test
  func retryUsesCappedBackoffOnlyForExit255() throws {
    let invocation = SPSSHLauncher.Invocation(
      executablePath: "/usr/bin/ssh",
      arguments: ["/usr/bin/ssh", "example.com"],
      environment: [:]
    )
    var results: [SPSSHProcessTermination] = [
      .exited(255),
      .exited(255),
      .exited(255),
      .exited(255),
      .exited(255),
      .exited(255),
      .exited(0),
    ]
    var launches: [SPSSHLauncher.Invocation] = []
    var delays: [TimeInterval] = []

    try SPSSHSessionRunner.run(
      invocation: invocation,
      launch: {
        launches.append($0)
        return results.removeFirst()
      },
      sleep: { delays.append($0) }
    )

    #expect(launches == Array(repeating: invocation, count: 7))
    #expect(delays == [2, 4, 8, 16, 30, 30])
  }

  @Test(arguments: [
    SPSSHProcessTermination.exited(0),
    SPSSHProcessTermination.exited(1),
    SPSSHProcessTermination.signaled(SIGINT),
  ])
  func retryStopsWithoutSleepingForOtherExits(_ termination: SPSSHProcessTermination) throws {
    let invocation = SPSSHLauncher.Invocation(
      executablePath: "/usr/bin/ssh",
      arguments: ["/usr/bin/ssh", "example.com"],
      environment: [:]
    )
    var launchCount = 0
    var delays: [TimeInterval] = []

    try SPSSHSessionRunner.run(
      invocation: invocation,
      launch: { _ in
        launchCount += 1
        return termination
      },
      sleep: { delays.append($0) }
    )

    #expect(launchCount == 1)
    #expect(delays.isEmpty)
  }

  @Test
  func invocationUsesSSHFromPathAndAddsEnvironmentForwarding() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let binDirectory = temporaryDirectory.appendingPathComponent("bin", isDirectory: true)
    let sshURL = binDirectory.appendingPathComponent("ssh", isDirectory: false)
    try writeExecutable(at: sshURL, script: "#!/bin/sh\nexit 0\n")

    let invocation = try SPSSHLauncher.invocation(
      term: "xterm-ghostty",
      ssh: sshURL.path,
      arguments: [
        "-o", "SetEnv=PRODUCT=custom", "-p", "2222", "example.com",
      ],
      environment: [
        "PATH": binDirectory.path,
        "TERM": "xterm-ghostty",
        "COLORTERM": "truecolor",
        "TERM_PROGRAM": "ghostty",
        "TERM_PROGRAM_VERSION": "1.2.3",
      ]
    )

    let resolvedSSHPath = SPExecutable.standardizedPath(sshURL.path)
    #expect(invocation.executablePath == resolvedSSHPath)
    #expect(
      invocation.arguments == [
        resolvedSSHPath,
        "-o", "SendEnv=COLORTERM",
        "-o", "SendEnv=TERM_PROGRAM",
        "-o", "SendEnv=TERM_PROGRAM_VERSION",
        "-o", "SetEnv=PRODUCT=custom",
        "-p", "2222", "example.com",
      ]
    )
    #expect(invocation.environment["TERM"] == "xterm-ghostty")
    #expect(invocation.environment["COLORTERM"] == "truecolor")
    #expect(invocation.environment["TERM_PROGRAM"] == "ghostty")
    #expect(invocation.environment["TERM_PROGRAM_VERSION"] == "1.2.3")
  }

  @Test
  func invocationDefaultsToCompatibleTermAndDoesNotAddSetEnv() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let sshURL = temporaryDirectory.appendingPathComponent("ssh", isDirectory: false)
    try writeExecutable(at: sshURL, script: "#!/bin/sh\nexit 0\n")
    let command = try #require(
      try SP.parseAsRoot(["internal", "ssh", "--", "example.com"]) as? SP.InternalSSH
    )
    let invocation = try SPSSHLauncher.invocation(
      term: command.invocation.term,
      ssh: command.invocation.ssh,
      arguments: command.invocation.arguments,
      environment: ["PATH": temporaryDirectory.path, "TERM": "xterm-ghostty"]
    )

    #expect(invocation.environment["TERM"] == "xterm-256color")
    #expect(invocation.environment["COLORTERM"] == "truecolor")
    #expect(invocation.arguments.suffix(1) == ["example.com"])
    #expect(!invocation.arguments.contains(where: { $0.contains("SetEnv") }))
  }

  @Test
  func invocationFailsWhenSSHIsMissing() {
    #expect(throws: ValidationError.self) {
      try SPSSHLauncher.invocation(
        term: "xterm-256color",
        ssh: "ssh",
        arguments: ["example.com"],
        environment: ["PATH": "/tmp/does-not-exist"]
      )
    }
  }
}

private final class SPSSHTransportStub: SPSSHTransport {
  let spaceID = UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
  let sourceTabID = UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
  let sourcePaneID = UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
  let createdTabID = UUID(uuidString: "44444444-4444-4444-4444-444444444444")!
  let createdPaneID = UUID(uuidString: "55555555-5555-5555-5555-555555555555")!
  var requests: [SupatermSocketRequest] = []

  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse {
    requests.append(request)
    switch request.method {
    case SupatermSocketMethod.appTree:
      return try .ok(id: request.id, encodableResult: treeSnapshot)
    case SupatermSocketMethod.terminalNewTab:
      return try .ok(id: request.id, encodableResult: newTabResult)
    case SupatermSocketMethod.terminalRenameTab:
      let rename = try request.decodeParams(SupatermRenameTabRequest.self)
      guard let title = rename.title else {
        throw NSError(domain: "SPSSHTransportStub", code: 2)
      }
      return try .ok(
        id: request.id,
        encodableResult: SupatermRenameTabResult(
          isTitleLocked: true,
          target: SupatermTabTarget(
            windowIndex: 1,
            spaceIndex: 1,
            spaceID: spaceID,
            tabIndex: 2,
            tabID: createdTabID,
            title: title
          )
        )
      )
    default:
      throw NSError(domain: "SPSSHTransportStub", code: 1)
    }
  }

  private var treeSnapshot: SupatermTreeSnapshot {
    SupatermTreeSnapshot(
      windows: [
        SupatermTreeSnapshot.Window(
          index: 1,
          isKey: true,
          displayedSpaceID: spaceID,
          spaces: [
            SupatermTreeSnapshot.Space(
              index: 1,
              id: spaceID,
              name: "Work",
              color: .blue,
              isWarm: true,
              rootItems: [
                .tab(
                  SupatermTreeSnapshot.RootTab(
                    isPinned: false,
                    tab: SupatermTreeSnapshot.Tab(
                      id: sourceTabID,
                      title: "shell",
                      isSelected: true,
                      panes: [
                        SupatermTreeSnapshot.Pane(
                          index: 1,
                          id: sourcePaneID,
                          isFocused: true
                        )
                      ]
                    )
                  )
                )
              ]
            )
          ]
        )
      ]
    )
  }

  private var newTabResult: SupatermNewTabResult {
    SupatermNewTabResult(
      isFocused: true,
      isSelectedSpace: true,
      isSelectedTab: true,
      windowIndex: 1,
      spaceIndex: 1,
      spaceID: spaceID,
      tabIndex: 2,
      tabID: createdTabID,
      paneIndex: 1,
      paneID: createdPaneID
    )
  }
}
