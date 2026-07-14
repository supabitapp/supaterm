import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

extension TerminalAgentStateStoreTests {
  @Test
  func childActivityNeverReplacesForegroundRoot() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "root-session",
        context: context,
        action: .sessionStarted(transcriptPath: nil)
      )
    )
    store.apply(
      event(
        sessionID: "root-session",
        turnID: "turn-1",
        context: context,
        action: .turnStarted
      )
    )
    store.apply(
      event(
        sessionID: "root-session",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.sessionID == "root-session")
    #expect(
      presentation.activeChildren == [
        TerminalAgentActiveChild(
          id: TerminalAgentActiveChild.Identity(
            subagentID: "child-1",
            sessionID: "root-session",
            turnID: "turn-1"
          ),
          nickname: nil,
          role: "reviewer",
          phase: .running,
          detail: nil
        )
      ]
    )
  }

  @Test
  func backgroundChildCannotMutateForegroundRoot() throws {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    for sessionID in ["background", "foreground"] {
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
        sessionID: "background",
        turnID: "child-turn",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.sessionID == "foreground")
    #expect(presentation.activeChildren.isEmpty)
    #expect(
      store.snapshots(for: surfaceID)
        .first(where: { $0.sessionID == "background" })?
        .activeChildren.map(\.subagentID) == ["child-1"]
    )
  }

  @Test
  func unknownChildCannotCreateOrPromoteRootState() {
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())
    var store = TerminalAgentStateStore()

    store.apply(
      event(
        sessionID: "missing-root",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )

    #expect(store.snapshots(for: surfaceID).isEmpty)
    #expect(store.presentation(for: surfaceID, agent: .codex) == nil)
  }

  @Test
  func childProgressCannotOverwriteForegroundProgress() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let rootRow = PaneAgentProgressRow(
      id: "root",
      title: "Root task",
      status: .running
    )
    let childRow = PaneAgentProgressRow(
      id: "child",
      title: "Child task",
      status: .running
    )

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .progressUpdated([rootRow])
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .progressUpdated([childRow])
      )
    )

    #expect(
      store.presentation(for: surfaceID, agent: .codex)?.progressRows == [rootRow]
    )
  }

  @Test
  func stoppedChildLeavesActiveChildren() {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for action in [
      TerminalAgentEvent.Action.subagentStarted(nickname: nil, role: "reviewer"),
      .subagentStopped,
    ] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          subagentID: "child-1",
          context: context,
          action: action
        )
      )
    }

    #expect(store.presentation(for: surfaceID, agent: .codex)?.activeChildren.isEmpty == true)
  }

  @Test
  func lateScopedActivityCannotReactivateStoppedChild() {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for action in [
      TerminalAgentEvent.Action.subagentStarted(nickname: nil, role: "reviewer"),
      .subagentStopped,
      .turnRunning(detail: "Late tool event"),
    ] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          subagentID: "child-1",
          context: context,
          action: action
        )
      )
    }

    #expect(store.presentation(for: surfaceID, agent: .codex)?.activeChildren.isEmpty == true)
  }

  @Test
  func laterScopedActivityReactivatesStoppedChild() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for action in [
      TerminalAgentEvent.Action.subagentStarted(nickname: nil, role: "reviewer"),
      .subagentStopped,
      .subagentStarted(nickname: nil, role: "reviewer"),
      .turnRunning(detail: "Bash"),
    ] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          subagentID: "child-1",
          context: context,
          action: action
        )
      )
    }

    let child = try #require(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first
    )
    #expect(child.phase == .running)
    #expect(child.detail == "Bash")
  }

  @Test
  func repeatedChildStartPreservesAttention() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for action in [
      TerminalAgentEvent.Action.subagentStarted(nickname: nil, role: "reviewer"),
      .attentionRequested(requestID: nil, message: "Approve"),
      .subagentStarted(nickname: "Mendel", role: "reviewer"),
    ] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          subagentID: "child-1",
          context: context,
          action: action
        )
      )
    }

    #expect(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first?.phase
        == .needsInput
    )
    #expect(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first?.nickname
        == "Mendel"
    )
  }

  @Test
  func resolvedChildAttentionFallsBackToTask() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "Explore")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .subagentTasksUpdated(["child-1": "Explore UI test infrastructure"])
      )
    )
    let attentionActions: [TerminalAgentEvent.Action] = [
      .attentionRequested(requestID: "tool:Bash", message: "Approve command"),
      .attentionResolved(requestID: "tool:Bash"),
    ]
    for action in attentionActions {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: "turn-1",
          subagentID: "child-1",
          context: context,
          action: action
        )
      )
    }

    let child = try #require(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first
    )
    #expect(child.phase == .running)
    #expect(child.detail == nil)
    #expect(child.displayDetail == "Explore UI test infrastructure")
  }

  @Test
  func childTaskProjectionWaitsForChildAndClearsMissingTasks() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .subagentTasksUpdated(["child-1": "Explore UI test infrastructure"])
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "Explore")
      )
    )

    #expect(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first?.task
        == "Explore UI test infrastructure"
    )

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        context: context,
        action: .subagentTasksUpdated([:])
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .codex)?.activeChildren.first?.task == nil)
  }

  @Test
  func staleChildStopCannotRemoveNewerChildScope() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    for turnID in ["turn-1", "turn-2"] {
      store.apply(
        event(
          sessionID: "session-1",
          turnID: turnID,
          subagentID: "child-1",
          context: context,
          action: .subagentStarted(nickname: nil, role: "reviewer")
        )
      )
    }
    #expect(
      store.presentation(for: surfaceID, agent: .codex)?.activeChildren.map(\.turnID)
        == ["turn-2"]
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStopped
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.activeChildren.map(\.turnID) == ["turn-2"])
  }

  @Test
  func newRootTurnDropsChildrenFromPriorTurns() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store

    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-2",
        context: context,
        action: .turnStarted
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.activeChildren.isEmpty)
  }

  @Test
  func childAttentionOutranksRootRunning() throws {
    let fixture = startedStore()
    let surfaceID = fixture.surfaceID
    let context = fixture.context
    var store = fixture.store
    let scope = (sessionID: "session-1", turnID: "turn-1", childID: "child-1")

    store.apply(
      event(
        sessionID: scope.sessionID,
        turnID: scope.turnID,
        subagentID: scope.childID,
        context: context,
        action: .subagentStarted(nickname: nil, role: "reviewer")
      )
    )
    store.apply(
      event(
        sessionID: scope.sessionID,
        turnID: scope.turnID,
        subagentID: scope.childID,
        context: context,
        action: .attentionRequested(requestID: nil, message: "Approve review command")
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .codex))
    #expect(presentation.phase == .needsInput)
    #expect(presentation.detail == "Approve review command")
    #expect(presentation.activeChildren.first?.phase == .needsInput)
  }

}
