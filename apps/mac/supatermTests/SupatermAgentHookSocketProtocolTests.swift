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
      process: .detected(
        SupatermAgentProcessIdentity(
          processID: 123,
          startTimeMicroseconds: 123_000
        )
      )
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
      sessionID: "session-123",
      cwd: "/tmp/workspace",
      emitterProcessID: 123
    )
    let result = SupatermAgentHookCandidatesResponse(
      candidates: [
        SupatermAgentHookCandidate(
          context: context,
          processIdentity: SupatermAgentProcessIdentity(
            processID: 456,
            startTimeMicroseconds: 456_000
          ),
          forkParentSessionID: "019c8ad3-4601-70d9-b980-311e16d7a44c",
          ownedSessionMatchesProcess: true,
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
}
