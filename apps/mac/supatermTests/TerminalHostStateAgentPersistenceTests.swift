import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalHostStateAgentPersistenceTests {
  @Test
  func liveMismatchedContextDoesNotMutateOrReportAChange() throws {
    let (host, boundSurfaceID) = try hostFixture()
    let tabID = try #require(host.selectedTabID?.rawValue)
    let otherPane = try host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(boundSurfaceID)
      )
    )
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let started = host.startTestAgentSession(
      agent: .codex,
      for: boundSurfaceID,
      sessionID: "bound-session",
      processID: identity.processID
    )
    let before = host.agentStateStore.snapshots(for: boundSurfaceID)

    let application = host.applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: .codex, sessionID: "bound-session"),
        context: SupatermCLIContext(surfaceID: otherPane.paneID, tabID: tabID),
        processID: identity.processID,
        action: .turnRunning(detail: "Wrong pane")
      )
    )

    #expect(started)
    #expect(!application.accepted)
    #expect(!application.changed)
    #expect(host.agentStateStore.snapshots(for: boundSurfaceID) == before)
    #expect(host.agentStateStore.snapshots(for: otherPane.paneID).isEmpty)
  }

  @Test
  func deadContextCannotRebindAKnownSession() throws {
    let (host, surfaceID) = try hostFixture()
    let tabID = try #require(host.selectedTabID?.rawValue)
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let started = host.startTestAgentSession(
      agent: .codex,
      for: surfaceID,
      sessionID: "bound-session",
      processID: identity.processID
    )
    let before = host.agentStateStore.snapshots(for: surfaceID)
    let deadSurfaceID = UUID()

    let application = host.applyAgentEvent(
      TerminalAgentEvent(
        scope: TerminalAgentEvent.Scope(agent: .codex, sessionID: "bound-session"),
        context: SupatermCLIContext(surfaceID: deadSurfaceID, tabID: tabID),
        processID: identity.processID,
        action: .sessionStarted
      )
    )

    #expect(started)
    #expect(!application.accepted)
    #expect(!application.changed)
    #expect(host.agentStateSurfaceID(agent: .codex, sessionID: "bound-session") == surfaceID)
    #expect(host.agentStateStore.snapshots(for: surfaceID) == before)
    #expect(host.agentStateStore.snapshots(for: deadSurfaceID).isEmpty)
  }

  @Test
  func fallbackOnlyPruneClearsEphemeralStateWithoutReportingAPersistentChange() throws {
    let (host, surfaceID) = try hostFixture()
    let identity = TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    let applied = host.applyAgentDetection(observation(identity), for: surfaceID)

    let changedPersistentState = host.pruneDeadAgentProcesses(
      isProcessCurrent: { $0 != identity }
    )

    #expect(applied)
    #expect(!changedPersistentState)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
  }

  @Test
  func nativePruneReportsAPersistentChange() throws {
    let (host, surfaceID) = try hostFixture()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .codex(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )

    let changedPersistentState = host.pruneDeadAgentProcesses(
      isProcessCurrent: { $0 != identity }
    )

    #expect(applied)
    #expect(changedPersistentState)
  }

  @Test
  func fallbackOnlyClearRemovesEphemeralStateWithoutReportingAPersistentChange() throws {
    let (host, surfaceID) = try hostFixture()
    let detection = observation(
      TerminalAgentProcessIdentity(processID: 42, startTimeMicroseconds: 1)
    )
    let applied = host.applyAgentDetection(detection, for: surfaceID)

    let changedPersistentState = host.clearAgentState(for: surfaceID)

    #expect(applied)
    #expect(!changedPersistentState)
    #expect(terminalObservation(in: host, for: surfaceID) == nil)
  }

  @Test
  func nativeClearReportsAPersistentChange() throws {
    let (host, surfaceID) = try hostFixture()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    let applied = host.applyTestAgentActivity(
      .codex(.running),
      for: surfaceID,
      sessionID: "native-session",
      processID: identity.processID
    )

    let changedPersistentState = host.clearAgentState(for: surfaceID)

    #expect(applied)
    #expect(changedPersistentState)
    #expect(host.agentStateRecords(for: surfaceID).isEmpty)
  }

  @Test
  func commandFinishPreservesRestoredAgentWithCurrentProcess() throws {
    let (host, surfaceID) = try hostFixture()
    let identity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    host.restoreAgentState(
      [
        TerminalPaneAgentRecord(
          agent: .codex,
          sessionID: "restored-session",
          processes: [identity],
          turnLifecycle: .active("turn-1"),
          phase: .running,
          isForeground: true,
          revision: 1
        )
      ],
      for: surfaceID
    )

    host.handleCommandFinished(for: surfaceID)

    #expect(host.hasAgentSession(agent: .codex, sessionID: "restored-session"))
    #expect(host.agentStateRecords(for: surfaceID).count == 1)
  }

  private func observation(
    _ identity: TerminalAgentProcessIdentity
  ) -> TerminalAgentDetectionObservation {
    TerminalAgentDetectionObservation(
      agent: AgentDetectionAgentIdentity(id: "codex", displayName: "Codex"),
      phase: .running,
      processIdentity: identity,
      ruleID: "running",
      generation: 7,
      sequence: 1
    )
  }

  private func hostFixture() throws -> (TerminalHostState, UUID) {
    initializeGhosttyForTests()
    let host = TerminalHostState.test()
    host.ensureInitialTab(focusing: false, startupCommand: nil)
    return (host, try #require(host.selectedSurfaceView?.id))
  }
}
