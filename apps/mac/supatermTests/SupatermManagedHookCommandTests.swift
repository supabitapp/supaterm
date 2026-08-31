import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermManagedHookCommandTests {
  @Test
  func claudeAndPiCommandsStayDirect() {
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .claude)
        == SupatermClaudeHookSettings.command
    )
    #expect(
      SupatermManagedHookCommand.receiveHookCommand(for: .pi)
        == expectedSupatermHookCommand(agent: "pi")
    )
  }

  @Test
  func codexPolicyMatchesCurrentMovedAndShippedCommands() throws {
    let policy = SupatermManagedHookCommand.policy(for: .codex)
    let command = try SupatermCodexHookSettings.command(
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp"
    )
    let movedCommand = try SupatermCodexHookSettings.command(
      cliPath: "/Users/example/Supaterm user's app/Contents/MacOS/sp"
    )

    #expect(policy.matches("  \(command)\n"))
    #expect(policy.matches(movedCommand))
    #expect(policy.matches(expectedSupatermHookCommand(agent: "codex")))
  }

  @Test
  func codexPolicyRejectsNearMatchesAndExtraTokens() throws {
    let cliPath = "/Applications/Supaterm.app/Contents/MacOS/sp"
    let policy = SupatermManagedHookCommand.policy(for: .codex)
    let command = try SupatermCodexHookSettings.command(cliPath: cliPath)
    let prefix = String(command.dropLast(cliPath.count))

    for candidate in [
      command + " extra",
      command.replacingOccurrences(of: "supaterm-codex-hook-v1", with: "supaterm-codex-hook-v2"),
      command.replacingOccurrences(of: "/bin/cat", with: "cat"),
      prefix + "/Applications/Supaterm.app/Contents/MacOS/sp /tmp/sp",
      prefix + "'/Applications/Supaterm.app/Contents/MacOS/sp'",
      prefix + "/Applications/Supaterm.app/Contents/MacOS/../MacOS/sp",
      prefix + "/Applications/Supaterm.app/Contents/MacOS/wasp",
      expectedSupatermHookCommand(agent: "codex") + " || true",
      "echo SUPATERM bridge",
    ] {
      #expect(!policy.matches(candidate), Comment(rawValue: candidate))
    }
  }

  @Test
  func codexCommandDrainsStdinWhenCLIIsMissing() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let cliPath = temporaryDirectory.appendingPathComponent("sp").path

    try runHookCommand(
      SupatermCodexHookSettings.command(cliPath: cliPath),
      environment: ["PATH": "/runtime-path-is-unused"],
      payload: Data(repeating: 0x7b, count: 1024 * 1024)
    )
  }

  @Test
  func codexCommandDrainsStdinAndSwallowsCLIFailure() throws {
    let temporaryDirectory = try makeCommandExecutionTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let executableURL = temporaryDirectory.appendingPathComponent("sp")
    try writeExecutable(at: executableURL, script: "#!/bin/sh\nexit 1\n")

    try runHookCommand(
      SupatermCodexHookSettings.command(cliPath: executableURL.path),
      environment: [:],
      payload: Data(repeating: 0x7b, count: 1024 * 1024)
    )
  }
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
  processEnvironment.removeValue(forKey: "HOME")
  for key in processEnvironment.keys.filter({ $0.hasPrefix("SUPATERM_") }) {
    processEnvironment.removeValue(forKey: key)
  }
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
