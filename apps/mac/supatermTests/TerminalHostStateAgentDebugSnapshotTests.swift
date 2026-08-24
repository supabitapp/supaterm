import Darwin
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
  func nativeOnlyAuthorityReportsItsSingleExactProcess() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .pi(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )

    let result = host.debugAgentSnapshot(for: surfaceID, explanation: .disabled)

    #expect(applied)
    #expect(result.status == .nativeAuthority)
    #expect(result.agent?.kind == .pi)
    #expect(result.agent?.phaseSource == .native)
    #expect(result.agent?.sessionID == "native-session")
    #expect(result.agent?.process?.processID == identity.processID)
    #expect(result.agent?.process?.startTimeMicroseconds == identity.startTimeMicroseconds)
    #expect(result.agent?.ruleID == nil)
  }

  @Test
  func newerAuthorityFreeCandidateStaysCurrentWithoutTerminalState() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    host.agentStateStore.restore([
      authorityFreeSnapshot(
        agent: .codex,
        surfaceID: surfaceID,
        revision: 1
      ),
      authorityFreeSnapshot(
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
  func exactNativeAuthorityReportsTheSameNativeWinnerAsTheUI() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let appliedNative = host.applyTestAgentActivity(
      .pi(.running, detail: "Private native detail"),
      for: surfaceID,
      sessionID: "private-session",
      processID: identity.processID
    )
    let appliedTerminal = host.applyAgentDetection(
      observation(
        agentID: "codex",
        displayName: "Codex",
        processIdentity: identity,
        phase: .needsInput
      ),
      for: surfaceID
    )
    let explanation = trace(
      status: .nativeAuthority,
      processIdentity: identity,
      agent: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
      matchedRuleID: "private-rule"
    )

    let result = host.debugAgentSnapshot(for: surfaceID, explanation: explanation)

    #expect(appliedNative)
    #expect(appliedTerminal)
    #expect(result.status == .nativeAuthority)
    #expect(result.agent?.kind == .pi)
    #expect(result.agent?.phase == .running)
    #expect(result.agent?.phaseSource == .native)
    #expect(result.agent?.sessionID == "private-session")
    #expect(
      result.agent?.process
        == SupatermAppDebugSnapshot.AgentProcess(
          processID: identity.processID,
          startTimeMicroseconds: identity.startTimeMicroseconds
        )
    )
    #expect(result.agent?.ruleID == nil)
  }

  @Test
  func controllerProofSelectsNativeAuthorityBeforeTerminalStatePublishes() async throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
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

    let result = host.debugAgentSnapshot(
      for: surfaceID,
      explanation: controller.explanation(for: surfaceID)
    )
    #expect(applied)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.resolvedAgentState(for: surfaceID).currentInstance?.activity.identity.id == "pi")
    #expect(result.agent?.kind == .pi)
    #expect(result.status == .nativeAuthority)
    #expect(result.agent?.process?.processID == identity.processID)
  }

  @Test
  func controllerProofKeepsNativeAuthorityAfterTerminalStateClears() async throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
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

    let result = host.debugAgentSnapshot(
      for: surfaceID,
      explanation: controller.explanation(for: surfaceID)
    )
    #expect(observation.processIdentity == identity)
    #expect(applied)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.resolvedAgentState(for: surfaceID).currentInstance?.activity.identity.id == "pi")
    #expect(result.agent?.kind == .pi)
    #expect(result.status == .nativeAuthority)
    #expect(result.agent?.process?.processID == identity.processID)
  }

  @Test
  func detailedExplanationReportsTheActiveManifestAndRuleEvidence() async throws {
    let fixture = try hostFixture()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let controller = try detectionController(
      host: fixture.host,
      surfaceID: fixture.surfaceID,
      processIdentity: identity
    )
    fixture.host.agentDetectionController = controller

    await controller.tick(now: .now)
    let detail = await fixture.host.detailedAgentDetectionExplanation(for: fixture.surfaceID)
    let result = fixture.host.debugAgentDetectionExplainResult(
      target: SupatermPaneTarget(
        windowIndex: 1,
        spaceIndex: 1,
        spaceID: UUID(),
        tabIndex: 1,
        tabID: UUID(),
        paneIndex: 1,
        paneID: fixture.surfaceID
      ),
      explanation: detail
    )

    #expect(result.manifest?.agentID == "codex")
    #expect(result.manifest?.origin == .bundled)
    #expect(result.matchedRuleID == "running")
    #expect(result.rules.first?.ruleID == "running")
    #expect(result.rules.first?.matched == true)
  }

  @Test
  func detailedExplanationRejectsEvidenceFromAnotherRuleGeneration() async throws {
    let fixture = try hostFixture()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let controller = try detectionController(
      host: fixture.host,
      surfaceID: fixture.surfaceID,
      processIdentity: identity,
      explanationGeneration: 8
    )

    await controller.tick(now: .now)
    let detail = await controller.detailedExplanation(for: fixture.surfaceID)

    #expect(detail.summary.generation == 7)
    #expect(detail.evaluation == nil)
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
      (.nativeAuthority, .nativeAuthority),
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
    processIdentity: TerminalAgentProcessIdentity,
    explanationGeneration: UInt64? = nil
  ) throws -> TerminalAgentDetectionController {
    let surface = try #require(host.surfaces[surfaceID])
    let processGroupID: Int32 = 11
    let generation: UInt64 = 7
    let snapshot = AgentDetectionRuleSnapshot(
      generation: generation,
      manifests: [
        AgentDetectionManifestSnapshot(
          agent: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
          version: "test.1",
          source: AgentDetectionManifestSource(origin: .bundled, path: "codex.toml")
        )
      ],
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
    let detailedEvaluation = detailedEvaluation(
      snapshot: snapshot,
      evaluation: evaluation,
      generation: explanationGeneration ?? generation
    )
    return TerminalAgentDetectionController(
      rules: TerminalAgentDetectionRuleAccess(
        snapshot: { snapshot },
        evaluateSignals: { requests in
          requests.map {
            $0.agentID == "codex" ? .needsScreen(generation: generation) : nil
          }
        },
        evaluate: { requests in
          requests.map { $0.agentID == "codex" ? evaluation : nil }
        },
        explain: { request in
          request.agentID == "codex" ? detailedEvaluation : nil
        }
      ),
      sampler: TerminalAgentDetectionSampler(
        resolveForegroundProcessGroups: { $0 },
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
        signals: { _ in TerminalAgentDetectionSignals(oscTitle: "") },
        screen: { _ in "running" },
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

  private func detailedEvaluation(
    snapshot: AgentDetectionRuleSnapshot,
    evaluation: AgentDetectionEvaluation,
    generation: UInt64
  ) -> AgentDetectionDetailedEvaluation {
    AgentDetectionDetailedEvaluation(
      identity: evaluation.identity,
      generation: generation,
      manifest: snapshot.manifests[0],
      explanation: AgentDetectionMatcherExplanation(
        match: evaluation.match,
        rules: [
          AgentDetectionRuleEvidence(
            ruleID: "running",
            result: .running,
            priority: 10,
            region: "whole_recent",
            matched: true,
            condition: AgentDetectionConditionEvidence(
              kind: "contains",
              value: "running",
              matched: true,
              children: []
            )
          )
        ]
      )
    )
  }

  private func hostFixture() throws -> HostFixture {
    initializeGhosttyForTests()
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    return HostFixture(host: host, surfaceID: surfaceID)
  }
}
