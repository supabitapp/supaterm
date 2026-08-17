import CustomDump
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
  @Test
  func snapshotRestorePreservesBackgroundWork() {
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
        action: .turnContinuesInBackground
      )
    )

    var restored = TerminalAgentStateStore()
    restored.restore(store.snapshots(for: surfaceID))

    expectNoDifference(
      restored.presentation(for: surfaceID, agent: .claude),
      store.presentation(for: surfaceID, agent: .claude)
    )
    #expect(restored.hasBackgroundWork(agent: .claude, sessionID: "session-1"))
  }

  @Test
  func snapshotRestorePreservesForegroundStateAndRouting() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)

    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        processID: 42,
        workingDirectoryPath: "/tmp/workspace",
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
        action: .attentionRequested(requestID: nil, message: "Approve command")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        processID: 43,
        action: .subagentStarted(role: "reviewer")
      )
    )

    var restored = TerminalAgentStateStore()
    let snapshots = store.snapshots(for: surfaceID)
    restored.restore(snapshots)

    #expect(snapshots.first?.processIDs == Set([42, 43]))
    #expect(restored.snapshots(for: surfaceID).first?.workingDirectoryPath == "/tmp/workspace/")
    #expect(
      restored.presentation(for: surfaceID, agent: .codex)
        == store.presentation(for: surfaceID, agent: .codex)
    )
    #expect(restored.isForeground(agent: .codex, sessionID: "session-1"))
    #expect(restored.surfaceID(agent: .codex, sessionID: "session-1") == surfaceID)
  }

  @Test
  func newSessionResetsPriorState() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let row = PaneAgentProgressRow(id: "plan", title: "Plan", status: .running)

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionRequested(requestID: nil, message: "Approve")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        workingDirectoryPath: "/tmp/old-workspace",
        action: .turnRunning(detail: nil)
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated(.replace([row]))
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(role: "reviewer")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionStarted
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .idle)
    #expect(presentation.detail == nil)
    #expect(presentation.progressRows.isEmpty)
    #expect(presentation.activeChildren.isEmpty)
    #expect(store.snapshots(for: surfaceID).first?.turnLifecycle == .unseen)
    #expect(store.snapshots(for: surfaceID).first?.workingDirectoryPath == nil)
  }

  @Test
  func resumedSessionPreservesActiveState() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let row = PaneAgentProgressRow(id: "plan", title: "Plan", status: .running)

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .attentionRequested(requestID: nil, message: "Approve")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated(.replace([row]))
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(role: "reviewer")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        context: context,
        action: .sessionResumed
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .needsInput)
    #expect(presentation.detail == "Approve")
    #expect(presentation.progressRows == [row])
    #expect(presentation.activeChildren.map(\.subagentID) == ["child-1"])
    #expect(store.snapshots(for: surfaceID).first?.turnLifecycle == .active("turn-1"))
  }

  @Test
  func clearingSurfaceDropsEveryBoundSession() {
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

    store.clearSessions(for: surfaceID)

    #expect(store.snapshots(for: surfaceID).isEmpty)
    #expect(store.presentation(for: surfaceID, agent: .codex) == nil)
  }

}
