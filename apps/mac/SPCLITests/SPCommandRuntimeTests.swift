import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPCommandRuntimeTests {
  @Test
  func shellCommandInputEscapesTokens() {
    #expect(shellCommandInput([]) == nil)
    #expect(
      shellCommandInput(["echo", "hello world"])
        == [
          SupatermShellCommand.escapedToken("echo"),
          SupatermShellCommand.escapedToken("hello world"),
        ].joined(separator: " ")
    )
  }

  @Test
  func startupCommandPrefersScript() throws {
    #expect(try startupCommand(script: "echo 1\necho 2", tokens: []) == "echo 1\necho 2")
    #expect(try startupCommand(script: nil, tokens: ["echo", "hello world"]) == "echo 'hello world'")

    do {
      _ = try startupCommand(script: "", tokens: [])
      Issue.record("Expected empty script to throw.")
    } catch {
      #expect(String(describing: error).contains("--script must not be empty."))
    }

    do {
      try validateStartupCommand(script: "echo 1", tokens: ["echo", "2"])
      Issue.record("Expected script plus tokens to throw.")
    } catch {
      #expect(String(describing: error).contains("--script cannot be used with a trailing command."))
    }
  }

  @Test
  func resolvedWorkingDirectoryExpandsAndResolves() throws {
    #expect(try resolvedWorkingDirectory(nil) == nil)

    do {
      _ = try resolvedWorkingDirectory("  ")
      Issue.record("Expected blank working directory to throw.")
    } catch {
      #expect(String(describing: error).contains("--cwd must not be empty."))
    }

    #expect(
      try resolvedWorkingDirectory("~")
        == FileManager.default.homeDirectoryForCurrentUser.standardizedFileURL.path
    )

    let currentDirectoryURL = URL(
      fileURLWithPath: FileManager.default.currentDirectoryPath,
      isDirectory: true
    )
    #expect(
      try resolvedWorkingDirectory("sub/dir")
        == currentDirectoryURL
        .appendingPathComponent("sub/dir", isDirectory: true)
        .standardizedFileURL
        .path
    )
    #expect(
      try resolvedWorkingDirectory(currentDirectoryURL.path)
        == currentDirectoryURL.standardizedFileURL.path
    )
  }

  @Test
  func outputOptionsModeAndValidation() throws {
    guard case .human = try SPOutputOptions.parse([]).mode else {
      Issue.record("Expected default output mode to be human.")
      return
    }
    guard case .json = try SPOutputOptions.parse(["--json"]).mode else {
      Issue.record("Expected --json output mode.")
      return
    }
    guard case .plain = try SPOutputOptions.parse(["--plain"]).mode else {
      Issue.record("Expected --plain output mode.")
      return
    }

    do {
      _ = try SPOutputOptions.parse(["--json", "--plain"])
      Issue.record("Expected --json and --plain to conflict.")
    } catch {
      #expect(String(describing: error).contains("--json and --plain cannot be used together."))
    }
  }
}
