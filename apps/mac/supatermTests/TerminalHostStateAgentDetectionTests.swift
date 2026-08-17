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
  func authorityResolutionMatrixUsesExactProcessIdentity() {
    let surfaceID = UUID()
    let observedIdentity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let staleIdentity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let observation = observation(processIdentity: observedIdentity)
    let codexWithoutAuthority = candidate(
      agent: .codex,
      processIdentities: [observedIdentity]
    )
    let codexWithAuthority = candidate(
      agent: .codex,
      processIdentities: [observedIdentity],
      authority: [observedIdentity]
    )
    let claudeWithAuthority = candidate(
      agent: .claude,
      processIdentities: [observedIdentity],
      authority: [observedIdentity]
    )
    let codexWithReusedPID = candidate(
      agent: .codex,
      processIdentities: [staleIdentity],
      authority: [staleIdentity]
    )
    let claudeWithoutAuthority = candidate(
      agent: .claude,
      processIdentities: [observedIdentity]
    )
    var store = TerminalAgentDetectionStore()

    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [codexWithoutAuthority])
        == .native([codexWithoutAuthority])
    )
    let applied = store.apply(observation, for: surfaceID)
    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [codexWithoutAuthority])
        == .fallback(observation, nativeDetails: codexWithoutAuthority)
    )
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [codexWithAuthority])
        == .native([codexWithAuthority])
    )
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [claudeWithAuthority])
        == .native([claudeWithAuthority])
    )
    #expect(
      store.resolve(
        for: surfaceID,
        nativeCandidates: [codexWithoutAuthority, claudeWithAuthority]
      ) == .native([claudeWithAuthority])
    )
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [codexWithReusedPID])
        == .fallback(observation, nativeDetails: nil)
    )
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [claudeWithoutAuthority])
        == .fallback(observation, nativeDetails: nil)
    )
  }

  @Test
  func fallbackLendsNativeDetailsForTheExactProcessIdentity() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let detection = observation(processIdentity: identity)
    let details = candidate(agent: .codex, processIdentities: [identity])
    var store = TerminalAgentDetectionStore()
    let applied = store.apply(detection, for: surfaceID)

    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [details])
        == .fallback(detection, nativeDetails: details)
    )
  }

  @Test
  func fallbackRejectsNativeDetailsFromAReusedProcessID() {
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
        == .fallback(detection, nativeDetails: nil)
    )
  }

  @Test
  func fallbackRejectsNativeDetailsFromADifferentProcessID() {
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
        == .fallback(detection, nativeDetails: nil)
    )
  }

  @Test
  func provenProcessSelectsExactNativeAuthorityBeforeFallbackPublishes() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let exact = candidate(
      agent: .codex,
      processIdentities: [identity],
      authority: [identity]
    )
    let competitor = candidate(agent: .claude, processIdentities: [identity])
    let store = TerminalAgentDetectionStore()

    #expect(
      store.resolve(
        for: surfaceID,
        nativeCandidates: [competitor, exact],
        provenProcessIdentity: identity
      ) == .native([exact])
    )
  }

  @Test
  func provenProcessKeepsExactNativeAuthorityAfterFallbackClears() {
    let surfaceID = UUID()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 2)
    let detection = observation(processIdentity: identity)
    let exact = candidate(
      agent: .codex,
      processIdentities: [identity],
      authority: [identity]
    )
    let competitor = candidate(agent: .claude, processIdentities: [identity])
    var store = TerminalAgentDetectionStore()
    let applied = store.apply(detection, for: surfaceID)

    #expect(applied)
    #expect(
      store.resolve(for: surfaceID, nativeCandidates: [competitor, exact])
        == .native([exact])
    )
    let cleared = store.clear(for: surfaceID)
    #expect(cleared)
    #expect(
      store.resolve(
        for: surfaceID,
        nativeCandidates: [competitor, exact],
        provenProcessIdentity: identity
      ) == .native([exact])
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
  @MainActor
  func pureFallbackFeedsSidebarPanelWorkspaceAndPortRootsWithoutNativeState() throws {
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
  func idleFallbackRemainsVisibleAsMutedAgentActivity() throws {
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
  func fallbackUsesAuthorityFreeNativeDetailsWithoutNativeActions() throws {
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
    #expect(host.agentActivity(for: tabID) == .codex(.needsInput, detail: "Native detail"))
    #expect(panel.progressRows == [plan])
    #expect(panel.session == nil)
  }

  @Test
  @MainActor
  func exactNativeAuthorityWinsEvenWhenDetectionNamesAnotherAgent() throws {
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
    let detection = observation(
      agentID: "custom-agent",
      displayName: "Custom Agent",
      processIdentity: identity,
      phase: .needsInput
    )

    let appliedDetection = host.applyAgentDetection(detection, for: surfaceID)

    #expect(appliedNative)
    #expect(appliedDetection)
    #expect(host.agentActivity(for: tabID) == .codex(.running, detail: "Native detail"))
    #expect(host.agentPanelPresentation(for: surfaceID)?.session?.sessionID == "native-session")
  }

  @Test
  @MainActor
  func commandAndSurfaceCleanupRemoveFallbackWithoutPersistingIt() throws {
    let fixture = try hostFixture()
    let host = fixture.host
    let surfaceID = fixture.surfaceID
    let detection = observation(
      processIdentity: TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    )
    _ = host.applyAgentDetection(detection, for: surfaceID)

    host.handleCommandFinished(for: surfaceID)

    #expect(fallbackObservation(in: host, for: surfaceID) == nil)
    #expect(host.agentStateRecords(for: surfaceID).isEmpty)

    _ = host.applyAgentDetection(detection, for: surfaceID)
    host.performCloseSurface(surfaceID)

    #expect(fallbackObservation(in: host, for: surfaceID) == nil)
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
    processIdentities: Set<TerminalAgentProcessIdentity>,
    authority: Set<TerminalAgentProcessIdentity> = []
  ) -> TerminalAgentDetectionNativeCandidate {
    TerminalAgentDetectionNativeCandidate(
      presentation: TerminalAgentStatePresentation(
        agent: agent,
        sessionID: "native-\(agent.rawValue)",
        phase: .running,
        detail: "Native detail",
        hoverMessages: [],
        isActionable: true,
        progressRows: [],
        activeChildren: [],
        turnLifecycle: .active("turn-1"),
        workingDirectoryPath: nil
      ),
      revision: 1,
      processIdentities: processIdentities,
      authorityProcessIdentities: authority
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
      hoverMessages: [],
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
    let host = TerminalHostState()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    return HostFixture(
      host: host,
      tabID: try #require(host.selectedTabID),
      surfaceID: try #require(host.selectedSurfaceView?.id)
    )
  }
}
