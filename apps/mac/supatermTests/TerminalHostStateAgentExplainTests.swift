import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport
@testable import supaterm

@MainActor
struct TerminalHostStateAgentExplainTests {
  private struct HostFixture {
    let host: TerminalHostState
    let surfaceID: UUID
    let target: SupatermPaneTarget
  }

  @Test
  func nativeOnlyAuthorityReportsItsSingleExactProcess() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .pi(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: .disabled
    )

    #expect(applied)
    #expect(result.mode == .native)
    #expect(result.status == .nativeAuthority)
    #expect(result.agent?.id == "pi")
    #expect(result.process?.processID == identity.processID)
    #expect(result.process?.startTimeMicroseconds == identity.startTimeMicroseconds)
    #expect(result.rules == nil)
    #expect(result.ruleID == nil)
  }

  @Test
  func newerAuthorityFreeCandidateStaysCurrentWithoutTerminalState() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .codex(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )
    host.agentStateStore.restore([
      authorityFreeSnapshot(
        agent: .claude,
        surfaceID: surfaceID,
        revision: 10_000
      )
    ])

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: .disabled
    )
    let resolved = host.resolvedAgentState(for: surfaceID)

    #expect(applied)
    #expect(resolved.instances.map(\.activity.identity.id) == ["claude", "codex"])
    #expect(resolved.currentInstance?.activity.identity.id == "claude")
    #expect(resolved.currentNativeCandidate?.presentation.agent == .claude)
    #expect(result.agent?.id == "claude")
    #expect(result.status == .resolved)
    #expect(result.process == nil)
  }

  @Test
  func exactNativeAuthorityExplainsTheSameNativeWinnerAsTheUI() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let appliedNative = host.applyTestAgentActivity(
      .pi(.running, detail: "Private native detail"),
      for: surfaceID,
      sessionID: "private-session",
      processID: identity.processID
    )
    let appliedTerminal = host.applyAgentDetection(
      observation(
        agentID: "other-agent",
        displayName: "Other Agent",
        processIdentity: identity,
        phase: .needsInput
      ),
      for: surfaceID
    )
    let explanation = trace(
      origin: .embedded,
      status: .nativeAuthority,
      processIdentity: identity,
      agent: AgentDetectionAgentIdentity(id: "other-agent", displayName: "Other Agent"),
      matchedPhase: .needsInput,
      matchedRuleID: "private-rule"
    )

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: explanation
    )

    #expect(appliedNative)
    #expect(appliedTerminal)
    #expect(result.mode == .native)
    #expect(result.status == .nativeAuthority)
    #expect(
      result.agent
        == SupatermAgentExplainResult.Agent(
          id: "pi",
          displayName: "Pi",
          phase: .running
        )
    )
    #expect(
      result.process
        == SupatermAgentExplainResult.Process(
          processID: identity.processID,
          startTimeMicroseconds: identity.startTimeMicroseconds
        )
    )
    #expect(result.rules == SupatermAgentExplainResult.Rules(source: .embedded, generation: 7))
    #expect(result.ruleID == nil)
  }

  @Test
  func controllerProofSelectsNativeAuthorityBeforeTerminalStatePublishes() async throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .pi(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )
    host.agentStateStore.restore([
      authorityFreeSnapshot(
        agent: .claude,
        surfaceID: surfaceID,
        revision: 10_000
      )
    ])
    let controller = try detectionController(
      host: host,
      surfaceID: surfaceID,
      processIdentity: identity
    )
    host.agentDetectionController = controller

    await controller.tick(now: .now)

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: controller.explanation(for: surfaceID)
    )
    #expect(applied)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.resolvedAgentState(for: surfaceID).currentInstance?.activity.identity.id == "pi")
    #expect(result.agent?.id == "pi")
    #expect(result.status == .nativeAuthority)
    #expect(result.process?.processID == identity.processID)
  }

  @Test
  func controllerProofKeepsNativeAuthorityAfterTerminalStateClears() async throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let controller = try detectionController(
      host: host,
      surfaceID: surfaceID,
      processIdentity: identity
    )
    host.agentDetectionController = controller
    let now = ContinuousClock.now

    await controller.tick(now: now)
    let observation = try #require(terminalObservation(in: host, for: surfaceID))
    let applied = host.applyTestAgentActivity(
      .pi(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )
    host.agentStateStore.restore([
      authorityFreeSnapshot(
        agent: .claude,
        surfaceID: surfaceID,
        revision: 10_000
      )
    ])

    await controller.tick(now: now.advanced(by: .milliseconds(300)))

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: controller.explanation(for: surfaceID)
    )
    #expect(observation.processIdentity == identity)
    #expect(applied)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.resolvedAgentState(for: surfaceID).currentInstance?.activity.identity.id == "pi")
    #expect(result.agent?.id == "pi")
    #expect(result.status == .nativeAuthority)
    #expect(result.process?.processID == identity.processID)
  }

  @Test
  func fallbackUsesOnlyThePublishedObservationAndMatchingRuleSource() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    let detection = observation(
      agentID: "custom-agent",
      displayName: "Custom Agent",
      processIdentity: identity,
      phase: .needsInput
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)
    let explanation = trace(
      origin: .embedded,
      status: .detected,
      processIdentity: identity,
      agent: detection.agent,
      matchedPhase: .needsInput,
      matchedRuleID: detection.ruleID
    )

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: explanation
    )

    #expect(applied)
    #expect(result.mode == .fallback)
    #expect(result.status == .resolved)
    #expect(result.rules == SupatermAgentExplainResult.Rules(source: .embedded, generation: 7))
    #expect(
      result.agent
        == SupatermAgentExplainResult.Agent(
          id: "custom-agent",
          displayName: "Custom Agent",
          phase: .needsInput
        )
    )
    #expect(
      result.process
        == SupatermAgentExplainResult.Process(
          processID: 42,
          startTimeMicroseconds: 123
        )
    )
    #expect(result.ruleID == "prompt-state")
  }

  @Test
  func fallbackOmitsRulesWhenTheTraceGenerationDoesNotMatch() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)
    let explanation = trace(origin: .embedded, generation: 8, status: .detected)

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: explanation
    )

    #expect(applied)
    #expect(result.mode == .fallback)
    #expect(result.rules == nil)
  }

  @Test
  func fallbackReportsTheCurrentSettlingStatus() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 123)
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)

    let result = host.agentDetectionExplain(
      target: fixture.target,
      surfaceID: surfaceID,
      explanation: trace(origin: .embedded, status: .noRuleMatchOrSettling)
    )

    #expect(applied)
    #expect(result.mode == .fallback)
    #expect(result.status == .noRuleMatchOrSettling)
  }

  @Test
  func unresolvedTraceMapsEveryControllerStatusWithoutInventingData() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let cases: [(TerminalAgentDetectionExplanation.Status, SupatermAgentExplainResult.Status)] = [
      (.detected, .waiting),
      (.disabled, .detectionDisabled),
      (.nativeAuthority, .nativeAuthority),
      (.noForegroundProcess, .noForegroundProcess),
      (.noRuleMatchOrSettling, .noRuleMatchOrSettling),
      (.protectedOrUnreadableScreen, .screenUnavailable),
      (.unrecognizedProcess, .unrecognizedProcess),
      (.waiting, .waiting),
    ]

    for (controllerStatus, resultStatus) in cases {
      let result = host.agentDetectionExplain(
        target: target,
        surfaceID: surfaceID,
        explanation: trace(status: controllerStatus)
      )
      #expect(result.mode == .none)
      #expect(result.status == resultStatus)
      #expect(result.agent == nil)
      #expect(result.process == nil)
      #expect(result.ruleID == nil)
    }
  }

  @Test
  func unresolvedProofIncludesTypedTraceWithoutTerminalContent() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let target = fixture.target
    let identity = TerminalAgentProcessIdentity(processID: 55, startTimeMicroseconds: 456)
    let explanation = trace(
      origin: .embedded,
      status: .noRuleMatchOrSettling,
      processIdentity: identity,
      agent: AgentDetectionAgentIdentity(id: "custom-agent", displayName: "Custom Agent"),
      matchedPhase: .idle,
      matchedRuleID: "idle-state"
    )

    let result = host.agentDetectionExplain(
      target: target,
      surfaceID: surfaceID,
      explanation: explanation
    )
    let data = try JSONEncoder().encode(result)
    let object = try #require(
      JSONSerialization.jsonObject(with: data) as? [String: Any]
    )

    #expect(result.mode == .none)
    #expect(result.status == .noRuleMatchOrSettling)
    #expect(result.agent?.phase == .idle)
    #expect(result.process?.processID == 55)
    #expect(result.ruleID == "idle-state")
    #expect(
      Set(object.keys)
        == ["target", "mode", "status", "rules", "agent", "process", "ruleID"]
    )
    #expect(Set(try #require(object["rules"] as? [String: Any]).keys) == ["source", "generation"])
    #expect(Set(try #require(object["agent"] as? [String: Any]).keys) == ["id", "displayName", "phase"])
    #expect(
      Set(try #require(object["process"] as? [String: Any]).keys)
        == ["processID", "startTimeMicroseconds"]
    )
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
    origin: AgentDetectionRuleOrigin? = nil,
    generation: UInt64? = 7,
    status: TerminalAgentDetectionExplanation.Status,
    processIdentity: TerminalAgentProcessIdentity? = nil,
    agent: AgentDetectionAgentIdentity? = nil,
    matchedPhase: AgentActivityPhase? = nil,
    matchedRuleID: String? = nil
  ) -> TerminalAgentDetectionExplanation {
    TerminalAgentDetectionExplanation(
      origin: origin,
      generation: generation,
      status: status,
      processIdentity: processIdentity,
      agent: agent,
      matchedPhase: matchedPhase,
      matchedRuleID: matchedRuleID,
      publishedPhase: nil,
      publishedRuleID: nil
    )
  }

  private func authorityFreeSnapshot(
    agent: SupatermAgentKind,
    surfaceID: UUID,
    revision: Int
  ) -> TerminalAgentStateSnapshot {
    TerminalAgentStateSnapshot(
      agent: agent,
      sessionID: "authority-free-\(agent.rawValue)",
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

  private func detectionController(
    host: TerminalHostState,
    surfaceID: UUID,
    processIdentity: TerminalAgentProcessIdentity
  ) throws -> TerminalAgentDetectionController {
    let surface = try #require(host.surfaces[surfaceID])
    let processGroupID: Int32 = 11
    let generation: UInt64 = 7
    let snapshot = AgentDetectionRuleSnapshot(
      origin: .embedded,
      generation: generation,
      processManifests: [
        AgentDetectionProcessManifest(
          agentID: "codex",
          processes: [AgentDetectionProcessRule(executable: "codex")]
        )
      ]
    )
    let match = AgentDetectionProcessMatch(
      agentID: "codex",
      processIdentity: processIdentity
    )
    let evaluation = AgentDetectionEvaluation(
      identity: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
      generation: generation,
      match: AgentDetectionMatch(result: .running, ruleID: "running")
    )
    return TerminalAgentDetectionController(
      rules: TerminalAgentDetectionRuleAccess(
        snapshot: { snapshot },
        evaluate: { agentID, _ in agentID == "codex" ? evaluation : nil }
      ),
      sampler: TerminalAgentDetectionSampler(
        matches: { processGroupIDs, _ in
          processGroupIDs.contains(processGroupID) ? [processGroupID: match] : [:]
        },
        current: { identities in
          identities.contains(processIdentity) ? [processIdentity] : []
        }
      ),
      host: TerminalAgentDetectionHostAccess(
        surfaces: { [weak surface] in
          guard let surface else { return [] }
          return [
            TerminalAgentDetectionSurfaceSnapshot(
              key: TerminalAgentDetectionSurfaceKey(
                id: surfaceID,
                instance: ObjectIdentifier(surface),
                foregroundProcessGroupID: processGroupID
              )
            )
          ]
        },
        capture: { _ in
          TerminalAgentDetectionCapture(screen: "running", oscTitle: "")
        },
        nativeAuthority: { [weak host] surfaceID in
          host?.nativeAgentDetectionCandidates(for: surfaceID).reduce(into: []) {
            $0.formUnion($1.phaseAuthorityProcessIdentities)
          } ?? []
        },
        observation: { [weak host] surfaceID in
          host?.agentDetectionStore.observation(for: surfaceID)
        },
        apply: { [weak host] observation, surfaceID in
          host?.applyAgentDetection(observation, for: surfaceID) == true
        },
        clear: { [weak host] surfaceID in
          _ = host?.clearAgentDetection(for: surfaceID)
        }
      )
    )
  }

  private func hostFixture() throws -> HostFixture {
    initializeGhosttyForTests()
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let tabID = try #require(host.selectedTabID?.rawValue)
    return HostFixture(
      host: host,
      surfaceID: surfaceID,
      target: SupatermPaneTarget(
        windowIndex: 1,
        spaceIndex: 1,
        spaceID: host.displayedSpaceID.rawValue,
        tabIndex: 1,
        tabID: tabID,
        paneIndex: 1,
        paneID: surfaceID
      )
    )
  }
}
