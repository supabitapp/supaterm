import AppKit
import Darwin
import Foundation
import Testing

@testable import SupatermSupport
@testable import supaterm

@Suite(.serialized)
@MainActor
struct TerminalAgentDetectionControllerTests {
  @Test
  func batchesDuePanesAndUsesMatchedAndAcquisitionCadence() async {
    let fixture = makeFixture()
    let firstID = fixture.host.addSurface(processGroupID: 11)
    let secondID = fixture.host.addSurface(processGroupID: 22)
    let unmatchedID = fixture.host.addSurface(processGroupID: 33)
    let firstIdentity = identity(processID: 101, startTime: 1)
    let secondIdentity = identity(processID: 202, startTime: 2)
    await fixture.sampler.setMatches([
      11: match(identity: firstIdentity),
      22: match(identity: secondIdentity),
    ])
    await fixture.sampler.setCurrent([firstIdentity, secondIdentity])
    let now = ContinuousClock.now

    await fixture.controller.tick(now: now)

    #expect(await fixture.sampler.batches() == [[11, 22, 33]])
    #expect(fixture.host.observations[firstID]?.processIdentity == firstIdentity)
    #expect(fixture.host.observations[secondID]?.processIdentity == secondIdentity)
    #expect(fixture.host.observations[unmatchedID] == nil)

    await fixture.controller.tick(now: now.advanced(by: .milliseconds(499)))
    #expect(await fixture.sampler.batches().count == 1)

    await fixture.controller.tick(now: now.advanced(by: .milliseconds(500)))
    #expect(await fixture.sampler.batches() == [[11, 22, 33], [33]])

    await fixture.controller.tick(now: now.advanced(by: .seconds(1)))
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(1_500)))
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(3_500)))
    #expect(
      await fixture.sampler.batches()
        == [[11, 22, 33], [33], [33], [33], [33]]
    )

    await fixture.controller.tick(now: now.advanced(by: .seconds(5)))
    #expect(
      await fixture.sampler.batches()
        == [[11, 22, 33], [33], [33], [33], [33], [11, 22]]
    )
  }

  @Test
  func scansResolvedForegroundProcessGroupWithoutChangingSurfaceIdentity() async {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setForegroundProcessGroups([surfaceID: 99])
    await fixture.sampler.setMatches([99: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    await fixture.controller.tick(now: ContinuousClock.now)

    #expect(await fixture.sampler.batches() == [[99]])
    #expect(fixture.host.observations[surfaceID]?.processIdentity == proof)
  }

  @Test
  func rejectsPIDReuseUntilTheExactStartTimeIsCurrent() async {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    let reused = identity(processID: 101, startTime: 2)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([reused])
    let now = ContinuousClock.now

    await fixture.controller.tick(now: now)

    #expect(fixture.host.captureCount == 0)
    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.controller.explanation(for: surfaceID).status == .unrecognizedProcess)

    await fixture.sampler.setCurrent([proof])
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(500)))

    #expect(fixture.host.captureCount == 1)
    #expect(fixture.host.observations[surfaceID]?.processIdentity == proof)
  }

  @Test
  func staleProcessScanRejectsObjectAndProcessGroupChanges() async {
    let gate = DetectionGate()
    let fixture = makeFixture(matchGate: gate)
    let replacedID = fixture.host.addSurface(processGroupID: 11)
    let changedGroupID = fixture.host.addSurface(processGroupID: 22)
    let firstIdentity = identity(processID: 101, startTime: 1)
    let secondIdentity = identity(processID: 202, startTime: 2)
    await fixture.sampler.setMatches([
      11: match(identity: firstIdentity),
      22: match(identity: secondIdentity),
    ])
    await fixture.sampler.setCurrent([firstIdentity, secondIdentity])

    let tick = Task {
      await fixture.controller.tick(now: ContinuousClock.now)
    }
    await gate.waitUntilSuspended()
    fixture.host.replaceSurface(replacedID)
    fixture.host.setProcessGroupID(23, for: changedGroupID)
    await gate.resume()
    await tick.value

    #expect(fixture.host.captureCount == 0)
    #expect(fixture.host.observations.isEmpty)
  }

  @Test
  func commandFinishRejectsAnInFlightProcessScan() async {
    let gate = DetectionGate()
    let fixture = makeFixture(matchGate: gate)
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    let tick = Task {
      await fixture.controller.tick(now: ContinuousClock.now)
    }
    await gate.waitUntilSuspended()
    fixture.controller.surfaceCommandDidFinish(surfaceID)
    await gate.resume()
    await tick.value

    #expect(fixture.host.captureCount == 0)
    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.host.applyCalls.isEmpty)
  }

  @Test
  func nonpositiveProcessGroupsAreNotScanned() async {
    let fixture = makeFixture()
    let zeroID = fixture.host.addSurface(processGroupID: 0)
    let negativeID = fixture.host.addSurface(processGroupID: -1)

    await fixture.controller.tick(now: ContinuousClock.now)

    #expect(await fixture.sampler.batches().isEmpty)
    #expect(fixture.host.captureCount == 0)
    #expect(fixture.controller.explanation(for: zeroID).status == .noForegroundProcess)
    #expect(fixture.controller.explanation(for: negativeID).status == .noForegroundProcess)
  }

  @Test
  func staleEvaluationRejectsSurfaceProcessAndGenerationChanges() async {
    let gate = DetectionGate()
    let fixture = makeFixture(evaluationGate: gate)
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    let tick = Task {
      await fixture.controller.tick(now: ContinuousClock.now)
    }
    await gate.waitUntilSuspended()
    fixture.host.replaceSurface(surfaceID)
    await fixture.sampler.setCurrent([])
    await fixture.rules.setGeneration(2)
    await gate.resume()
    await tick.value

    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.controller.explanation(for: surfaceID).generation == 2)
  }

  @Test
  func commandFinishRejectsAnInFlightEvaluation() async {
    let gate = DetectionGate()
    let fixture = makeFixture(evaluationGate: gate)
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    let tick = Task {
      await fixture.controller.tick(now: ContinuousClock.now)
    }
    await gate.waitUntilSuspended()
    fixture.controller.surfaceCommandDidFinish(surfaceID)
    await gate.resume()
    await tick.value

    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.host.applyCalls.isEmpty)
  }

  @Test
  func exactNativeAuthoritySkipsCaptureWhileAReusedPIDDoesNot() async {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 2)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])
    fixture.host.authority[surfaceID] = [proof]

    await fixture.controller.tick(now: ContinuousClock.now)

    #expect(fixture.host.captureCount == 0)
    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.controller.explanation(for: surfaceID).status == .nativeAuthority)

    fixture.host.authority[surfaceID] = [identity(processID: 101, startTime: 1)]
    await fixture.controller.tick(now: ContinuousClock.now.advanced(by: .milliseconds(300)))

    #expect(fixture.host.captureCount == 1)
    #expect(fixture.host.observations[surfaceID]?.processIdentity == proof)
  }

  @Test
  func unreadableScreenClearsFallbackWithoutEvaluation() async {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11, capture: nil)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    await fixture.controller.tick(now: ContinuousClock.now)

    #expect(fixture.host.captureCount == 1)
    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(await fixture.rules.inputs().isEmpty)
    #expect(
      fixture.controller.explanation(for: surfaceID).status == .protectedOrUnreadableScreen
    )
  }

  @Test
  func matcherInputKeepsBoundedUTF8ScreenTailAndTitlePrefix() async throws {
    let fixture = makeFixture()
    let screenPrefix = "discard-me-"
    let screenSuffix = "🙂Z"
    let titlePrefix = "⠋ title-start-"
    let surfaceID = fixture.host.addSurface(
      processGroupID: 11,
      capture: TerminalAgentDetectionCapture(
        screen: screenPrefix + String(repeating: "é", count: 40_000) + screenSuffix,
        oscTitle: titlePrefix + String(repeating: "é", count: 3_000)
      )
    )
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    await fixture.controller.tick(now: ContinuousClock.now)

    let input = try #require(await fixture.rules.inputs().first)
    #expect(input.screen.utf8.count <= TerminalAgentDetectionController.screenByteLimit)
    #expect(input.screen.hasSuffix(screenSuffix))
    #expect(!input.screen.hasPrefix(screenPrefix))
    #expect(input.oscTitle.utf8.count <= TerminalAgentDetectionController.titleByteLimit)
    #expect(input.oscTitle.hasPrefix(titlePrefix))
    #expect(fixture.host.observations[surfaceID] != nil)
  }

  @Test
  func settlesWeakEvidencePreservesRuleAndDeduplicatesSemanticState() async throws {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])
    let now = ContinuousClock.now

    await fixture.controller.tick(now: now)
    let running = try #require(fixture.host.observations[surfaceID])
    #expect(running.phase == .running)
    #expect(running.sequence == 1)

    await fixture.controller.tick(now: now.advanced(by: .milliseconds(100)))
    #expect(fixture.host.applyCalls.count == 1)

    await fixture.rules.setMatch(
      AgentDetectionMatch(result: .idle, ruleID: "idle")
    )
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(300)))
    #expect(fixture.host.applyCalls.count == 1)
    #expect(fixture.host.observations[surfaceID]?.ruleID == "running")
    #expect(fixture.controller.explanation(for: surfaceID).matchedRuleID == "idle")
    #expect(fixture.controller.explanation(for: surfaceID).status == .noRuleMatchOrSettling)
    #expect(
      fixture.controller.nextTickDelay(now: now.advanced(by: .milliseconds(300)))
        == .milliseconds(100)
    )

    await fixture.controller.tick(now: now.advanced(by: .milliseconds(400)))
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(500)))
    #expect(fixture.host.observations[surfaceID]?.phase == .running)
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(600)))
    let idle = try #require(fixture.host.observations[surfaceID])
    #expect(idle.phase == .idle)
    #expect(idle.ruleID == "idle")
    #expect(idle.sequence == 2)
    #expect(
      fixture.controller.nextTickDelay(now: now.advanced(by: .milliseconds(600)))
        == .milliseconds(300)
    )

    await fixture.rules.setMatch(
      AgentDetectionMatch(result: .hold, ruleID: "hold")
    )
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(900)))
    #expect(fixture.host.applyCalls.count == 2)
    #expect(fixture.host.observations[surfaceID]?.ruleID == "idle")

    await fixture.rules.setMatch(
      AgentDetectionMatch(result: .needsInput, ruleID: "attention")
    )
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(1_200)))
    #expect(fixture.host.observations[surfaceID]?.phase == .needsInput)
    #expect(fixture.host.observations[surfaceID]?.sequence == 3)

    await fixture.rules.setMatch(
      AgentDetectionMatch(
        result: .idle,
        ruleID: AgentDetectionMatcher.fallbackRuleID
      )
    )
    await fixture.controller.tick(now: now.advanced(by: .milliseconds(1_500)))
    #expect(fixture.host.observations[surfaceID]?.phase == .idle)
    #expect(
      fixture.host.observations[surfaceID]?.ruleID
        == AgentDetectionMatcher.fallbackRuleID
    )
  }

  @Test
  func explanationAndDedupeReadTheCanonicalHostObservation() async throws {
    let fixture = makeFixture()
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])
    let now = ContinuousClock.now

    await fixture.controller.tick(now: now)
    let running = try #require(fixture.host.observation(for: surfaceID))
    let alternate = TerminalAgentDetectionObservation(
      agent: running.agent,
      phase: .needsInput,
      processIdentity: running.processIdentity,
      ruleID: "canonical-attention",
      generation: running.generation,
      sequence: 100
    )
    #expect(fixture.host.store(alternate, for: surfaceID))

    let explanation = fixture.controller.explanation(for: surfaceID)
    #expect(explanation.agent == alternate.agent)
    #expect(explanation.publishedPhase == alternate.phase)
    #expect(explanation.publishedRuleID == alternate.ruleID)

    let canonical = TerminalAgentDetectionObservation(
      agent: running.agent,
      phase: running.phase,
      processIdentity: running.processIdentity,
      ruleID: running.ruleID,
      generation: running.generation,
      sequence: 101
    )
    #expect(fixture.host.store(canonical, for: surfaceID))

    await fixture.controller.tick(now: now.advanced(by: .milliseconds(100)))

    #expect(fixture.host.applyCalls.count == 1)
    #expect(fixture.host.observation(for: surfaceID) == canonical)
  }

  @Test
  func stopCancelsInFlightWorkAndSurfaceRemovalClearsPublishedState() async {
    let gate = DetectionGate()
    let fixture = makeFixture(evaluationGate: gate)
    let surfaceID = fixture.host.addSurface(processGroupID: 11)
    let proof = identity(processID: 101, startTime: 1)
    await fixture.sampler.setMatches([11: match(identity: proof)])
    await fixture.sampler.setCurrent([proof])

    fixture.controller.start()
    await gate.waitUntilSuspended()
    fixture.controller.stop()
    await gate.resume()
    await Task.yield()

    #expect(!fixture.controller.isRunning)
    #expect(fixture.host.observations[surfaceID] == nil)
    #expect(fixture.host.applyCalls.isEmpty)

    let ungated = makeFixture()
    let liveSurfaceID = ungated.host.addSurface(processGroupID: 11)
    await ungated.sampler.setMatches([11: match(identity: proof)])
    await ungated.sampler.setCurrent([proof])
    await ungated.controller.tick(now: ContinuousClock.now)
    #expect(ungated.host.observations[liveSurfaceID] != nil)

    ungated.controller.surfaceDidRemove(liveSurfaceID)
    #expect(ungated.host.observations[liveSurfaceID] == nil)
  }

  @Test
  func startedControllerDoesNotRetainItself() async {
    let host = DetectionHostFixture()
    let rules = DetectionRulesFixture()
    let sampler = DetectionSamplerFixture()
    weak var retained: TerminalAgentDetectionController?

    do {
      let controller = makeController(host: host, rules: rules, sampler: sampler)
      controller.start()
      retained = controller
    }
    await Task.yield()

    #expect(retained == nil)
  }

  @Test(arguments: [false, true])
  func liveGhosttyProcessDetectionWorksAcrossSessionModes(
    zmxSessionsEnabled: Bool
  ) async throws {
    initializeGhosttyForTests()
    let temporaryDirectory = FileManager.default.temporaryDirectory.appending(
      path: "supaterm-live-agent-detection-\(UUID().uuidString)",
      directoryHint: .isDirectory
    )
    try FileManager.default.createDirectory(
      at: temporaryDirectory,
      withIntermediateDirectories: true
    )
    let executableURL = temporaryDirectory.appending(path: "codex")
    try FileManager.default.copyItem(
      at: URL(filePath: "/bin/sleep"),
      to: executableURL
    )
    try adHocSign(executableURL)
    let repository = try AgentDetectionRuleRepository(bundle: SupatermResources.bundle)
    let runtime = try makeGhosttyRuntime("")
    let host = TerminalHostState(
      runtime: runtime,
      zmxSessionsEnabled: zmxSessionsEnabled,
      agentDetectionRuleRepository: repository
    )
    var processID: Int32?
    var window: NSWindow?
    defer {
      host.agentDetectionController?.stop()
      if let processID {
        _ = Darwin.kill(processID, SIGKILL)
      }
      for surfaceID in host.liveSurfaceIDs() {
        host.performCloseSurface(surfaceID)
      }
      window?.contentView = nil
      window?.orderOut(nil)
      try? FileManager.default.removeItem(at: temporaryDirectory)
    }
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    let surface = try #require(host.selectedSurfaceView)
    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 640, height: 320),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window?.contentView = surface
    window?.makeKeyAndOrderFront(nil)
    window?.makeFirstResponder(surface)
    let shellProcessGroupID = try await waitForForegroundProcess(on: surface)
    let interruptedScreen = [
      "\\n• Working (8m 21s • esc to interrupt)",
      "■ Conversation interrupted - tell the model what to do differently.",
      "› do it in a new worktree\\n",
    ].joined(separator: "\\n")
    let command =
      if zmxSessionsEnabled {
        "printf '\(interruptedScreen)'; '\(executableURL.path)' 120"
      } else {
        "\(executableURL.path) 120"
      }
    let expectedPhase: AgentActivityPhase = zmxSessionsEnabled ? .idle : .running
    let expectedRuleID = zmxSessionsEnabled ? "osc_title_idle" : "osc_title_working"
    surface.bridge.submitText(command)
    if !zmxSessionsEnabled {
      _ = try await waitForForegroundProcess(
        on: surface,
        excluding: shellProcessGroupID
      )
    }
    let proof = try await waitForProvenProcess {
      host.agentDetectionExplanation(for: surface.id)
    }
    processID = proof.processID
    surface.bridge.state.title = zmxSessionsEnabled ? "project" : "⠋ running"

    let detected = try await waitForDetection(
      {
        guard let observation = terminalObservation(in: host, for: surface.id),
          observation.phase == expectedPhase,
          observation.ruleID == expectedRuleID
        else {
          return nil
        }
        return observation
      },
      explanation: { host.agentDetectionExplanation(for: surface.id) }
    )
    processID = detected.processIdentity.processID

    #expect(detected.processIdentity == proof)
    #expect(detected.agent.id == "codex")
    #expect(detected.phase == expectedPhase)
    #expect(detected.ruleID == expectedRuleID)
    #expect(host.agentActivity(for: try #require(host.selectedTabID)) == .codex(expectedPhase))
    #expect(host.agentDetectionExplanation(for: surface.id).publishedPhase == detected.phase)
    #expect(host.agentDetectionExplanation(for: surface.id).publishedRuleID == detected.ruleID)
    #expect(Darwin.kill(detected.processIdentity.processID, SIGTERM) == 0)

    try await waitForDetectionClear {
      terminalObservation(in: host, for: surface.id)
    }
    processID = nil
    #expect(terminalObservation(in: host, for: surface.id) == nil)
  }

  private func makeFixture(
    matchGate: DetectionGate? = nil,
    evaluationGate: DetectionGate? = nil
  ) -> DetectionControllerFixture {
    let host = DetectionHostFixture()
    let rules = DetectionRulesFixture(gate: evaluationGate)
    let sampler = DetectionSamplerFixture(gate: matchGate)
    return DetectionControllerFixture(
      host: host,
      rules: rules,
      sampler: sampler,
      controller: makeController(host: host, rules: rules, sampler: sampler)
    )
  }

  private func makeController(
    host: DetectionHostFixture,
    rules: DetectionRulesFixture,
    sampler: DetectionSamplerFixture
  ) -> TerminalAgentDetectionController {
    TerminalAgentDetectionController(
      rules: TerminalAgentDetectionRuleAccess(
        snapshot: { await rules.snapshot() },
        evaluate: { agentID, input in
          await rules.evaluate(agentID: agentID, input: input)
        }
      ),
      sampler: TerminalAgentDetectionSampler(
        resolveForegroundProcessGroups: { processGroupIDs in
          await sampler.resolveForegroundProcessGroups(processGroupIDs)
        },
        matches: { processGroupIDs, manifests in
          await sampler.matches(processGroupIDs, manifests: manifests)
        },
        current: { identities in
          await sampler.current(identities)
        }
      ),
      host: host.access
    )
  }

  private func identity(
    processID: Int32,
    startTime: UInt64
  ) -> TerminalAgentProcessIdentity {
    TerminalAgentProcessIdentity(
      processID: processID,
      startTimeMicroseconds: startTime
    )
  }

  private func match(identity: TerminalAgentProcessIdentity) -> AgentDetectionProcessMatch {
    AgentDetectionProcessMatch(
      agentID: "agent",
      processIdentity: identity
    )
  }

  private func adHocSign(_ executableURL: URL) throws {
    let signer = Process()
    signer.executableURL = URL(filePath: "/usr/bin/codesign")
    signer.arguments = ["--force", "--sign", "-", executableURL.path]
    try signer.run()
    signer.waitUntilExit()
    guard signer.terminationReason == .exit, signer.terminationStatus == 0 else {
      throw DetectionTestError.signingFailed(signer.terminationStatus)
    }
  }

  private func waitForDetection(
    _ read: @MainActor () -> TerminalAgentDetectionObservation?,
    explanation: @MainActor () -> TerminalAgentDetectionExplanation
  ) async throws -> TerminalAgentDetectionObservation {
    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
    while ContinuousClock.now < deadline {
      if let observation = read() { return observation }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw DetectionTestError.detectionTimedOut(explanation())
  }

  private func waitForDetectionClear(
    _ read: @MainActor () -> TerminalAgentDetectionObservation?
  ) async throws {
    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
    while ContinuousClock.now < deadline {
      if read() == nil { return }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw DetectionTestError.timedOut
  }

  private func waitForForegroundProcess(
    on surface: GhosttySurfaceView,
    excluding excludedProcessGroupID: Int32? = nil
  ) async throws -> Int32 {
    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
    while ContinuousClock.now < deadline {
      if let processGroupID = surface.foregroundProcessGroupID,
        processGroupID > 0,
        processGroupID != excludedProcessGroupID
      {
        return processGroupID
      }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw DetectionTestError.foregroundProcessTimedOut
  }

  private func waitForProvenProcess(
    _ read: @MainActor () -> TerminalAgentDetectionExplanation
  ) async throws -> TerminalAgentProcessIdentity {
    let deadline = ContinuousClock.now.advanced(by: .seconds(10))
    while ContinuousClock.now < deadline {
      if let processIdentity = read().processIdentity { return processIdentity }
      try await Task.sleep(for: .milliseconds(50))
    }
    throw DetectionTestError.detectionTimedOut(read())
  }
}

@MainActor
private struct DetectionControllerFixture {
  let host: DetectionHostFixture
  let rules: DetectionRulesFixture
  let sampler: DetectionSamplerFixture
  let controller: TerminalAgentDetectionController
}

@MainActor
private final class DetectionHostFixture {
  private struct Surface {
    let token: NSObject
    var processGroupID: Int32?
    var capture: TerminalAgentDetectionCapture?
  }

  private var surfaces: [UUID: Surface] = [:]
  private var detectionStore = TerminalAgentDetectionStore()
  var authority: [UUID: Set<TerminalAgentProcessIdentity>] = [:]
  var applyCalls: [TerminalAgentDetectionObservation] = []
  var captureCount = 0

  var observations: [UUID: TerminalAgentDetectionObservation] {
    Dictionary(
      uniqueKeysWithValues: surfaces.keys.compactMap { surfaceID in
        observation(for: surfaceID).map { (surfaceID, $0) }
      }
    )
  }

  var access: TerminalAgentDetectionHostAccess {
    TerminalAgentDetectionHostAccess(
      surfaces: { [weak self] in self?.snapshots() ?? [] },
      capture: { [weak self] key in self?.capture(key) },
      nativeAuthority: { [weak self] surfaceID in self?.authority[surfaceID] ?? [] },
      observation: { [weak self] surfaceID in self?.observation(for: surfaceID) },
      apply: { [weak self] observation, surfaceID in
        guard let self, self.surfaces[surfaceID] != nil else { return false }
        guard self.detectionStore.apply(observation, for: surfaceID) else { return false }
        self.applyCalls.append(observation)
        return true
      },
      clear: { [weak self] surfaceID in
        self?.detectionStore.clear(for: surfaceID)
      }
    )
  }

  func observation(for surfaceID: UUID) -> TerminalAgentDetectionObservation? {
    detectionStore.observation(for: surfaceID)
  }

  func store(
    _ observation: TerminalAgentDetectionObservation,
    for surfaceID: UUID
  ) -> Bool {
    detectionStore.apply(observation, for: surfaceID)
  }

  func addSurface(
    processGroupID: Int32?,
    capture: TerminalAgentDetectionCapture? = TerminalAgentDetectionCapture(
      screen: "ready",
      oscTitle: ""
    )
  ) -> UUID {
    let id = UUID()
    surfaces[id] = Surface(
      token: NSObject(),
      processGroupID: processGroupID,
      capture: capture
    )
    return id
  }

  func replaceSurface(_ surfaceID: UUID) {
    guard let surface = surfaces[surfaceID] else { return }
    surfaces[surfaceID] = Surface(
      token: NSObject(),
      processGroupID: surface.processGroupID,
      capture: surface.capture
    )
  }

  func setProcessGroupID(_ processGroupID: Int32?, for surfaceID: UUID) {
    surfaces[surfaceID]?.processGroupID = processGroupID
  }

  private func snapshots() -> [TerminalAgentDetectionSurfaceSnapshot] {
    surfaces.map { surfaceID, surface in
      TerminalAgentDetectionSurfaceSnapshot(
        key: TerminalAgentDetectionSurfaceKey(
          id: surfaceID,
          instance: ObjectIdentifier(surface.token),
          foregroundProcessGroupID: surface.processGroupID
        )
      )
    }
  }

  private func capture(
    _ key: TerminalAgentDetectionSurfaceKey
  ) -> TerminalAgentDetectionCapture? {
    captureCount += 1
    guard let surface = surfaces[key.id],
      ObjectIdentifier(surface.token) == key.instance,
      surface.processGroupID == key.foregroundProcessGroupID
    else {
      return nil
    }
    return surface.capture
  }
}

private actor DetectionRulesFixture {
  private let identity = AgentDetectionAgentIdentity(id: "agent", displayName: "Agent")
  private let gate: DetectionGate?
  private var generation: UInt64 = 1
  private var match = AgentDetectionMatch(
    result: .running,
    ruleID: "running"
  )
  private var capturedInputs: [AgentDetectionInput] = []

  init(gate: DetectionGate? = nil) {
    self.gate = gate
  }

  func snapshot() -> AgentDetectionRuleSnapshot {
    AgentDetectionRuleSnapshot(
      origin: .embedded,
      generation: generation,
      processManifests: [
        AgentDetectionProcessManifest(
          agentID: identity.id,
          processes: [AgentDetectionProcessRule(executable: "agent")]
        )
      ]
    )
  }

  func evaluate(
    agentID: String,
    input: AgentDetectionInput
  ) async -> AgentDetectionEvaluation? {
    guard agentID == identity.id else { return nil }
    let evaluation = AgentDetectionEvaluation(
      identity: identity,
      generation: generation,
      match: match
    )
    capturedInputs.append(input)
    if let gate {
      await gate.suspend()
    }
    return evaluation
  }

  func setGeneration(_ generation: UInt64) {
    self.generation = generation
  }

  func setMatch(_ match: AgentDetectionMatch) {
    self.match = match
  }

  func inputs() -> [AgentDetectionInput] {
    capturedInputs
  }
}

private actor DetectionSamplerFixture {
  private let gate: DetectionGate?
  private var processMatches: [Int32: AgentDetectionProcessMatch] = [:]
  private var currentIdentities: Set<TerminalAgentProcessIdentity> = []
  private var resolvedProcessGroups: [UUID: Int32]?
  private var capturedBatches: [Set<Int32>] = []

  init(gate: DetectionGate? = nil) {
    self.gate = gate
  }

  func resolveForegroundProcessGroups(_ processGroupIDs: [UUID: Int32]) -> [UUID: Int32] {
    resolvedProcessGroups ?? processGroupIDs
  }

  func matches(
    _ processGroupIDs: Set<Int32>,
    manifests _: [AgentDetectionProcessManifest]
  ) async -> [Int32: AgentDetectionProcessMatch] {
    capturedBatches.append(processGroupIDs)
    if let gate {
      await gate.suspend()
    }
    return processMatches.filter { processGroupIDs.contains($0.key) }
  }

  func current(
    _ identities: Set<TerminalAgentProcessIdentity>
  ) -> Set<TerminalAgentProcessIdentity> {
    identities.intersection(currentIdentities)
  }

  func setMatches(_ matches: [Int32: AgentDetectionProcessMatch]) {
    processMatches = matches
  }

  func setCurrent(_ identities: Set<TerminalAgentProcessIdentity>) {
    currentIdentities = identities
  }

  func setForegroundProcessGroups(_ processGroupIDs: [UUID: Int32]) {
    resolvedProcessGroups = processGroupIDs
  }

  func batches() -> [Set<Int32>] {
    capturedBatches
  }
}

private actor DetectionGate {
  private var continuation: CheckedContinuation<Void, Never>?
  private var suspended = false

  func suspend() async {
    suspended = true
    await withCheckedContinuation { continuation in
      self.continuation = continuation
    }
  }

  func waitUntilSuspended() async {
    while !suspended {
      await Task.yield()
    }
  }

  func resume() {
    continuation?.resume()
    continuation = nil
  }
}

private enum DetectionTestError: Error {
  case detectionTimedOut(TerminalAgentDetectionExplanation)
  case foregroundProcessTimedOut
  case signingFailed(Int32)
  case timedOut
}
