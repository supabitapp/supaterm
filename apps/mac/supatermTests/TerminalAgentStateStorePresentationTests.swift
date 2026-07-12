import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
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
        action: .progressUpdated([row])
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.progressRows == [row])
  }

  @Test
  func transcriptGoalDoesNotReplaceNativePlan() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let goal = PaneAgentProgressRow(
      id: "goal",
      title: "Goal: Ship",
      status: .running,
      kind: .goal
    )
    let task = PaneAgentProgressRow(id: "task", title: "Implement", status: .running)

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated([task], source: .nativePlan)
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated([goal], source: .transcript)
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex)?.progressRows == [goal, task])
  }

  @Test
  func clearingTranscriptProgressPreservesNativePlan() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let task = PaneAgentProgressRow(id: "task", title: "Implement", status: .running)

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated([task], source: .nativePlan)
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated([], source: .transcript)
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex)?.progressRows == [task])
  }

  @Test
  func hoverAndActionabilityBelongToSessionState() throws {
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

    #expect(store.presentation(for: surfaceID, agent: .codex)?.isActionable == false)

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
        context: context,
        action: .hoverMessagesUpdated(["Inspecting", "Implementing"])
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.isActionable)
    #expect(presentation.hoverMessages == ["Inspecting", "Implementing"])
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
          action: .sessionResumed(transcriptPath: nil)
        )
      )
    }

    #expect(store.snapshots(for: surfaceID).first?.processIDs == Set([42, 43]))
    let changedSurfaceIDs = store.pruneDeadProcesses(
      isProcessCurrent: { process in
        process == TerminalAgentProcessIdentity(processID: 43, startTimeMicroseconds: 43)
      },
      didClearSession: { _, _ in }
    )
    #expect(changedSurfaceIDs == [surfaceID])
    #expect(store.snapshots(for: surfaceID).first?.processIDs == Set([43]))
  }

}
