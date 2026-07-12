import Foundation
import Testing

@testable import SupatermCLIShared

extension CodexSettingsInstallerTests {
  @Test
  func commandRunnerPrefersCurrentUserShell() {
    #expect(
      CodingAgentCommandRunner.loginShellURL(
        environment: ["SHELL": "/bin/zsh"],
        currentUserShellPath: "/opt/homebrew/bin/fish"
      ).path == "/opt/homebrew/bin/fish"
    )
  }

  @Test
  func commandRunnerFallsBackToEnvironmentShell() {
    #expect(
      CodingAgentCommandRunner.loginShellURL(
        environment: ["SHELL": "/bin/bash"],
        currentUserShellPath: nil
      ).path == "/bin/bash"
    )
  }

  @Test
  func enableHooksCommandArgumentsUseInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.enableHooksCommandArguments()
        == ["-l", "-i", "-c", "codex features enable hooks"]
    )
  }

  @Test
  func versionCommandUsesInteractiveLoginShell() {
    #expect(
      CodexSettingsInstaller.versionCommandArguments()
        == ["-l", "-i", "-c", "codex --version"]
    )
  }

  @Test
  func commandRunnerTimesOut() {
    #expect(throws: CodingAgentCommandRunnerError.timedOut) {
      try CodingAgentCommandRunner.run(
        arguments: ["-c", "sleep 10"],
        timeout: 0.01
      )
    }
  }

  @Test
  func commandRunnerCapturesOutputWithoutPipeBackpressure() throws {
    let result = try CodingAgentCommandRunner.run(
      arguments: [
        "-c",
        "dd if=/dev/zero bs=131072 count=1 2>/dev/null; dd if=/dev/zero bs=131072 count=1 1>&2 2>/dev/null",
      ],
      timeout: 5
    )

    #expect(result.status == 0)
    #expect(result.standardOutput.utf8.count == 131_072)
    #expect(result.standardError.utf8.count == 131_072)
  }

  @Test
  func commandRunnerCaptureIsPrivate() throws {
    let result = try CodingAgentCommandRunner.run(
      arguments: [
        "-c",
        "/usr/bin/perl -e '@s = stat(STDOUT); printf \"%o\\n\", $s[2] & 0777'",
      ]
    )

    #expect(result.standardOutput == "600")
  }
}
