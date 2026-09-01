import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalHostStateAgentDebugSnapshotTests {
  private struct HostFixture {
    let host: TerminalHostState
    let surfaceID: UUID
  }

  @Test
  func newerSessionCandidateStaysCurrentWithoutTerminalState() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    host.agentStateStore.restore([
      sessionSnapshot(
        agent: .codex,
        surfaceID: surfaceID,
        revision: 1
      ),
      sessionSnapshot(
        agent: .claude,
        surfaceID: surfaceID,
        revision: 10_000
      ),
    ])

    let result = host.debugAgentSnapshot(
      for: surfaceID,
      explanation: trace(status: .unrecognizedProcess)
    )
    let resolved = host.resolvedAgentState(for: surfaceID)

    #expect(resolved.instances.map(\.activity.identity.id) == ["claude", "codex"])
    #expect(resolved.currentInstance?.activity.identity.id == "claude")
    #expect(resolved.currentNativeCandidate?.presentation.agent == .claude)
    #expect(result.agent?.kind == .claude)
    #expect(result.agent?.phaseSource == .native)
    #expect(result.status == .unrecognizedProcess)
    #expect(result.agent?.process == nil)
  }

  @Test
  func screenObservationReportsItsRuleProcessAndSource() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    let detection = observation(processIdentity: identity, phase: .needsInput)
    let applied = host.applyAgentDetection(detection, for: surfaceID)
    let explanation = trace(
      status: .detected,
      processIdentity: identity,
      agent: detection.agent,
      matchedRuleID: detection.ruleID
    )

    let result = host.debugAgentSnapshot(for: surfaceID, explanation: explanation)

    #expect(applied)
    #expect(result.status == .resolved)
    #expect(result.agent?.kind == .codex)
    #expect(result.agent?.phase == .needsInput)
    #expect(result.agent?.phaseSource == .screen)
    #expect(result.agent?.sessionID == nil)
    #expect(result.agent?.ruleID == "prompt-state")
    #expect(
      result.agent?.process
        == SupatermAppDebugSnapshot.AgentProcess(
          processID: 42,
          startTimeMicroseconds: 123
        )
    )
  }

  @Test
  func screenObservationReportsTheCurrentSettlingStatus() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)

    let result = host.debugAgentSnapshot(
      for: surfaceID,
      explanation: trace(status: .noRuleMatchOrSettling)
    )

    #expect(applied)
    #expect(result.agent?.phaseSource == .screen)
    #expect(result.status == .noRuleMatchOrSettling)
  }

  @Test
  func unknownScreenAgentIDReportsStatusWithoutAnAgent() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let detection = observation(
      agentID: "custom-agent",
      displayName: "Custom Agent",
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)

    let result = host.debugAgentSnapshot(
      for: surfaceID,
      explanation: trace(status: .detected)
    )

    #expect(applied)
    #expect(result.agent == nil)
    #expect(result.status == .resolved)
  }

  @Test
  func unresolvedTraceMapsEveryControllerStatusWithoutInventingData() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let cases: [(TerminalAgentDetectionExplanation.Status, SupatermAppDebugSnapshot.AgentDetectionStatus)] = [
      (.detected, .waiting),
      (.disabled, .detectionDisabled),
      (.noForegroundProcess, .noForegroundProcess),
      (.noRuleMatchOrSettling, .noRuleMatchOrSettling),
      (.protectedOrUnreadableScreen, .screenUnavailable),
      (.unrecognizedProcess, .unrecognizedProcess),
      (.waiting, .waiting),
    ]

    for (controllerStatus, resultStatus) in cases {
      let result = host.debugAgentSnapshot(
        for: surfaceID,
        explanation: trace(status: controllerStatus)
      )
      #expect(result.status == resultStatus)
      #expect(result.agent == nil)
    }
  }

  private func observation(
    agentID: String = "codex",
    displayName: String = "Codex",
    processIdentity: TerminalAgentProcessIdentity,
    phase: AgentActivityPhase = .running
  ) -> TerminalAgentDetectionObservation {
    TerminalAgentDetectionObservation(
      agent: AgentDetectionAgentIdentity(id: agentID, displayName: displayName),
      phase: phase,
      processIdentity: processIdentity,
      ruleID: "prompt-state",
      generation: 7,
      sequence: 1
    )
  }

  private func trace(
    generation: UInt64? = 7,
    status: TerminalAgentDetectionExplanation.Status,
    processIdentity: TerminalAgentProcessIdentity? = nil,
    agent: AgentDetectionAgentIdentity? = nil,
    matchedRuleID: String? = nil
  ) -> TerminalAgentDetectionExplanation {
    TerminalAgentDetectionExplanation(
      generation: generation,
      status: status,
      processIdentity: processIdentity,
      agent: agent,
      matchedRuleID: matchedRuleID,
      publishedPhase: nil,
      publishedRuleID: nil
    )
  }

  private func sessionSnapshot(
    agent: SupatermAgentKind,
    surfaceID: UUID,
    revision: Int
  ) -> TerminalAgentStateSnapshot {
    TerminalAgentStateSnapshot(
      agent: agent,
      sessionID: "session-\(agent.rawValue)",
      surfaceID: surfaceID,
      processes: [],
      turnLifecycle: .active(nil),
      phase: .needsInput,
      detail: nil,
      attentionRequestID: nil,
      latestResponse: nil,
      isActionable: false,
      progressRows: [],
      activeChildren: [],
      hasPendingBackgroundWork: false,
      isForeground: true,
      revision: revision,
      workingDirectoryPath: nil
    )
  }

  private func hostFixture() throws -> HostFixture {
    initializeGhosttyForTests()
    let host = TerminalHostState.test()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    return HostFixture(host: host, surfaceID: surfaceID)
  }
}
