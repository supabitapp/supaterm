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
        action: .sessionStarted
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
        action: .subagentStarted(role: "reviewer")
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
          action: .sessionStarted
        )
      )
    }
    store.apply(
      event(
        sessionID: "background",
        turnID: "child-turn",
        subagentID: "child-1",
        context: context,
        action: .subagentStarted(role: "reviewer")
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
        action: .subagentStarted(role: "reviewer")
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
        action: .progressUpdated(.replace([rootRow]))
      )
    )
    store.apply(
      event(
        sessionID: "session-1",
        turnID: "turn-1",
        subagentID: "child-1",
        context: context,
        action: .progressUpdated(.replace([childRow]))
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
      TerminalAgentEvent.Action.subagentStarted(role: "reviewer"),
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
      TerminalAgentEvent.Action.subagentStarted(role: "reviewer"),
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
      TerminalAgentEvent.Action.subagentStarted(role: "reviewer"),
      .subagentStopped,
      .subagentStarted(role: "reviewer"),
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
      TerminalAgentEvent.Action.subagentStarted(role: "reviewer"),
      .attentionRequested(requestID: nil, message: "Approve"),
      .subagentStarted(role: "reviewer"),
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
          action: .subagentStarted(role: "reviewer")
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
        action: .subagentStarted(role: "reviewer")
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
  func reconciledChildrenKeepOnlyLiveSubagents() throws {
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
      event(agent: .claude, sessionID: "session-1", context: context, action: .turnStarted)
    )
    for subagentID in ["child-live", "child-lost"] {
      store.apply(
        event(
          agent: .claude,
          sessionID: "session-1",
          subagentID: subagentID,
          context: context,
          action: .subagentStarted(role: "general-purpose")
        )
      )
    }
    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .subagentsReconciled(
          liveSubagentIDs: ["child-live"],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        )
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .claude))
    #expect(presentation.activeChildren.map(\.subagentID) == ["child-live"])
    #expect(presentation.phase == .running)
  }

  @Test
  func reconciliationKeepsWorkflowChildrenOnlyWhileAWorkflowRuns() throws {
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
    for child in [
      (subagentID: "workflow-child", kind: TerminalAgentChildKind.workflow, role: "workflow-subagent"),
      (subagentID: "plain-child", kind: TerminalAgentChildKind.subagent, role: "general-purpose"),
    ] {
      store.apply(
        event(
          agent: .claude,
          sessionID: "session-1",
          subagentID: child.subagentID,
          context: context,
          action: .subagentStarted(
            kind: child.kind,
            role: child.role
          )
        )
      )
    }

    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: true
        )
      )
    )

    #expect(
      store.presentation(for: surfaceID, agent: .claude)?
        .activeChildren.map(\.subagentID) == ["workflow-child"]
    )

    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        )
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .claude)?.activeChildren.isEmpty == true)
  }

  @Test
  func reconciliationKeepsUnknownChildrenWhileATeammateRuns() throws {
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
        subagentID: "athermo-risk-1",
        context: context,
        action: .subagentStarted(
          kind: .unknown,
          role: "thermo-risk"
        )
      )
    )
    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: true,
          hasActiveWorkflow: false
        )
      )
    )

    #expect(
      store.presentation(for: surfaceID, agent: .claude)?
        .activeChildren.map(\.subagentID) == ["athermo-risk-1"]
    )

    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        context: context,
        action: .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        )
      )
    )

    #expect(store.presentation(for: surfaceID, agent: .claude)?.activeChildren.isEmpty == true)
  }

  @Test
  func reconciledRestoredSessionDropsChildWhoseStopWasMissed() throws {
    let surfaceID = UUID()
    var store = TerminalAgentStateStore(processIdentity: testProcessIdentity)
    store.restore([
      TerminalAgentStateSnapshot(
        agent: .claude,
        sessionID: "session-1",
        surfaceID: surfaceID,
        processes: [TerminalAgentProcessIdentity(processID: 7, startTimeMicroseconds: 7)],
        turnLifecycle: .completed(nil),
        turnStartedAt: nil,
        phase: .idle,
        detail: nil,
        attentionRequestID: nil,
        latestResponse: nil,
        isActionable: false,
        progressRows: [],
        activeChildren: [
          TerminalAgentActiveChild(
            id: TerminalAgentActiveChild.Identity(
              subagentID: "child-lost",
              sessionID: "session-1",
              turnID: nil
            ),
            role: "general-purpose",
            phase: .running,
            detail: nil
          )
        ],
        hasPendingBackgroundWork: false,
        isForeground: true,
        revision: 1,
        workingDirectoryPath: nil
      )
    ])
    #expect(store.presentation(for: surfaceID, agent: .claude)?.phase == .running)
    #expect(store.presentation(for: surfaceID, agent: .claude)?.turnStartedAt != nil)

    store.apply(
      event(
        agent: .claude,
        sessionID: "session-1",
        action: .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        )
      )
    )

    let presentation = try #require(store.presentation(for: surfaceID, agent: .claude))
    #expect(presentation.activeChildren.isEmpty)
    #expect(presentation.phase == .idle)
    #expect(presentation.turnStartedAt == nil)
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
        action: .subagentStarted(role: "reviewer")
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
