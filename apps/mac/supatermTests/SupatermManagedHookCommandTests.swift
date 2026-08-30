import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

struct SupatermManagedHookCommandTests {
  @Test
  func receiveHookCommandMatchesClaudeSettingsCommand() {
    #expect(
      SupatermManagedHookCommand.policy(for: .claude).command
        == SupatermClaudeHookSettings.command
    )
  }

  @Test
  func receiveHookCommandBuildsPiCommand() {
    #expect(
      SupatermManagedHookCommand.policy(for: .pi).command
        == expectedSupatermHookCommand(agent: "pi")
    )
  }

  @Test
  func receiveHookCommandUsesCurrentCodexBridgePath() {
    #expect(
      SupatermManagedHookCommand.policy(for: .codex).command
        == SupatermCodexHookSettings.command(
          homeDirectoryURL: FileManager.default.homeDirectoryForCurrentUser
        )
    )
  }

  @Test
  func managedCommandDetectionMatchesOnlyCanonicalCommands() {
    #expect(
      SupatermManagedHookCommand.policy(for: .claude).matches(
        SupatermManagedHookCommand.policy(for: .claude).command
      )
    )
    #expect(
      SupatermManagedHookCommand.policy(for: .codex).matches(
        "  \(SupatermManagedHookCommand.policy(for: .codex).command)\n"
      )
    )
    #expect(
      SupatermAgentKind.allCases.allSatisfy {
        !SupatermManagedHookCommand.policy(for: $0).matches("echo SUPATERM bridge")
      }
    )
  }

  @Test
  func managedCommandDetectionIncludesLegacyCommands() {
    for agent in SupatermAgentKind.allCases {
      #expect(
        SupatermManagedHookCommand.policy(for: agent).matches(
          legacySupatermHookCommand(agent: agent.rawValue)
        )
      )
    }
    #expect(
      SupatermManagedHookCommand.policy(for: .codex).matches(
        #"exec /bin/sh -c '/bin/sh "$HOME/.codex/supaterm-agent-state.sh" "$PPID" || cat >/dev/null || true'"#
      )
    )
  }

  @Test
  func managedCommandDetectionAcceptsInstalledCodexCommand() {
    let policy = SupatermManagedHookCommand.policy(
      for: .codex,
      homeDirectoryURL: URL(fileURLWithPath: "/tmp/isolated-home", isDirectory: true)
    )

    #expect(policy.matches(policy.command))
    #expect(!SupatermManagedHookCommand.policy(for: .codex).matches(policy.command))
  }

  @Test
  func commandForwardsHookThroughInstalledShells() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let executableURL = temporaryDirectory.appendingPathComponent("sp", isDirectory: false)
    let argumentsURL = temporaryDirectory.appendingPathComponent("arguments", isDirectory: false)
    let inputURL = temporaryDirectory.appendingPathComponent("input", isDirectory: false)
    try writeExecutable(
      at: executableURL,
      script: "#!/bin/sh\nprintf '%s\\n' \"$@\" > \"$HOOK_ARGUMENTS_PATH\"\ncat > \"$HOOK_INPUT_PATH\"\n"
    )
    let payload = Data(#"{"hook_event_name":"SessionStart"}"#.utf8)

    for shellPath in ["/bin/sh", "/bin/bash", "/bin/zsh", "/opt/homebrew/bin/fish"]
    where FileManager.default.isExecutableFile(atPath: shellPath) {
      try runHookCommand(
        SupatermManagedHookCommand.policy(for: .claude).command,
        shellPath: shellPath,
        environment: [
          "HOOK_ARGUMENTS_PATH": argumentsURL.path,
          "HOOK_INPUT_PATH": inputURL.path,
          "SUPATERM_CLI_PATH": executableURL.path,
        ],
        payload: payload
      )

      #expect(
        try String(contentsOf: argumentsURL, encoding: .utf8).split(separator: "\n").map(String.init)
          == [
            "agent", "receive-agent-hook", "--agent", "claude", "--pid", String(getpid()),
          ],
        Comment(rawValue: shellPath)
      )
      #expect(try Data(contentsOf: inputURL) == payload, Comment(rawValue: shellPath))
    }
  }

  @Test
  func commandDrainsStdinWithoutCliPath() throws {
    try runHookCommand(
      SupatermManagedHookCommand.policy(for: .codex).command,
      environment: [:],
      payload: hookPayload()
    )
  }

  @Test
  func codexCommandDrainsStdinWithoutBridge() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    try runHookCommand(
      SupatermCodexHookSettings.command(homeDirectoryURL: temporaryDirectory),
      environment: [:],
      payload: Data(#"{"hook_event_name":"SessionStart"}"#.utf8)
    )
  }

  @Test
  func commandDrainsStdinWhenCliPathCannotRun() throws {
    try runHookCommand(
      SupatermManagedHookCommand.policy(for: .codex).command,
      environment: ["SUPATERM_CLI_PATH": "/tmp/supaterm-missing-sp"],
      payload: hookPayload()
    )
  }

  @Test
  func commandDrainsStdinWhenCliExitsBeforeReading() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }

    let executableURL = temporaryDirectory.appendingPathComponent("sp", isDirectory: false)
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 1\n")

    try runHookCommand(
      SupatermManagedHookCommand.policy(for: .codex).command,
      environment: ["SUPATERM_CLI_PATH": executableURL.path],
      payload: hookPayload()
    )
  }
}

private func hookPayload() -> Data {
  Data(repeating: 0x7b, count: 1024 * 1024)
}

func runHookCommand(
  _ command: String,
  shellPath: String = "/bin/sh",
  environment: [String: String],
  payload: Data
) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: shellPath)
  process.arguments = ["-c", command]

  var processEnvironment = ProcessInfo.processInfo.environment
  processEnvironment.removeValue(forKey: "SUPATERM_CLI_PATH")
  for (key, value) in environment {
    processEnvironment[key] = value
  }
  process.environment = processEnvironment

  let stdin = Pipe()
  let stdout = Pipe()
  let stderr = Pipe()
  process.standardInput = stdin
  process.standardOutput = stdout
  process.standardError = stderr

  try process.run()
  try stdin.fileHandleForWriting.write(contentsOf: payload)
  try stdin.fileHandleForWriting.close()
  process.waitUntilExit()

  #expect(process.terminationStatus == 0)
}
