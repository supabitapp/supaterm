import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
  @Test
  func workingDurationTracksOneContinuousTurn() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    let firstStart = Date(timeIntervalSinceReferenceDate: 10_000)
    var currentDate = firstStart
    var store = TerminalAgentStateStore(now: { currentDate })

    store.apply(event(sessionID: "session-1", context: context, action: .sessionStarted))
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnStarted
      )
    )
    #expect(store.presentation(for: surfaceID, agent: .codex)?.turnStartedAt == firstStart)

    currentDate = firstStart.addingTimeInterval(300)
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionRequested(requestID: "approval", message: "Approve")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionResolved(requestID: "approval")
      )
    )
    #expect(store.presentation(for: surfaceID, agent: .codex)?.turnStartedAt == firstStart)

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnCompleted(message: nil)
      )
    )
    #expect(store.presentation(for: surfaceID, agent: .codex)?.turnStartedAt == nil)

    let secondStart = firstStart.addingTimeInterval(600)
    currentDate = secondStart
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-2",
        context: context,
        action: .turnStarted
      )
    )
    #expect(store.presentation(for: surfaceID, agent: .codex)?.turnStartedAt == secondStart)
  }

  @Test
  func attentionMarksForegroundTurnAsNeedingInput() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionRequested(requestID: nil, message: "Choose a path")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .needsInput)
    #expect(presentation.detail == "Choose a path")
  }

  @Test
  func runningActivityUpdatesForegroundDetail() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .turnRunning(detail: "Bash")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .running)
    #expect(presentation.detail == "Bash")
  }

  @Test
  func runningCannotClearAttentionWithoutResolution() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let scope = (sessionID: "session-1", turnID: "turn-1")

    store.apply(
      event(
        sessionID: scope.sessionID,
        turnID: scope.turnID,
        context: context,
        action: .attentionRequested(requestID: "tool-a", message: "Approve command")
      )
    )
    store.apply(
      event(
        sessionID: scope.sessionID,
        turnID: scope.turnID,
        context: context,
        action: .turnRunning(detail: "Bash")
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex)?.phase == .needsInput)

    store.apply(
      event(
        sessionID: scope.sessionID,
        turnID: scope.turnID,
        context: context,
        action: .attentionResolved(requestID: "tool-a")
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex)?.phase == .running)
  }

  @Test
  func unrelatedToolCompletionCannotResolvePendingAttention() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionRequested(requestID: "tool-a", message: "Approve command")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionResolved(requestID: "tool-b")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .needsInput)
    #expect(presentation.detail == "Approve command")
  }

  @Test
  func foregroundTurnOwnsVisibleProgress() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let row = PaneAgentProgressRow(
      id: "0:Read state",
      title: "Read state",
      status: .running
    )

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated(.replace([row]))
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.progressRows == [row])
  }

  @Test
  func progressMutationsKeepOneRowPerTask() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for mutation in [
      TerminalAgentProgressMutation.upsert(id: "task-1", title: "Read state", status: .pending),
      .upsert(id: "task-1", title: nil, status: .running),
      .upsert(id: "task-2", title: "Run checks", status: nil),
      .remove(id: "task-1"),
    ] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          context: context,
          action: .progressUpdated(mutation)
        )
      )
    }

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(
      presentation.progressRows == [
        PaneAgentProgressRow(id: "task-2", title: "Run checks", status: .pending)
      ]
    )
  }

  @Test
  func invalidProcessIDsAreIgnoredAndStaleProcessIdentitiesArePruned() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    for processID in [Int32(-1), 0, 42, 43] {
      store.apply(
        event(
          sessionID: "session-1",
          context: context,
          processID: processID,
          action: .sessionResumed
        )
      )
    }

    #expect(store.snapshots(for: surfaceID).first?.processIDs == Set([42, 43]))
    let changedSurfaceIDs = store.pruneDeadProcesses(
      isProcessCurrent: { process in
        process == TerminalAgentProcessIdentity(processID: 43, startTimeMicroseconds: 43)
      }
    )
    #expect(changedSurfaceIDs == [surfaceID])
    #expect(store.snapshots(for: surfaceID).first?.processIDs == Set([43]))
  }

}
