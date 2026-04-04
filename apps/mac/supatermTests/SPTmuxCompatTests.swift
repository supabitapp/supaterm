import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPTmuxCompatTests {
  @Test
  func rawConnectionInvocationParsesLeadingConnectionOptions() throws {
    let invocation = try SPRawConnectionInvocation.parse([
      "--socket", "/tmp/supaterm.sock",
      "--instance=work-mac",
      "split-window",
      "-h",
      "-P",
    ])

    #expect(
      invocation.connection
        == .init(
          explicitSocketPath: "/tmp/supaterm.sock",
          instance: "work-mac"
        )
    )
    #expect(invocation.arguments == ["split-window", "-h", "-P"])
  }

  @Test
  func teammateLaunchArgumentsInjectAutoModeOnlyWhenMissing() {
    #expect(
      SPTeammateLauncher.teammateLaunchArguments(commandArgs: ["--resume"])
        == ["--teammate-mode", "auto", "--resume"]
    )
    #expect(
      SPTeammateLauncher.teammateLaunchArguments(commandArgs: [
        "--teammate-mode", "manual", "--resume",
      ])
        == ["--teammate-mode", "manual", "--resume"]
    )
  }

  @Test
  func configuredProcessInjectsSocketTmuxEnvironmentAndShimPath() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let binDirectory = temporaryDirectory.appendingPathComponent("bin", isDirectory: true)
    let claudeURL = binDirectory.appendingPathComponent("claude", isDirectory: false)
    let spURL = binDirectory.appendingPathComponent("sp", isDirectory: false)

    try writeExecutable(at: claudeURL, script: "#!/bin/sh\nexit 0\n")
    try writeExecutable(at: spURL, script: "#!/bin/sh\nexit 0\n")

    let context = SPTeammateLauncher.FocusedContext(
      windowIndex: 1,
      spaceIndex: 2,
      spaceID: UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!,
      tabIndex: 3,
      tabID: UUID(uuidString: "6BFC889D-2D0F-4675-924E-B15A6A4E372B")!,
      paneIndex: 4,
      paneID: UUID(uuidString: "2B8B3A57-D7F8-4EF7-930F-46B1F7281B2A")!
    )

    let process = try SPTeammateLauncher.configuredProcess(
      arguments: ["--resume"],
      socketPath: "/tmp/supaterm.sock",
      focusedContext: context,
      environment: [
        "PATH": binDirectory.path,
        "TERM_PROGRAM": "Apple_Terminal",
      ],
      executablePath: claudeURL.path,
      cliExecutablePath: spURL.path,
      homeDirectoryURL: temporaryDirectory
    )

    let environment = try #require(process.environment)
    let shimDirectory =
      temporaryDirectory
      .appendingPathComponent(".supaterm", isDirectory: true)
      .appendingPathComponent("tmux", isDirectory: true)
      .appendingPathComponent("shims", isDirectory: true)
    let shimURL = shimDirectory.appendingPathComponent("tmux", isDirectory: false)

    #expect(process.executableURL?.path == claudeURL.path)
    #expect(process.arguments == ["--teammate-mode", "auto", "--resume"])
    #expect(environment[SupatermCLIEnvironment.socketPathKey] == "/tmp/supaterm.sock")
    #expect(environment[SupatermCLIEnvironment.surfaceIDKey] == context.paneID.uuidString)
    #expect(environment[SupatermCLIEnvironment.tabIDKey] == context.tabID.uuidString)
    #expect(environment["CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS"] == "1")
    #expect(environment["TERM"] == "screen-256color")
    #expect(environment["TERM_PROGRAM"] == nil)
    #expect(environment["TMUX_PANE"] == "%2b8b3a57-d7f8-4ef7-930f-46b1f7281b2a")
    #expect(environment["PATH"]?.split(separator: ":").first.map(String.init) == shimDirectory.path)
    #expect(FileManager.default.isExecutableFile(atPath: shimURL.path))
  }

  @Test
  func tmuxResizeDirectionRequiresDirectionalFlag() {
    #expect(tmuxResizeDirection(flags: []) == nil)
    #expect(tmuxResizeDirection(flags: ["-L"]) == .left)
    #expect(tmuxResizeDirection(flags: ["-U"]) == .up)
    #expect(tmuxResizeDirection(flags: ["-D"]) == .down)
    #expect(tmuxResizeDirection(flags: ["-R"]) == .right)
    #expect(tmuxResizeDirection(flags: ["-x"]) == nil)
    #expect(tmuxResizeDirection(flags: ["-y"]) == nil)
  }

  @Test
  func tmuxPaneAxisMatchesSplitDirection() {
    #expect(tmuxPaneAxis(for: .left) == .horizontal)
    #expect(tmuxPaneAxis(for: .right) == .horizontal)
    #expect(tmuxPaneAxis(for: .up) == .vertical)
    #expect(tmuxPaneAxis(for: .down) == .vertical)
  }

  @Test
  func tmuxSendKeysTextConvertsSpecialKeysToControlCharacters() {
    #expect(
      tmuxSendKeysText(
        from: ["echo hello", "Enter", "c-c", "Space", "tail", "Tab"],
        literal: false
      )
        == "echo hello\r\u{03} tail\t"
    )
  }
}
