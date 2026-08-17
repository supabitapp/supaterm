import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentStateStoreTests {
  struct StartedStore {
    let surfaceID: UUID
    let context: SupatermCLIContext
    let store: TerminalAgentStateStore
  }

  @Test
  func foregroundSessionEndClearsPresentation() {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionEnded
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex) == nil)
  }

  @Test
  func staleSessionEndCannotClearNewerForeground() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    for sessionID in ["older", "foreground"] {
      store.apply(
        event(
          sessionID: sessionID,
          context: context,
          action: .sessionStarted
        )
      )
    }
    store.apply(
      event(
        sessionID: "older",
        context: context,
        action: .sessionEnded
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.sessionID == "foreground")
  }

  @Test
  func boundSessionRejectsRootAndChildEventsFromAnotherSurface() {
    let boundSurfaceID = UUID()
    let otherSurfaceID = UUID()
    let tabID = UUID()
    let boundContext = SupatermCLIContext(surfaceID: boundSurfaceID, tabID: tabID)
    let otherContext = SupatermCLIContext(surfaceID: otherSurfaceID, tabID: tabID)
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)
    let started = store.apply(
      event(
        sessionID: "session-1",
        context: boundContext,
        processID: 42,
        action: .sessionStarted
      )
    )
    let turnStarted = store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: boundContext,
        action: .turnStarted
      )
    )
    let childStarted = store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: boundContext,
        processID: 43,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )
    let before = store.snapshots(for: boundSurfaceID)
    let authority = store.nativeHookAuthorityProcessIdentities(for: boundSurfaceID)

    let acceptedRoot = store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: otherContext,
        processID: 44,
        action: .turnRunning(detail: "Wrong pane")
      )
    )
    let acceptedChild = store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: otherContext,
        processID: 45,
        action: .attentionRequested(requestID: "wrong", message: "Wrong pane")
      )
    )

    #expect(started)
    #expect(turnStarted)
    #expect(childStarted)
    #expect(!acceptedRoot)
    #expect(!acceptedChild)
    #expect(store.snapshots(for: boundSurfaceID) == before)
    #expect(store.snapshots(for: otherSurfaceID).isEmpty)
    #expect(store.nativeHookAuthorityProcessIdentities(for: boundSurfaceID) == authority)
    #expect(store.nativeHookAuthorityProcessIdentities(for: otherSurfaceID).isEmpty)
  }

  @Test
  func sessionStartExplicitlyRebindsAKnownSession() throws {
    let firstSurfaceID = UUID()
    let secondSurfaceID = UUID()
    let tabID = UUID()
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)
    let firstStart = store.apply(
      event(
        sessionID: "session-1",
        context: SupatermCLIContext(surfaceID: firstSurfaceID, tabID: tabID),
        processID: 42,
        action: .sessionStarted
      )
    )
    let secondStart = store.apply(
      event(
        sessionID: "session-1",
        context: SupatermCLIContext(surfaceID: secondSurfaceID, tabID: tabID),
        processID: 43,
        action: .sessionStarted
      )
    )

    #expect(firstStart)
    #expect(secondStart)
    #expect(store.surfaceID(agent: .codex, sessionID: "session-1") == secondSurfaceID)
    #expect(store.snapshots(for: firstSurfaceID).isEmpty)
    #expect(store.snapshots(for: secondSurfaceID).count == 1)
    #expect(store.presentation(for: firstSurfaceID, agent: .codex) == nil)
    #expect(store.presentation(for: secondSurfaceID, agent: .codex)?.sessionID == "session-1")
    #expect(store.nativeHookAuthorityProcessIdentities(for: firstSurfaceID).isEmpty)
    #expect(
      store.nativeHookAuthorityProcessIdentities(for: secondSurfaceID)
        == [try #require(testProcessIdentity(43))]
    )
  }

  @Test
  func foregroundTurnCompletionBecomesIdle() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnCompleted(message: "Done")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .idle)
  }

  @Test
  func rootWorkingDirectoryTracksLatestReportedPath() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        workingDirectoryPath: "/tmp/first/child/..",
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .turnStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        workingDirectoryPath: "/tmp/child",
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )

    #expect(store.snapshots(for: surfaceID).first?.workingDirectoryPath == "/tmp/first/")

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        workingDirectoryPath: "/tmp/second",
        action: .turnRunning(detail: nil)
      )
    )

    #expect(store.snapshots(for: surfaceID).first?.workingDirectoryPath == "/tmp/second/")
  }

  @Test
  func staleTurnCompletionCannotClearNewerTurn() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    for turnID in ["older", "current"] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: turnID,
          context: context,
          action: .turnStarted
        )
      )
    }
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "older",
        context: context,
        action: .turnCompleted(message: nil)
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .running)
  }

  @Test
  func completedTurnRejectsLateActivity() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnCompleted(message: "Done")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnRunning(detail: "Late tool")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated(
          .replace([
            PaneAgentProgressRow(id: "late", title: "Late plan", status: .running)
          ]))
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .idle)
    #expect(presentation.progressRows.isEmpty)
  }

  @Test
  func completedNilIDTurnRejectsLateNilIDActivity() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .turnStarted
      )
    )
    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .turnCompleted(message: "Done")
      )
    )
    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .turnRunning(detail: "Late tool")
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .claude)?.phase == .idle)
    #expect(store.snapshots(for: surfaceID).first?.turnLifecycle == .completed(nil))
  }

  @Test
  func latestNativeRootActivityBecomesForeground() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "recovered",
        turnID: "turn-1",
        context: context,
        action: .turnRunning(detail: "Bash")
      )
    )
    store.apply(
      event(
        sessionID: "background",
        turnID: "turn-1",
        context: context,
        action: .turnRunning(detail: "Read")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.sessionID == "background")
  }

  @Test
  func rootTurnStartBecomesForeground() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnStarted
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.sessionID == "session-1")
    #expect(presentation.phase == .running)
  }

  @Test
  func unscopedHookTurnAdoptsScopedTurnID() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .turnStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnRunning(detail: "Scoped hook detail")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .turnRunning(detail: "Native hook detail")
      )
    )

    let snapshot = try #require(store.snapshots(for: surfaceID).first)
    #expect(snapshot.turnLifecycle == .active("turn-1"))
    #expect(snapshot.detail == "Native hook detail")
  }

  func event(
    agent: SupatermAgentKind = .codex,
    sessionID: String,
    turnID: String? = nil,
    subagentID: String? = nil,
    context: SupatermCLIContext? = nil,
    processID: Int32? = nil,
    workingDirectoryPath: String? = nil,
    action: TerminalAgentEvent.Action
  ) -> TerminalAgentEvent {
    TerminalAgentEvent(
      scope: TerminalAgentEvent.Scope(
        agent: agent,
        sessionID: sessionID,
        turnID: turnID,
        subagentID: subagentID
      ),
      context: context,
      processID: processID,
      workingDirectoryPath: workingDirectoryPath,
      action: action
    )
  }

  func testProcessIdentity(_ processID: Int32) -> TerminalAgentProcessIdentity? {
    guard processID > 0 else { return nil }
    return TerminalAgentProcessIdentity(
      processID: processID,
      startTimeMicroseconds: UInt64(processID)
    )
  }

  func startedStore() -> StartedStore {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnStarted
      )
    )
    return StartedStore(surfaceID: surfaceID, context: context, store: store)
  }
}
