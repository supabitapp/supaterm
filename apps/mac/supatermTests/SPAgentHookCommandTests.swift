import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI
@testable import SupatermSocketFeature

struct SPAgentHookCommandTests {
  @Test
  func contextlessCodexSessionStartDeliversToTheOnlyGlobalCandidate() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    cli.environment[SupatermCodexEnvironment.threadIDKey] = "inherited-session"
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    let candidate = SupatermAgentHookCandidate(context: context, processID: 303)
    let firstEndpoint = hookEndpoint(
      name: "first",
      processID: 101,
      environment: cli.environment
    )
    let secondEndpoint = hookEndpoint(
      name: "second",
      processID: 202,
      environment: cli.environment
    )
    let firstLog = SPSocketRequestLog()
    let secondLog = SPSocketRequestLog()
    let firstRuntime = SocketControlRuntime(endpointProvider: { firstEndpoint })
    let secondRuntime = SocketControlRuntime(endpointProvider: { secondEndpoint })
    let firstResponder = try await startHookResponder(
      runtime: firstRuntime,
      endpoint: firstEndpoint,
      log: firstLog,
      candidateProvider: { [candidate] }
    )
    let secondResponder = try await startHookResponder(
      runtime: secondRuntime,
      endpoint: secondEndpoint,
      log: secondLog,
      candidateProvider: { [] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: """
        {
          "hook_event_name": "SessionStart",
          "session_id": "session-1",
          "cwd": "/tmp/workspace",
          "transcript_path": "/tmp/session-1.jsonl"
        }
        """
    )

    firstResponder.cancel()
    secondResponder.cancel()
    await firstRuntime.stop()
    await secondRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    let expectedRequest = SupatermAgentHookRequest(
      agent: .codex,
      context: context,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "session-1",
        transcriptPath: "/tmp/session-1.jsonl"
      ),
      inheritedSessionID: "inherited-session",
      processID: candidate.processID
    )
    let firstRequests = firstLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }
    #expect(firstRequests.count == 1)
    #expect(try firstRequests.first?.decodeParams(SupatermAgentHookRequest.self) == expectedRequest)
    #expect(!secondLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
    #expect(
      firstLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHookCandidates }.count
        == 1
    )
    #expect(
      secondLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHookCandidates }.count
        == 1
    )
  }

  @Test
  func contextlessCodexSessionStartDoesNotDeliverWhenCandidatesAreAmbiguous() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303
    )
    let firstEndpoint = hookEndpoint(name: "first", processID: 101, environment: cli.environment)
    let secondEndpoint = hookEndpoint(name: "second", processID: 202, environment: cli.environment)
    let firstLog = SPSocketRequestLog()
    let secondLog = SPSocketRequestLog()
    let firstRuntime = SocketControlRuntime(endpointProvider: { firstEndpoint })
    let secondRuntime = SocketControlRuntime(endpointProvider: { secondEndpoint })
    let firstResponder = try await startHookResponder(
      runtime: firstRuntime,
      endpoint: firstEndpoint,
      log: firstLog,
      candidateProvider: { [candidate] }
    )
    let secondResponder = try await startHookResponder(
      runtime: secondRuntime,
      endpoint: secondEndpoint,
      log: secondLog,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    firstResponder.cancel()
    secondResponder.cancel()
    await firstRuntime.stop()
    await secondRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(!firstLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
    #expect(!secondLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
  }

  @Test
  func contextlessCodexSessionStartWithSocketSelectorQueriesOnlyThatInstance() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let firstCandidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303
    )
    let secondCandidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 404
    )
    let firstEndpoint = hookEndpoint(name: "first", processID: 101, environment: cli.environment)
    let secondEndpoint = hookEndpoint(name: "second", processID: 202, environment: cli.environment)
    let firstLog = SPSocketRequestLog()
    let secondLog = SPSocketRequestLog()
    let firstRuntime = SocketControlRuntime(endpointProvider: { firstEndpoint })
    let secondRuntime = SocketControlRuntime(endpointProvider: { secondEndpoint })
    let firstResponder = try await startHookResponder(
      runtime: firstRuntime,
      endpoint: firstEndpoint,
      log: firstLog,
      candidateProvider: { [firstCandidate] }
    )
    let secondResponder = try await startHookResponder(
      runtime: secondRuntime,
      endpoint: secondEndpoint,
      log: secondLog,
      candidateProvider: { [secondCandidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--socket", firstEndpoint.path],
      standardInput: codexSessionStartHookJSON
    )

    firstResponder.cancel()
    secondResponder.cancel()
    await firstRuntime.stop()
    await secondRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(firstLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
    #expect(secondLog.requests.isEmpty)
  }

  @Test
  func contextlessCodexSessionStartSucceedsWithoutMutationWhenNoCandidateAppears() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let endpoint = hookEndpoint(name: "empty", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(
      runtime: runtime,
      endpoint: endpoint,
      log: log,
      candidateProvider: { [] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(!log.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
  }

  @Test
  func contextlessCodexSessionStartRetriesUntilAStartedCandidateAppears() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303
    )
    let endpoint = hookEndpoint(name: "delayed", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let attempts = LockedCounter()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(
      runtime: runtime,
      endpoint: endpoint,
      log: log,
      candidateProvider: {
        attempts.increment() > 1 ? [candidate] : []
      }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(attempts.count >= 2)
    #expect(log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
  }

  @Test
  func contextlessCodexSessionStartIgnoresRejectedInstanceWhenAnotherHasTheCandidate() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303
    )
    let rejectingEndpoint = hookEndpoint(name: "rejecting", processID: 101, environment: cli.environment)
    let winningEndpoint = hookEndpoint(name: "winning", processID: 202, environment: cli.environment)
    let rejectingLog = SPSocketRequestLog()
    let winningLog = SPSocketRequestLog()
    let rejectingRuntime = SocketControlRuntime(endpointProvider: { rejectingEndpoint })
    let winningRuntime = SocketControlRuntime(endpointProvider: { winningEndpoint })
    let rejectingResponder = try await startHookResponder(
      runtime: rejectingRuntime,
      endpoint: rejectingEndpoint,
      log: rejectingLog,
      candidateResponse: { request, _ in
        guard request.method == SupatermSocketMethod.terminalAgentHookCandidates else {
          return nil
        }
        return .error(id: request.id, code: "rejected", message: "Not ready")
      }
    )
    let winningResponder = try await startHookResponder(
      runtime: winningRuntime,
      endpoint: winningEndpoint,
      log: winningLog,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    rejectingResponder.cancel()
    winningResponder.cancel()
    await rejectingRuntime.stop()
    await winningRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(!rejectingLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
    #expect(winningLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
  }

  @Test
  func contextlessCodexSessionStartSilentlyIgnoresMalformedCandidateResponse() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303
    )
    let malformedEndpoint = hookEndpoint(name: "malformed", processID: 101, environment: cli.environment)
    let winningEndpoint = hookEndpoint(name: "winning", processID: 202, environment: cli.environment)
    let malformedLog = SPSocketRequestLog()
    let winningLog = SPSocketRequestLog()
    let malformedRuntime = SocketControlRuntime(endpointProvider: { malformedEndpoint })
    let winningRuntime = SocketControlRuntime(endpointProvider: { winningEndpoint })
    let malformedResponder = try await startHookResponder(
      runtime: malformedRuntime,
      endpoint: malformedEndpoint,
      log: malformedLog,
      candidateResponse: { request, _ in
        guard request.method == SupatermSocketMethod.terminalAgentHookCandidates else {
          return nil
        }
        return .ok(id: request.id)
      }
    )
    let winningResponder = try await startHookResponder(
      runtime: winningRuntime,
      endpoint: winningEndpoint,
      log: winningLog,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    malformedResponder.cancel()
    winningResponder.cancel()
    await malformedRuntime.stop()
    await winningRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(!malformedLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
    #expect(winningLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
  }

  @Test
  func nonCodexSessionStartStillDeliversDirectly() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let endpoint = hookEndpoint(name: "direct", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(runtime: runtime, endpoint: endpoint, log: log)

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "claude"],
      standardInput: """
        {
          "hook_event_name": "SessionStart",
          "cwd": "/tmp/workspace"
        }
        """
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
    #expect(!log.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHookCandidates })
  }

  @Test
  func contextfulCodexSessionStartStillDeliversDirectly() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    cli.environment[SupatermCLIEnvironment.surfaceIDKey] = context.surfaceID.uuidString
    cli.environment[SupatermCLIEnvironment.tabIDKey] = context.tabID.uuidString
    let endpoint = hookEndpoint(name: "direct", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(runtime: runtime, endpoint: endpoint, log: log)

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
    #expect(!log.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHookCandidates })
    let request = try #require(
      log.requests.first(where: { $0.method == SupatermSocketMethod.terminalAgentHook })
    )
    #expect(try request.decodeParams(SupatermAgentHookRequest.self).context == context)
  }

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

private func hookEndpoint(
  name: String,
  processID: Int32,
  environment: [String: String]
) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(),
    name: name,
    path: SupatermSocketPath.managedSocketURL(
      instanceName: name,
      processID: processID,
      environment: environment
    ).path,
    pid: processID,
    startedAt: Date(timeIntervalSince1970: TimeInterval(processID))
  )
}

private func startHookResponder(
  runtime: SocketControlRuntime,
  endpoint: SupatermSocketEndpoint,
  log: SPSocketRequestLog,
  candidateProvider: @escaping @Sendable () -> [SupatermAgentHookCandidate] = { [] },
  candidateResponse: (@Sendable (SupatermSocketRequest, SupatermSocketEndpoint) throws -> SupatermSocketResponse?)? =
    nil
) async throws -> Task<Void, Never> {
  try await startSocketResponder(runtime: runtime, endpoint: endpoint) { request, endpoint in
    if request.method == SupatermSocketMethod.systemIdentity {
      return try .ok(id: request.id, encodableResult: endpoint)
    }
    if request.method == SupatermSocketMethod.terminalAgentHookCandidates {
      log.record(request)
      if let candidateResponse {
        return try candidateResponse(request, endpoint)
      }
      return try .ok(
        id: request.id,
        encodableResult: SupatermAgentHookCandidates(candidates: candidateProvider())
      )
    }
    log.record(request)
    return .ok(id: request.id)
  }
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

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}

private let codexSessionStartHookJSON = """
  {
    "hook_event_name": "SessionStart",
    "session_id": "session-1",
    "cwd": "/tmp/workspace",
    "transcript_path": "/tmp/session-1.jsonl"
  }
  """
