import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalHostStateAgentDetectionTests {
  private struct HostFixture {
    let host: TerminalHostState
    let tabID: TerminalTabID
    let surfaceID: UUID
  }

  @Test
  func terminalResolutionLendsNativeDetailsForTheExactProcessIdentity() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let detection = observation(processIdentity: identity)
    let details = candidate(agent: .codex, processIdentities: [identity])
    var store = TerminalAgentDetectionStore()
    let applied = store.apply(detection, for: surfaceID)

    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [details])
        == .terminal(detection, nativeDetails: details)
    )
  }

  @Test
  func terminalResolutionRejectsNativeDetailsFromAReusedProcessID() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let reused = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let detection = observation(processIdentity: identity)
    let details = candidate(agent: .codex, processIdentities: [reused])
    var store = TerminalAgentDetectionStore()
    let applied = store.apply(detection, for: surfaceID)

    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [details])
        == .terminal(detection, nativeDetails: nil)
    )
  }

  @Test
  func terminalResolutionRejectsNativeDetailsFromADifferentProcessID() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let different = TerminalAgentProcessIdentity(processID: 43, startTimeMicroseconds: 2)
    let detection = observation(processIdentity: identity)
    let details = candidate(agent: .codex, processIdentities: [different])
    var store = TerminalAgentDetectionStore()
    let applied = store.apply(detection, for: surfaceID)

    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [details])
        == .terminal(detection, nativeDetails: nil)
    )
  }

  @Test
  func observationsRejectStaleSequenceAndClearWithTheirProcess() throws {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let first = observation(processIdentity: identity, phase: .running, sequence: 2)
    let stale = observation(processIdentity: identity, phase: .needsInput, sequence: 1)
    var store = TerminalAgentDetectionStore()

    let applied = store.apply(first, for: surfaceID)
    let appliedStale = store.apply(stale, for: surfaceID)
    #expect(applied)
    #expect(!appliedStale)
    #expect(store.observation(for: surfaceID) == first)

    let prunedSurfaceIDs = store.pruneDeadProcesses(isProcessCurrent: { $0 != identity })
    #expect(prunedSurfaceIDs == [surfaceID])
    #expect(store.observation(for: surfaceID) == nil)

    let reapplied = store.apply(first, for: surfaceID)
    let cleared = store.clear(for: surfaceID)
    #expect(reapplied)
    #expect(cleared)
    #expect(store.observation(for: surfaceID) == nil)
  }

  @Test
  func processMatchesClearOnlyWhenTheirExactProcessEnds() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let match = AgentDetectionProcessMatch(agentID: "gemini", processIdentity: identity)
    var store = TerminalAgentDetectionStore()

    let applied = store.applyProcessMatch(match, for: surfaceID)
    let appliedAgain = store.applyProcessMatch(match, for: surfaceID)
    #expect(applied)
    #expect(!appliedAgain)
    #expect(store.processMatch(for: surfaceID) == match)
    #expect(store.pruneDeadProcesses(isProcessCurrent: { $0 == identity }).isEmpty)
    #expect(store.processMatch(for: surfaceID) == match)
    #expect(store.pruneDeadProcesses(isProcessCurrent: { _ in false }) == [surfaceID])
    #expect(store.processMatch(for: surfaceID) == nil)
  }

  @Test
  @MainActor
  func terminalDetectionFeedsSidebarPanelWorkspaceAndPortRootsWithoutNativeState() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let tabID = fixture.tabID
    let surfaceID = fixture.surfaceID
    let detection = observation(
      agentID: "custom-agent",
      displayName: "Custom Agent",
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    )

    let applied = host.applyAgentDetection(detection, for: surfaceID)

    #expect(applied)
    #expect(
      host.agentActivity(for: tabID)
        == TerminalHostState.AgentActivity(identity: detection.agent, phase: .running)
    )
    #expect(host.agentPanelIsActive(for: surfaceID))
    #expect(host.agentPanelWorkspaceContext(for: surfaceID) != nil)
    let portScanContext = try #require(host.panePortScanContext(for: surfaceID))
    #expect(portScanContext.nativeProcessIdentities.isEmpty)
    #expect(portScanContext.fallbackProcessIdentity == detection.processIdentity)
    #expect(host.agentPanelPresentation(for: surfaceID)?.progressRows.first?.title == "Starting session")
    #expect(host.agentPanelPresentation(for: surfaceID)?.session == nil)
    #expect(host.agentStateRecords(for: surfaceID).isEmpty)
  }

  @Test
  @MainActor
  func sidebarPrefersProvenAgentMarkThenProcessIconThenTerminal() throws {
    let fixture = try hostFixture()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let match = AgentDetectionProcessMatch(agentID: "gemini", processIdentity: identity)

    #expect(
      fixture.host.sidebarPanePresentations(for: fixture.tabID).first?.icon == .terminal
    )
    fixture.host.setProcessIcon(.btop, for: fixture.surfaceID)
    #expect(
      fixture.host.sidebarPanePresentations(for: fixture.tabID).first?.icon == .process(.btop)
    )
    #expect(fixture.host.applyAgentProcessMatch(match, for: fixture.surfaceID))
    #expect(
      fixture.host.sidebarPanePresentations(for: fixture.tabID).first?.icon
        == .agent("geminicli-mark")
    )
    #expect(fixture.host.clearAgentProcessMatch(for: fixture.surfaceID))
    #expect(
      fixture.host.sidebarPanePresentations(for: fixture.tabID).first?.icon == .process(.btop)
    )
    fixture.host.setProcessIcon(nil, for: fixture.surfaceID)
    #expect(
      fixture.host.sidebarPanePresentations(for: fixture.tabID).first?.icon == .terminal
    )
  }

  @Test
  @MainActor
  func terminalIdleRemainsVisibleAsMutedAgentActivity() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let tabID = fixture.tabID
    let surfaceID = fixture.surfaceID
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1),
      phase: .idle
    )

    let applied = host.applyAgentDetection(detection, for: surfaceID)

    #expect(applied)
    #expect(host.agentActivity(for: tabID) == .codex(.idle))
  }

  @Test
  @MainActor
  func terminalPhaseKeepsSessionIdentityWithoutHookDetails() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let tabID = fixture.tabID
    let surfaceID = fixture.surfaceID
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let plan = PaneAgentProgressRow(id: "plan", title: "Read-only plan", status: .running)
    host.agentStateStore.restore([
      snapshot(
        surfaceID: surfaceID,
        processIdentity: identity,
        detail: "Native detail",
        progressRows: [plan]
      )
    ])
    let detection = observation(processIdentity: identity, phase: .needsInput)

    let applied = host.applyAgentDetection(detection, for: surfaceID)
    let panel = try #require(host.agentPanelPresentation(for: surfaceID))

    #expect(applied)
    #expect(host.agentActivity(for: tabID) == .codex(.needsInput))
    #expect(panel.progressRows.isEmpty)
    #expect(panel.session?.sessionID == "restored-session")
  }

  @Test
  @MainActor
  func terminalPhasesOverrideCodexHookPhaseInDebugSnapshot() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let tabID = fixture.tabID
    let surfaceID = fixture.surfaceID
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let appliedNative = host.applyTestAgentActivity(
      .codex(.running, detail: "Native detail"),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )

    #expect(appliedNative)
    #expect(host.tabAgentPresentation(for: tabID).status == .working)

    let phases: [(AgentActivityPhase, SupatermAppDebugSnapshot.AgentPhase)] = [
      (.unknown, .unknown),
      (.idle, .idle),
      (.running, .running),
      (.needsInput, .needsInput),
    ]
    for (offset, phase) in phases.enumerated() {
      let appliedDetection = host.applyAgentDetection(
        observation(
          processIdentity: identity,
          phase: phase.0,
          sequence: UInt64(offset + 10_000)
        ),
        for: surfaceID
      )

      #expect(appliedDetection)
      #expect(host.agentActivity(for: tabID)?.phase == phase.0)
      #expect(host.agentPanelPresentation(for: surfaceID)?.session?.sessionID == "native-session")
      #expect(
        host.debugAgentSnapshot(for: surfaceID).agent
          == SupatermAppDebugSnapshot.Agent(
            kind: .codex,
            phase: phase.1,
            phaseSource: .screen,
            sessionID: "native-session",
            ruleID: "prompt-state",
            process: SupatermAppDebugSnapshot.AgentProcess(
              processID: identity.processID,
              startTimeMicroseconds: identity.startTimeMicroseconds
            )
          )
      )
    }
  }

  @Test
  @MainActor
  func cleanCommandExitPersistsCompletionUntilSurfaceCleanup() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    )
    _ = host.applyAgentDetection(detection, for: surfaceID)
    host.surfaces[surfaceID]?.bridge.state.commandExitCode = 0

    host.handleCommandFinished(for: surfaceID)

    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.agentStateRecords(for: surfaceID).isEmpty)
    #expect(host.agentActivity(for: fixture.tabID) == .codex(.idle))
    #expect(host.tabAgentPresentation(for: fixture.tabID).status == .done)

    host.performCloseSurface(surfaceID)

    #expect(terminalObservation(in: host, for: surfaceID) == nil)
    #expect(host.agentActivity(for: fixture.tabID) == nil)
  }

  @Test
  @MainActor
  func failedCommandExitPersistsCompletionUntilLaterActivity() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    _ = host.applyAgentDetection(
      observation(
        processIdentity: TerminalAgentProcessIdentity(
          processID: 42,
          startTimeMicroseconds: 1
        )
      ),
      for: surfaceID
    )
    host.surfaces[surfaceID]?.bridge.state.commandExitCode = 1

    host.handleCommandFinished(for: surfaceID)

    #expect(host.agentActivity(for: fixture.tabID) == .codex(.idle))
    #expect(host.tabAgentPresentation(for: fixture.tabID).status == .done)

    host.surfaces[surfaceID]?.bridge.state.commandExitCode = 0
    host.handleCommandFinished(for: surfaceID)

    #expect(host.agentActivity(for: fixture.tabID) == nil)
    #expect(host.tabAgentPresentation(for: fixture.tabID).status == nil)
  }

  @Test
  @MainActor
  func focusingPaneClearsRetainedExitState() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    _ = host.applyAgentDetection(
      observation(
        processIdentity: TerminalAgentProcessIdentity(
          processID: 42,
          startTimeMicroseconds: 1
        )
      ),
      for: fixture.surfaceID
    )
    host.surfaces[fixture.surfaceID]?.bridge.state.commandExitCode = 0
    host.handleCommandFinished(for: fixture.surfaceID)
    #expect(host.agentActivity(for: fixture.tabID) == .codex(.idle))

    host.windowActivity = WindowActivityState(isKeyWindow: true, isVisible: true)
    host.applyFocusedSurface(fixture.surfaceID, in: fixture.tabID)

    #expect(host.agentActivity(for: fixture.tabID) == nil)
  }

  private func observation(
    agentID: String = "codex",
    displayName: String = "Codex",
    processIdentity: TerminalAgentProcessIdentity,
    phase: AgentActivityPhase = .running,
    sequence: UInt64 = 1
  ) -> TerminalAgentDetectionObservation {
    TerminalAgentDetectionObservation(
      agent: AgentDetectionAgentIdentity(id: agentID, displayName: displayName),
      phase: phase,
      processIdentity: processIdentity,
      ruleID: "prompt-state",
      generation: 7,
      sequence: sequence
    )
  }

  private func candidate(
    agent: SupatermAgentKind,
    processIdentities: Set<TerminalAgentProcessIdentity>
  ) -> TerminalAgentDetectionNativeCandidate {
    TerminalAgentDetectionNativeCandidate(
      presentation: TerminalAgentStatePresentation(
        agent: agent,
        sessionID: "native-\(agent.rawValue)",
        phase: .running,
        detail: "Native detail",
        latestResponse: nil,
        isActionable: true,
        progressRows: [],
        activeChildren: [],
        turnLifecycle: .active("turn-1"),
        workingDirectoryPath: nil
      ),
      revision: 1,
      processIdentities: processIdentities
    )
  }

  private func snapshot(
    surfaceID: UUID,
    processIdentity: TerminalAgentProcessIdentity,
    detail: String,
    progressRows: [PaneAgentProgressRow]
  ) -> TerminalAgentStateSnapshot {
    TerminalAgentStateSnapshot(
      agent: .codex,
      sessionID: "restored-session",
      surfaceID: surfaceID,
      processes: [processIdentity],
      turnLifecycle: .active("turn-1"),
      phase: .running,
      detail: detail,
      attentionRequestID: nil,
      latestResponse: nil,
      isActionable: true,
      progressRows: progressRows,
      activeChildren: [],
      hasPendingBackgroundWork: false,
      isForeground: true,
      revision: 1,
      workingDirectoryPath: "/tmp/native-workspace"
    )
  }

  @MainActor
  private func hostFixture() throws -> HostFixture {
    initializeGhosttyForTests()
    let host = TerminalHostState.test()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    return HostFixture(
      host: host,
      tabID: try #require(host.selectedTabID),
      surfaceID: try #require(host.selectedSurfaceView?.id)
    )
  }
}
