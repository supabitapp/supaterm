import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermAgentHookSocketProtocolTests {
  @Test
  func agentHookRequestRoundTripsTypedPayload() throws {
    let payload = SupatermAgentHookRequest(
      agent: .claude,
      context: SupatermCLIContext(
        surfaceID: UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!,
        tabID: UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
      ),
      event: try ClaudeHookFixtures.event(ClaudeHookFixtures.preToolUse),
      inheritedSessionID: "parent-session",
      processID: 123,
      processStartTimeMicroseconds: 123_000
    )

    let request = try SupatermSocketRequest.agentHook(payload, id: "agent-hook-1")

    #expect(request.method == SupatermSocketMethod.terminalAgentHook)
    #expect(try request.decodeParams(SupatermAgentHookRequest.self) == payload)
  }

  @Test
  func agentHookCandidateRequestAndResponseRoundTrip() throws {
    let context = SupatermCLIContext(
      surfaceID: UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!,
      tabID: UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
    )
    let query = SupatermAgentHookCandidateQuery(
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "session-123",
        source: SupatermCodexRootSessionStart.Source.resume.rawValue,
        transcriptPath: "/tmp/transcript.jsonl"
      ),
      emitterProcessID: 123
    )
    let result = SupatermAgentHookCandidatesResponse(
      candidates: [
        SupatermAgentHookCandidate(
          context: context,
          processID: 456,
          processStartTimeMicroseconds: 456_000,
          forksOwnedSession: true,
          sessionIDMatchesTitle: true,
          workingDirectoryMatches: true,
          ownedSessionID: "session-123"
        )
      ],
      sharedCodexHost: true
    )

    let request = try SupatermSocketRequest.agentHookCandidates(
      query,
      id: "agent-hook-candidates-1"
    )
    let response = try SupatermSocketResponse.ok(
      id: "agent-hook-candidates-1",
      encodableResult: result
    )

    #expect(request.method == SupatermSocketMethod.terminalAgentHookCandidates)
    #expect(try request.decodeParams(SupatermAgentHookCandidateQuery.self) == query)
    #expect(try response.decodeResult(SupatermAgentHookCandidatesResponse.self) == result)
  }

  @Test
  func legacyAgentHookCandidateDefaultsForkLineageToFalse() throws {
    let result = SupatermAgentHookCandidatesResponse(
      candidates: [
        SupatermAgentHookCandidate(
          context: SupatermCLIContext(
            surfaceID: UUID(uuidString: "BA864E81-56B8-4610-B8E1-9E3D0F16DEEF")!,
            tabID: UUID(uuidString: "0FEF397C-128B-4BC7-A31B-1129AFB6B8EE")!
          ),
          processID: 456,
          processStartTimeMicroseconds: 456_000,
          forksOwnedSession: true,
          sessionIDMatchesTitle: true,
          workingDirectoryMatches: true,
          ownedSessionID: "session-123"
        )
      ],
      sharedCodexHost: true
    )
    let response = try SupatermSocketResponse.ok(
      id: "legacy-agent-hook-candidates",
      encodableResult: result
    )
    var responseResult = try #require(response.result)
    var candidates = try #require(responseResult["candidates"]?.arrayValue)
    var candidate = try #require(candidates.first?.objectValue)
    candidate.removeValue(forKey: "forksOwnedSession")
    candidates[0] = .object(candidate)
    responseResult["candidates"] = .array(candidates)
    let legacyResponse = SupatermSocketResponse.ok(
      id: "legacy-agent-hook-candidates",
      result: responseResult
    )

    let decoded = try legacyResponse.decodeResult(SupatermAgentHookCandidatesResponse.self)

    #expect(decoded.candidates.count == 1)
    #expect(decoded.candidates[0].forksOwnedSession == false)
    #expect(decoded.candidates[0].context == result.candidates[0].context)
    #expect(decoded.candidates[0].processID == result.candidates[0].processID)
    #expect(
      decoded.candidates[0].processStartTimeMicroseconds
        == result.candidates[0].processStartTimeMicroseconds
    )
    #expect(decoded.candidates[0].sessionIDMatchesTitle)
    #expect(decoded.candidates[0].workingDirectoryMatches)
    #expect(decoded.candidates[0].ownedSessionID == result.candidates[0].ownedSessionID)
  }
}
