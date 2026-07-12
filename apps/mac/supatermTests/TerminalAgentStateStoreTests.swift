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
        action: .sessionStarted(transcriptPath: nil)
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
          action: .sessionStarted(transcriptPath: nil)
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
  func foregroundTurnCompletionBecomesIdle() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted(transcriptPath: nil)
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
  func staleTurnCompletionCannotClearNewerTurn() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted(transcriptPath: nil)
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
        action: .progressUpdated([
          PaneAgentProgressRow(id: "late", title: "Late plan", status: .running)
        ])
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
        action: .sessionStarted(transcriptPath: nil)
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
  func unscopedNativeTurnAdoptsTranscriptTurnID() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted(transcriptPath: nil)
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
        action: .turnRunning(detail: "Transcript detail")
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
        action: .sessionStarted(transcriptPath: nil)
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
