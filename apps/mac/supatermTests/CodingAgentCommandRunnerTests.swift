import Darwin
import Foundation
import Testing

@testable import SupatermSupport

struct CodingAgentCommandRunnerTests {
  @Test
  func prefersCurrentUserShell() {
    #expect(
      CodingAgentCommandRunner.loginShellURL(
        environment: ["SHELL": "/bin/zsh"],
        currentUserShellPath: "/bin/sh"
      ).path == "/bin/sh"
    )
  }

  @Test
  func fallsBackToEnvironmentShell() {
    #expect(
      CodingAgentCommandRunner.loginShellURL(
        environment: ["SHELL": "/bin/bash"],
        currentUserShellPath: nil
      ).path == "/bin/bash"
    )
  }

  @Test
  func timesOut() {
    #expect(throws: CodingAgentCommandRunnerError.timedOut) {
      try CodingAgentCommandRunner.run(
        arguments: ["-c", "sleep 10"],
        timeout: 0.01
      )
    }
  }

  @Test
  func timeoutTerminatesDescendants() throws {
    let processIDURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-command-pid-\(UUID().uuidString)")
    defer { try? FileManager.default.removeItem(at: processIDURL) }
    let command =
      "/bin/sh -c 'printf \"%d\\n\" \"$$\" > \"$1\"; sleep 10' "
      + "supaterm-command-runner-test '\(processIDURL.path)' & wait"

    #expect(throws: CodingAgentCommandRunnerError.timedOut) {
      try CodingAgentCommandRunner.run(
        arguments: ["-c", command],
        timeout: 1
      )
    }

    let processIDString = try String(contentsOf: processIDURL, encoding: .utf8)
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let processID = try #require(pid_t(processIDString))
    errno = 0
    let result = Darwin.kill(processID, 0)
    let error = errno

    #expect(result == -1)
    #expect(error == ESRCH)
  }

  @Test
  func closesUnmappedFileDescriptors() throws {
    let sentinel = Pipe()
    defer {
      try? sentinel.fileHandleForReading.close()
      try? sentinel.fileHandleForWriting.close()
    }
    let descriptor = sentinel.fileHandleForReading.fileDescriptor
    try #require(fcntl(descriptor, F_SETFD, 0) == 0)

    let result = try CodingAgentCommandRunner.run(
      arguments: ["-c", "[ ! -e /dev/fd/\(descriptor) ]"]
    )

    #expect(result.status == 0)
  }

  @Test
  func capturesOutputWithoutPipeBackpressure() throws {
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
  func captureIsPrivate() throws {
    let result = try CodingAgentCommandRunner.run(
      arguments: [
        "-c",
        "/usr/bin/perl -e '@s = stat(STDOUT); printf \"%o\\n\", $s[2] & 0777'",
      ]
    )

    #expect(result.standardOutput == "600")
  }
}
