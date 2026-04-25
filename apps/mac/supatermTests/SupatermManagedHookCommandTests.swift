import Foundation
import Testing

@testable import SupatermCLIShared

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
  func installArgumentsMatchAgentInstallHookInterface() {
    #expect(
      SupatermManagedHookCommand.installArguments(for: .codex)
        == ["agent", "install-hook", "codex"]
    )
  }

  @Test
  func managedCommandDetectionMatchesAnySupatermCommand() {
    let managedCommand = "echo SUPATERM bridge"
    let unmanagedCommand = "echo terminal bridge"

    #expect(
      AgentHookCommandOwnership.isSupatermManagedCommand(
        SupatermManagedHookCommand.receiveHookCommand(for: .claude)
      )
    )
    #expect(AgentHookCommandOwnership.isSupatermManagedCommand(managedCommand))
    #expect(
      !AgentHookCommandOwnership.isSupatermManagedCommand(unmanagedCommand)
    )
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

private func runHookCommand(
  _ command: String,
  environment: [String: String],
  payload: Data
) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: "/bin/sh")
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
