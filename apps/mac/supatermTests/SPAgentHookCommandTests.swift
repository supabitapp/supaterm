import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookCommandTests {
  @Test
  func hookCommandsSendOneRequestPerAgentAndStaySilent() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: .claude, health: .healthy)
        )
      },
      run: { endpoint in
        for arguments in [
          ["agent", "install-hook", "claude"],
          ["agent", "install-hook", "codex"],
          ["agent", "remove-hook", "claude"],
          ["agent", "remove-hook", "codex"],
        ] {
          let result = try cli.run(arguments + ["--socket", endpoint.path])

          #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
        }
      }
    )

    #expect(
      log.requests.map(\.method) == [
        SupatermSocketMethod.appHooksInstall,
        SupatermSocketMethod.appHooksInstall,
        SupatermSocketMethod.appHooksRemove,
        SupatermSocketMethod.appHooksRemove,
      ]
    )
    #expect(
      try log.requests.map { try jsonString($0.params) } == [
        #"{"agent":"claude"}"#,
        #"{"agent":"codex"}"#,
        #"{"agent":"claude"}"#,
        #"{"agent":"codex"}"#,
      ]
    )
  }

  @Test
  func hookCommandsWaitForLongRunningInstallers() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    try await withSocketRuntime(
      replying: { request, _ in
        try await Task.sleep(for: .seconds(6))
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: .codex, health: .healthy)
        )
      },
      run: { endpoint in
        let result = try cli.run([
          "agent", "install-hook", "codex", "--socket", endpoint.path,
        ])

        #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )
  }

  @Test
  func installHooksInstallsClaudeThenCodex() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: .claude, health: .healthy)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )

    #expect(
      log.requests.map(\.method) == [
        SupatermSocketMethod.appHooksInstall,
        SupatermSocketMethod.appHooksInstall,
      ]
    )
    #expect(
      try log.requests.map { try jsonString($0.params) } == [
        #"{"agent":"claude"}"#,
        #"{"agent":"codex"}"#,
      ]
    )
  }

  @Test
  func installHooksStopsAtTheFirstFailingAgent() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return .error(
          id: request.id,
          code: "internal_error",
          message: "Claude settings must be valid JSON before Supaterm can install hooks."
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(
          result.stderr.hasPrefix(
            "Error: Claude settings must be valid JSON before Supaterm can install hooks.\n"
          )
        )
      }
    )

    #expect(log.requests.count == 1)
  }

  @Test
  func hookCommandFailuresReportTheServerMessage() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    try await withSocketRuntime(
      replying: { request, _ in
        .error(
          id: request.id,
          code: "internal_error",
          message: "Codex settings must be valid TOML before Supaterm can install hooks."
        )
      },
      run: { endpoint in
        for arguments in [
          ["agent", "install-hook", "codex"],
          ["agent", "remove-hook", "codex"],
        ] {
          let result = try cli.run(arguments + ["--socket", endpoint.path])

          #expect(result.exitCode == 64)
          #expect(result.stdout.isEmpty)
          #expect(
            result.stderr.hasPrefix(
              "Error: Codex settings must be valid TOML before Supaterm can install hooks.\n"
            )
          )
        }
      }
    )
  }

  @Test(
    arguments: [
      ["agent", "install-hooks"],
      ["agent", "install-hook", "claude"],
      ["agent", "install-hook", "codex"],
      ["agent", "remove-hook", "claude"],
      ["agent", "remove-hook", "codex"],
    ]
  )
  func hookCommandsFailWithoutAReachableInstance(arguments: [String]) throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let result = try cli.run(arguments)

    #expect(result.exitCode == 64)
    #expect(result.stdout.isEmpty)
    #expect(
      result.stderr == """
        Error: No reachable Supaterm instance was found.
        Usage: sp <subcommand>
          See 'sp --help' for more information.

        """
    )
    #expect(!FileManager.default.fileExists(atPath: cli.claudeSettingsURL.path))
  }

  @Test(arguments: [["agent", "install-hook"], ["agent", "remove-hook"], ["agent"]])
  func agentHookParentCommandsPrintHelp(arguments: [String]) throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let result = try cli.run(arguments)

    #expect(result.exitCode == 0)
    #expect(result.stdout.contains("USAGE:"))
    #expect(result.stderr.isEmpty)
  }
}
