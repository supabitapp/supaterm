import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI
@testable import SupatermSocketFeature

struct SPAgentHookManagementCommandTests {
  @Test
  func hookCommandsSendOneRequestPerSupportedAgentAndStaySilent() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        let health: CodingAgentIntegrationHealth =
          request.method == SupatermSocketMethod.appHooksInstall ? .healthy : .absent
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: health)
        )
      },
      run: { endpoint in
        for command in ["install-hooks", "remove-hooks"] {
          let result = try cli.run(["agent", command, "--socket", endpoint.path])

          #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
        }
      }
    )

    #expect(
      log.requests.map(\.method) == Array(
        repeating: SupatermSocketMethod.appHooksInstall,
        count: SupatermAgentKind.allCases.count
      )
        + Array(
          repeating: SupatermSocketMethod.appHooksRemove,
          count: SupatermAgentKind.allCases.count
        )
    )
    #expect(
      try log.requests.map { try $0.decodeParams(SupatermAgentHookTargetRequest.self).agent }
        == SupatermAgentKind.allCases + SupatermAgentKind.allCases
    )
  }

  @Test
  func hookCommandsWaitForLongRunningInstallers() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let replyCount = LockedCounter()

    try await withSocketRuntime(
      replying: { request, _ in
        if replyCount.increment() == 1 {
          try await Task.sleep(for: .seconds(6))
        }
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: .healthy)
        )
      },
      run: { endpoint in
        let result = try cli.run([
          "agent", "install-hooks", "--socket", endpoint.path,
        ])

        #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )
  }

  @Test
  func hookCommandsTryEveryAgentAndReportEveryFailure() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        if payload.agent == .pi {
          return try .ok(
            id: request.id,
            encodableResult: SupatermAgentHookHealth(agent: .pi, health: .healthy)
          )
        }
        return .error(
          id: request.id,
          code: "internal_error",
          message: "Invalid \(payload.agent.notificationTitle) configuration."
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(result.stderr.contains("Claude Code: Invalid Claude Code configuration."))
        #expect(result.stderr.contains("Codex: Invalid Codex configuration."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func installHooksFailsWhenEveryAgentIsUnavailable() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: .unavailable)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(result.stderr.contains("No supported coding agent was detected."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func installHooksSucceedsWhenAtLeastOneAgentIsHealthy() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    try await withSocketRuntime(
      replying: { request, _ in
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        let health: CodingAgentIntegrationHealth =
          payload.agent == .claude ? .unavailable : .healthy
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: health)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )
  }

  @Test
  func installHooksReportsUnhealthySuccessResponses() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: .partial)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(
          result.stderr.contains("Claude Code: Expected a healthy hook integration, got partial."))
        #expect(result.stderr.contains("Codex: Expected a healthy hook integration, got partial."))
        #expect(result.stderr.contains("Pi: Expected a healthy hook integration, got partial."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func hookCommandsRejectMismatchedResponseAgentsAndContinue() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        let responseAgent: SupatermAgentKind = payload.agent == .codex ? .claude : payload.agent
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: responseAgent, health: .healthy)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(
          result.stderr.contains("Codex: Supaterm returned status for Claude Code, expected Codex.")
        )
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func hookCommandsReportMalformedSuccessResponsesAndContinue() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return .ok(id: request.id)
      },
      run: { endpoint in
        let result = try cli.run(["agent", "install-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(result.stderr.contains("Claude Code:"))
        #expect(result.stderr.contains("Codex:"))
        #expect(result.stderr.contains("Pi:"))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func removeHooksSucceedsWhenAgentsAreAbsentOrUnavailable() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    try await withSocketRuntime(
      replying: { request, _ in
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        let health: CodingAgentIntegrationHealth = payload.agent == .pi ? .unavailable : .absent
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: health)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "remove-hooks", "--socket", endpoint.path])

        #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
      }
    )
  }

  @Test
  func removeHooksReportsUnhealthySuccessResponses() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: .healthy)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "remove-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(result.stderr.contains("Claude Code: Expected hooks to be absent, got healthy."))
        #expect(result.stderr.contains("Codex: Expected hooks to be absent, got healthy."))
        #expect(result.stderr.contains("Pi: Expected hooks to be absent, got healthy."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func removeHooksReportsEveryFailureAndContinues() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        if payload.agent == .pi {
          return try .ok(
            id: request.id,
            encodableResult: SupatermAgentHookHealth(agent: .pi, health: .absent)
          )
        }
        return .error(
          id: request.id,
          code: "internal_error",
          message: "Could not remove \(payload.agent.notificationTitle) hooks."
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "remove-hooks", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(result.stdout.isEmpty)
        #expect(result.stderr.contains("Claude Code: Could not remove Claude Code hooks."))
        #expect(result.stderr.contains("Codex: Could not remove Codex hooks."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test(arguments: [["agent", "install-hooks"], ["agent", "remove-hooks"]])
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

  @Test
  func agentCommandPrintsHelp() throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    let result = try cli.run(["agent"])

    #expect(result.exitCode == 0)
    #expect(result.stdout.contains("USAGE:"))
    #expect(result.stderr.isEmpty)
  }
}
