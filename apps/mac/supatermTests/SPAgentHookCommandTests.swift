import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookCommandTests {
  @Test
  func aggregateCommandsSendOneRequestPerSupportedAgent() async throws {
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
        let setup = try cli.run(["agent", "setup", "--socket", endpoint.path])
        let remove = try cli.run(["agent", "remove-hooks", "--socket", endpoint.path])

        #expect(
          setup
            == SPCLIResult(
              exitCode: 0,
              stdout: expectedSetupOutput(states: ["ready", "ready", "ready"]),
              stderr: ""
            )
        )
        #expect(remove == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
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
  func setupWaitsForLongRunningInstallersAndFlushesProgress() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let replyCount = LockedCounter()
    let firstRequestOutput = LockedString()
    let outputURL = cli.rootURL.appendingPathComponent("stdout", isDirectory: false)

    try await withSocketRuntime(
      replying: { request, _ in
        if replyCount.increment() == 1 {
          firstRequestOutput.set(
            try #require(
              String(bytes: try Data(contentsOf: outputURL), encoding: .utf8)
            )
          )
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
          "agent", "setup", "--socket", endpoint.path,
        ])

        #expect(
          result
            == SPCLIResult(
              exitCode: 0,
              stdout: expectedSetupOutput(states: ["ready", "ready", "ready"]),
              stderr: ""
            )
        )
      }
    )

    #expect(firstRequestOutput.get() == "Setting up Claude Code...\n")
  }

  @Test
  func setupTriesEveryAgentAndReportsEveryFailure() async throws {
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
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(
          result.stdout
            == expectedSetupOutput(states: ["failed", "failed", "ready"])
        )
        #expect(result.stderr.contains("Claude Code: Invalid Claude Code configuration."))
        #expect(result.stderr.contains("Codex: Invalid Codex configuration."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func setupFailsWhenEveryAgentIsUnavailable() async throws {
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
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(
          result.stdout
            == expectedSetupOutput(states: ["not detected", "not detected", "not detected"])
        )
        #expect(result.stderr.contains("No supported coding agent was detected."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func setupSucceedsWhenAtLeastOneAgentIsHealthy() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }

    try await withSocketRuntime(
      replying: { request, _ in
        let payload = try request.decodeParams(SupatermAgentHookTargetRequest.self)
        let health: CodingAgentIntegrationHealth = payload.agent == .claude ? .unavailable : .healthy
        return try .ok(
          id: request.id,
          encodableResult: SupatermAgentHookHealth(agent: payload.agent, health: health)
        )
      },
      run: { endpoint in
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(
          result
            == SPCLIResult(
              exitCode: 0,
              stdout: expectedSetupOutput(states: ["not detected", "ready", "ready"]),
              stderr: ""
            )
        )
      }
    )
  }

  @Test
  func setupReportsUnhealthySuccessResponses() async throws {
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
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(
          result.stdout
            == expectedSetupOutput(states: ["failed", "failed", "failed"])
        )
        #expect(result.stderr.contains("Claude Code: Expected a healthy hook integration, got partial."))
        #expect(result.stderr.contains("Codex: Expected a healthy hook integration, got partial."))
        #expect(result.stderr.contains("Pi: Expected a healthy hook integration, got partial."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func setupRejectsMismatchedResponseAgentsAndContinues() async throws {
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
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(
          result.stdout
            == expectedSetupOutput(states: ["ready", "failed", "ready"])
        )
        #expect(result.stderr.contains("Codex: Supaterm returned status for Claude Code, expected Codex."))
      }
    )

    #expect(log.requests.count == SupatermAgentKind.allCases.count)
  }

  @Test
  func setupReportsMalformedSuccessResponsesAndContinues() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return .ok(id: request.id)
      },
      run: { endpoint in
        let result = try cli.run(["agent", "setup", "--socket", endpoint.path])

        #expect(result.exitCode == 64)
        #expect(
          result.stdout
            == expectedSetupOutput(states: ["failed", "failed", "failed"])
        )
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

  @Test(arguments: [["agent", "setup"], ["agent", "remove-hooks"]])
  func aggregateCommandsFailWithoutAReachableInstance(arguments: [String]) throws {
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

private func expectedSetupOutput(states: [String]) -> String {
  zip(SupatermAgentKind.allCases, states)
    .map { agent, state in
      "Setting up \(agent.notificationTitle)...\n\(agent.notificationTitle): \(state)"
    }
    .joined(separator: "\n") + "\n"
}

nonisolated private final class LockedCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func increment() -> Int {
    lock.lock()
    defer { lock.unlock() }
    value += 1
    return value
  }
}

nonisolated private final class LockedString: @unchecked Sendable {
  private let lock = NSLock()
  private var value = ""

  func get() -> String {
    lock.lock()
    defer { lock.unlock() }
    return value
  }

  func set(_ value: String) {
    lock.lock()
    defer { lock.unlock() }
    self.value = value
  }
}
