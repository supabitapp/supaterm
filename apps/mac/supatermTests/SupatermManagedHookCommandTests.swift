import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

struct SupatermManagedHookCommandTests {
  @Test
  func receiveHookCommandMatchesClaudeSettingsCommand() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .claude)
        == SupatermClaudeHookSettings.command
    )
  }

  @Test
  func receiveHookCommandBuildsPiCommand() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .pi)
        == expectedSupatermHookCommand(agent: "pi")
    )
  }

  @Test
  func managedCommandDetectionMatchesOnlyCanonicalCommands() {
    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        SupatermManagedHookCommand.receiveHookCommand(for: .claude)
      )
    )
    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        "  \(SupatermManagedHookCommand.receiveHookCommand(for: .codex))\n"
      )
    )
    #expect(
      !AgentHookCommandOwnership.isSupatermManagedCommand("echo SUPATERM bridge")
    )
  }

  @Test
  func managedCommandDetectionIncludesLegacyCommands() {
    for agent in SupatermAgentKind.allCases {
      #expect(
        AgentHookCommandOwnership.isSupatermManagedCommand(
          legacySupatermHookCommand(agent: agent.rawValue)
        )
      )
    }
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
        SupatermManagedHookCommand.receiveHookCommand(for: .claude),
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
      SupatermManagedHookCommand.receiveHookCommand(for: .codex),
      environment: [:],
      payload: hookPayload()
    )
  }

  @Test
  func commandDrainsStdinWhenCliPathCannotRun() throws {
    try runHookCommand(
      SupatermManagedHookCommand.receiveHookCommand(for: .codex),
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
      SupatermManagedHookCommand.receiveHookCommand(for: .codex),
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
