import ArgumentParser
import Foundation
import Testing

@testable import SPCLI

struct SPSSHCommandTests {
  @Test
  func parserPreservesSSHArgumentsAfterSeparator() throws {
    let command = try #require(
      try SP.parseAsRoot([
        "ssh", "--term", "xterm-ghostty", "--", "-p", "2222", "example.com", "echo hi",
      ]) as? SP.SSH
    )

    #expect(command.term == "xterm-ghostty")
    #expect(command.arguments == ["-p", "2222", "example.com", "echo hi"])
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
    let command = try #require(try SP.parseAsRoot(["ssh", "--", "example.com"]) as? SP.SSH)
    let invocation = try SPSSHLauncher.invocation(
      term: command.term,
      arguments: command.arguments,
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
        arguments: ["example.com"],
        environment: ["PATH": "/tmp/does-not-exist"]
      )
    }
  }
}
