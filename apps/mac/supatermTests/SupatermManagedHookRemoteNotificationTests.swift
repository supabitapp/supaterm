import Foundation
import Testing

@testable import SupatermCLIShared

struct ManagedHookRemoteNotificationTests {
  @Test
  func remoteCommandEmitsOSC777ForNotificationPayload() throws {
    let result = try runReceiveHookCommand(
      for: .claude,
      input: ClaudeHookFixtures.notification,
      environment: ["SSH_CONNECTION": "remote 1 2"]
    )

    #expect(result.status == 0)
    #expect(result.standardError.isEmpty)
    #expect(
      result.standardOutput
        == "\u{001B}]777;notify;Needs input;Claude needs your attention\u{0007}"
    )
  }

  @Test
  func remoteCommandUsesAssistantMessageAndAgentTitleForStopEvent() throws {
    let result = try runReceiveHookCommand(
      for: .codex,
      input: CodexHookFixtures.stop,
      environment: ["SSH_TTY": "/dev/ttys001"]
    )

    #expect(result.status == 0)
    #expect(result.standardError.isEmpty)
    #expect(result.standardOutput == "\u{001B}]777;notify;Codex;Done.\u{0007}")
  }

  @Test
  func remoteCommandSanitizesControlCharactersAndDelimiters() throws {
    let input = """
      {
        "hook_event_name": "Notification",
        "title": "  Needs;\\u001b  input\\n",
        "message": "Build;\\u0007\\nfinished\\tsoon"
      }
      """
    let result = try runReceiveHookCommand(
      for: .claude,
      input: input,
      environment: ["SUPATERM_REMOTE_NOTIFICATIONS": "1"]
    )

    #expect(result.status == 0)
    #expect(result.standardError.isEmpty)
    #expect(
      result.standardOutput
        == "\u{001B}]777;notify;Needs input;Build finished soon\u{0007}"
    )
  }

  @Test
  func remoteCommandSkipsNonNotificationHooks() throws {
    let result = try runReceiveHookCommand(
      for: .codex,
      input: CodexHookFixtures.preToolUse,
      environment: ["SSH_CONNECTION": "remote 1 2"]
    )

    #expect(result.status == 0)
    #expect(result.standardError.isEmpty)
    #expect(result.standardOutput.isEmpty)
  }

  @Test
  func localCommandWinsWhenSocketPathIsPresent() throws {
    let directoryURL = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: directoryURL) }

    let argsURL = directoryURL.appendingPathComponent("args.txt", isDirectory: false)
    let stdinURL = directoryURL.appendingPathComponent("stdin.json", isDirectory: false)
    let cliURL = directoryURL.appendingPathComponent("bin/sp", isDirectory: false)
    try writeExecutable(
      at: cliURL,
      script: """
        #!/bin/sh
        printf '%s' "$*" > "\(argsURL.path)"
        cat > "\(stdinURL.path)"
        """
    )

    let result = try runReceiveHookCommand(
      for: .claude,
      input: ClaudeHookFixtures.notification,
      environment: [
        "SSH_CONNECTION": "remote 1 2",
        "SUPATERM_CLI_PATH": cliURL.path,
        "SUPATERM_SOCKET_PATH": "/tmp/supaterm.sock",
      ]
    )

    #expect(result.status == 0)
    #expect(result.standardError.isEmpty)
    #expect(result.standardOutput.isEmpty)
    #expect(try String(contentsOf: argsURL, encoding: .utf8) == "agent receive-agent-hook --agent claude")
    #expect(
      try String(contentsOf: stdinURL, encoding: .utf8)
        .contains(#""hook_event_name": "Notification""#)
    )
  }
}

private func runReceiveHookCommand(
  for agent: SupatermAgentKind,
  input: String,
  environment: [String: String]
) throws -> CommandExecutionResult {
  try runExecutable(
    at: URL(fileURLWithPath: "/bin/sh", isDirectory: false),
    arguments: ["-c", SupatermManagedHookCommand.receiveHookCommand(for: agent)],
    environment: environment,
    standardInput: input
  )
}
