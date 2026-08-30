import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI
@testable import SupatermSocketFeature

struct SPAgentHookCommandTests {
  @Test
  func contextlessCodexSessionStartUsesTitleOwnerAcrossInstances() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    cli.environment[SupatermCodexEnvironment.threadIDKey] = "outer-session"
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    let titleOwner = agentHookCandidate(
      context: context,
      processID: 303,
      sessionIDMatchesTitle: true,
      processMatch: .different,
      workingDirectoryMatch: .different
    )
    let processOwner = agentHookCandidate(
      processID: 404,
      processMatch: .matching,
      workingDirectoryMatch: .exact
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
      candidateProvider: { [titleOwner] }
    )
    let secondResponder = try await startHookResponder(
      runtime: secondRuntime,
      endpoint: secondEndpoint,
      log: secondLog,
      candidateProvider: { [processOwner] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--pid", "404"],
      standardInput: codexSessionStartHookJSON
    )

    firstResponder.cancel()
    secondResponder.cancel()
    await firstRuntime.stop()
    await secondRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    let request = try #require(
      firstLog.requests.first { $0.method == SupatermSocketMethod.terminalAgentHook }
    )
    let hook = try request.decodeParams(SupatermAgentHookRequest.self)
    #expect(hook.context == context)
    #expect(hook.inheritedSessionID == nil)
    #expect(!secondLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
  }

  @Test
  func contextlessCodexSessionStartPreservesNestedSessionOwnership() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    cli.environment[SupatermCodexEnvironment.threadIDKey] = "outer-session"
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    let titleOwner = agentHookCandidate(
      context: context,
      processID: 303,
      sessionIDMatchesTitle: true,
      processMatch: .matching,
      workingDirectoryMatch: .exact
    )
    let endpoint = hookEndpoint(name: "current", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(
      runtime: runtime,
      endpoint: endpoint,
      log: log,
      candidateProvider: { [titleOwner] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--pid", "303"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    let request = try #require(
      log.requests.first { $0.method == SupatermSocketMethod.terminalAgentHook }
    )
    let hook = try request.decodeParams(SupatermAgentHookRequest.self)
    #expect(hook.context == context)
    #expect(hook.inheritedSessionID == "outer-session")
  }

  @Test
  func contextlessCodexSessionTitleOwnerIgnoresUnsupportedInstances() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let titleOwner = agentHookCandidate(
      processID: 303,
      sessionIDMatchesTitle: true,
      processMatch: .different,
      workingDirectoryMatch: .exact
    )
    let currentEndpoint = hookEndpoint(
      name: "current",
      processID: 101,
      environment: cli.environment
    )
    let oldEndpoint = hookEndpoint(
      name: "old",
      processID: 202,
      environment: cli.environment
    )
    let currentLog = SPSocketRequestLog()
    let oldLog = SPSocketRequestLog()
    let currentRuntime = SocketControlRuntime(endpointProvider: { currentEndpoint })
    let oldRuntime = SocketControlRuntime(endpointProvider: { oldEndpoint })
    let currentResponder = try await startHookResponder(
      runtime: currentRuntime,
      endpoint: currentEndpoint,
      log: currentLog,
      candidateProvider: { [titleOwner] }
    )
    let oldResponder = try await startHookResponder(
      runtime: oldRuntime,
      endpoint: oldEndpoint,
      log: oldLog,
      candidateResponse: { request, _ in
        guard request.method == SupatermSocketMethod.terminalAgentHookCandidates else {
          return nil
        }
        return .error(
          id: request.id,
          code: "method_not_found",
          message: "Unknown method"
        )
      }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--pid", "404"],
      standardInput: codexSessionStartHookJSON
    )

    currentResponder.cancel()
    oldResponder.cancel()
    await currentRuntime.stop()
    await oldRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(
      currentLog.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1
    )
    #expect(!oldLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
  }

  @Test
  func contextlessCodexSessionStartDeliversToEmitterProcessAcrossInstances() async throws {
    var cli = try SPCLIHarness()
    defer { cli.remove() }
    cli.environment[SupatermCodexEnvironment.threadIDKey] = "inherited-session"
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    let candidate = SupatermAgentHookCandidate(
      context: context,
      processID: 303,
      processMatch: .matching,
      workingDirectoryMatch: .different
    )
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
      ["agent", "receive-agent-hook", "--agent", "codex", "--pid", "303"],
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
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
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
  func contextlessCodexSessionStartDeliversToTheOnlyGlobalFallbackCandidate() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .unknown
    )
    let endpoint = hookEndpoint(name: "fallback", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(
      runtime: runtime,
      endpoint: endpoint,
      log: log,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHook }.count == 1)
    #expect(
      log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHookCandidates }.count
        > 1
    )
  }

  @Test
  func contextlessCodexSessionStartFallsBackWhenEmitterProcessIsUnavailable() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    let candidate = SupatermAgentHookCandidate(
      context: context,
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
    )
    let endpoint = hookEndpoint(name: "unavailable-emitter", processID: 101, environment: cli.environment)
    let log = SPSocketRequestLog()
    let runtime = SocketControlRuntime(endpointProvider: { endpoint })
    let responder = try await startHookResponder(
      runtime: runtime,
      endpoint: endpoint,
      log: log,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex", "--pid", "404"],
      standardInput: codexSessionStartHookJSON
    )

    responder.cancel()
    await runtime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(
      log.requests.filter { $0.method == SupatermSocketMethod.terminalAgentHookCandidates }.count
        > 1
    )
    let request = try #require(
      log.requests.first { $0.method == SupatermSocketMethod.terminalAgentHook }
    )
    let hook = try request.decodeParams(SupatermAgentHookRequest.self)
    #expect(hook.context == context)
    #expect(hook.processID == candidate.processID)
  }

  @Test
  func contextlessCodexSessionStartWithSocketSelectorQueriesOnlyThatInstance() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let firstCandidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
    )
    let secondCandidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 404,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
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
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
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
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
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
  func contextlessCodexSessionStartRejectsFallbackWhenAnInstanceCannotAnswer() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = agentHookCandidate(processID: 303, workingDirectoryMatch: .unknown)
    let rejectingEndpoint = hookEndpoint(name: "rejecting", processID: 101, environment: cli.environment)
    let fallbackEndpoint = hookEndpoint(name: "fallback", processID: 202, environment: cli.environment)
    let rejectingLog = SPSocketRequestLog()
    let fallbackLog = SPSocketRequestLog()
    let rejectingRuntime = SocketControlRuntime(endpointProvider: { rejectingEndpoint })
    let fallbackRuntime = SocketControlRuntime(endpointProvider: { fallbackEndpoint })
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
    let fallbackResponder = try await startHookResponder(
      runtime: fallbackRuntime,
      endpoint: fallbackEndpoint,
      log: fallbackLog,
      candidateProvider: { [candidate] }
    )

    let result = try cli.run(
      ["agent", "receive-agent-hook", "--agent", "codex"],
      standardInput: codexSessionStartHookJSON
    )

    rejectingResponder.cancel()
    fallbackResponder.cancel()
    await rejectingRuntime.stop()
    await fallbackRuntime.stop()
    #expect(result == SPCLIResult(exitCode: 0, stdout: "", stderr: ""))
    #expect(!rejectingLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
    #expect(!fallbackLog.requests.contains { $0.method == SupatermSocketMethod.terminalAgentHook })
  }

  @Test
  func contextlessCodexSessionStartSilentlyIgnoresMalformedCandidateResponse() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let candidate = SupatermAgentHookCandidate(
      context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
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

private func agentHookCandidate(
  context: SupatermCLIContext = SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
  processID: Int32,
  sessionIDMatchesTitle: Bool = false,
  processMatch: SupatermAgentHookProcessMatch = .unknown,
  workingDirectoryMatch: SupatermAgentHookWorkingDirectoryMatch
) -> SupatermAgentHookCandidate {
  SupatermAgentHookCandidate(
    context: context,
    processID: processID,
    sessionIDMatchesTitle: sessionIDMatchesTitle,
    processMatch: processMatch,
    workingDirectoryMatch: workingDirectoryMatch
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

private let codexSessionStartHookJSON = """
  {
    "hook_event_name": "SessionStart",
    "session_id": "session-1",
    "cwd": "/tmp/workspace",
    "transcript_path": "/tmp/session-1.jsonl"
  }
  """
