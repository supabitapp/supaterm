import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPCommandRuntimeTests {
  @Test
  func terminalStartupPreservesTokens() throws {
    let environment = ["PATH": "/test/bin"]

    #expect(try terminalStartup(script: nil, tokens: [], environment: environment) == nil)
    #expect(
      try terminalStartup(
        script: nil,
        tokens: ["echo", "", "hello world", "bang!", "$(touch nope)"],
        environment: environment
      )
        == .exec(
          ["echo", "", "hello world", "bang!", "$(touch nope)"],
          searchPath: "/test/bin"
        )
    )
  }

  @Test
  func terminalStartupRejectsAnEmptyExecutable() {
    #expect(throws: ValidationError.self) {
      try terminalStartup(script: nil, tokens: [""])
    }
  }

  @Test
  func terminalStartupUsesTheSystemPathWhenTheCallerHasNone() throws {
    #expect(
      try terminalStartup(script: nil, tokens: ["echo"], environment: [:])
        == .exec(["echo"], searchPath: SupatermShellCommand.defaultExecutableSearchPath)
    )
  }

  @Test
  func terminalStartupKeepsScriptsAndArgumentsDistinct() throws {
    #expect(try terminalStartup(script: "echo 1\necho 2", tokens: []) == .shell("echo 1\necho 2"))
    #expect(
      try terminalStartup(
        script: nil,
        tokens: ["echo", "hello world"],
        environment: ["PATH": "/test/bin"]
      )
        == .exec(["echo", "hello world"], searchPath: "/test/bin")
    )

    do {
      _ = try terminalStartup(script: "", tokens: [])
      Issue.record("Expected empty script to throw.")
    } catch {
      #expect(String(describing: error).contains("--script must not be empty."))
    }

    do {
      _ = try terminalStartup(script: "echo 1", tokens: ["echo", "2"])
      Issue.record("Expected script plus tokens to throw.")
    } catch {
      #expect(String(describing: error).contains("--script cannot be used with a trailing command."))
    }
  }

  @Test
  func resolvedWorkingDirectoryExpandsAndNormalizes() throws {
    #expect(try resolvedWorkingDirectory(nil) == nil)

    do {
      _ = try resolvedWorkingDirectory("  ")
      Issue.record("Expected blank working directory to throw.")
    } catch {
      #expect(String(describing: error).contains("--cwd must not be empty."))
    }

    #expect(
      try resolvedWorkingDirectory("~")
        == SupatermWorkingDirectory.normalizedPath(
          FileManager.default.homeDirectoryForCurrentUser
        )
    )

    let currentDirectoryURL = URL(
      fileURLWithPath: FileManager.default.currentDirectoryPath,
      isDirectory: true
    )
    #expect(
      try resolvedWorkingDirectory("sub/dir")
        == SupatermWorkingDirectory.normalizedPath(
          currentDirectoryURL.appendingPathComponent("sub/dir", isDirectory: true)
        )
    )
    #expect(
      try resolvedWorkingDirectory(currentDirectoryURL.path)
        == SupatermWorkingDirectory.normalizedPath(currentDirectoryURL)
    )
    #expect(
      try resolvedWorkingDirectory("sub/./directory/../")
        == "\(SupatermWorkingDirectory.normalizedPath(currentDirectoryURL))/sub"
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

  @Test
  func jsonStringIsCompactAndSorted() throws {
    #expect(try jsonString(["b": 2, "a": 1]) == #"{"a":1,"b":2}"#)
  }

  @Test
  func destructiveConfirmationRequiresInteractiveInput() throws {
    do {
      try confirmDestructiveAction(prompt: "Destroy space 1? [y/N] ", isInteractive: { false })
      Issue.record("Expected non-interactive confirmation to throw.")
    } catch {
      #expect(String(describing: error).contains("Pass -y to confirm."))
    }
  }

  @Test
  func destructiveConfirmationAcceptsYes() throws {
    var prompt = ""

    try confirmDestructiveAction(
      prompt: "Destroy space 1? [y/N] ",
      isInteractive: { true },
      readLine: { "yes" },
      writePrompt: { prompt = $0 }
    )

    #expect(prompt == "Destroy space 1? [y/N] ")
  }

  @Test
  func destructiveConfirmationCancelsByDefault() throws {
    do {
      try confirmDestructiveAction(
        prompt: "Destroy space 1? [y/N] ",
        isInteractive: { true },
        readLine: { "" },
        writePrompt: { _ in }
      )
      Issue.record("Expected blank confirmation to throw.")
    } catch {
      #expect(String(describing: error).contains("Canceled."))
    }
  }
}
