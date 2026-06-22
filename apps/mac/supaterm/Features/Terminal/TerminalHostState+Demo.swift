#if SUPATERM_DEMO
  import Foundation
  import SupatermCLIShared
  import SupatermTerminalAgentPanelFeature

  extension TerminalHostState {
    func demoInjectRunningAgent(
      kind: SupatermAgentKind,
      surfaceID: UUID,
      detail: String,
      sessionID: String?
    ) {
      demoInjectAgent(
        kind: kind,
        phase: .running,
        surfaceID: surfaceID,
        detail: detail,
        sessionID: sessionID
      )
    }

    func demoInjectNeedsInputAgent(
      kind: SupatermAgentKind,
      surfaceID: UUID,
      detail: String,
      sessionID: String?
    ) {
      demoInjectAgent(
        kind: kind,
        phase: .needsInput,
        surfaceID: surfaceID,
        detail: detail,
        sessionID: sessionID
      )
    }

    func demoInjectPanelMetadata(surfaceID: UUID) {
      guard tabID(containing: surfaceID) != nil else { return }
      storePaneAgentMetadata(.demoRichPanel, for: surfaceID)
    }

    func demoInjectNotification(surfaceID: UUID) {
      guard tabID(containing: surfaceID) != nil else { return }
      notificationStore.append(
        PaneNotification(
          attentionState: .unread,
          body: "Deploy preview is ready for approval.",
          createdAt: Date(),
          title: "Approval needed",
          origin: .structuredAgent(.attention)
        ),
        for: surfaceID
      )
    }

    private func demoInjectAgent(
      kind: SupatermAgentKind,
      phase: AgentActivityPhase,
      surfaceID: UUID,
      detail: String,
      sessionID: String?
    ) {
      setAgentPresenceActivity(
        AgentActivity(kind: kind, phase: phase, detail: detail),
        for: surfaceID,
        sessionID: sessionID,
        processID: nil
      )
    }
  }

  extension TerminalHostState.PaneAgentMetadata {
    fileprivate static var demoRichPanel: Self {
      let now = Date()
      return Self(
        progressRows: [
          PaneAgentProgressRow(
            id: "inspect-restored-tabs",
            title: "Inspect restored tabs",
            status: .completed
          ),
          PaneAgentProgressRow(
            id: "wire-agent-badges",
            title: "Wire agent badges",
            status: .running
          ),
          PaneAgentProgressRow(
            id: "run-sidebar-checks",
            title: "Run sidebar checks",
            status: .pending
          ),
        ],
        branchDetails: PaneAgentBranchDetails(
          branchName: "feat/agent-panel-state",
          addedLineCount: 120,
          removedLineCount: 18,
          pullRequestStatus: PaneAgentPullRequestStatus(
            kind: .open,
            title: "PR #42 Agent panel state",
            url: URL(string: "https://supaterm.com"),
            addedLineCount: 120,
            removedLineCount: 18,
            checks: PaneAgentPullRequestChecks(
              status: .passing,
              totalCount: 3,
              items: [
                PaneAgentPullRequestCheck(
                  name: "Build",
                  state: .success,
                  workflowName: "macOS",
                  startedAt: now.addingTimeInterval(-540),
                  completedAt: now.addingTimeInterval(-420)
                ),
                PaneAgentPullRequestCheck(
                  name: "Tests",
                  state: .success,
                  workflowName: "macOS",
                  startedAt: now.addingTimeInterval(-420),
                  completedAt: now.addingTimeInterval(-180)
                ),
                PaneAgentPullRequestCheck(
                  name: "Preview",
                  state: .success,
                  workflowName: "Deploy",
                  startedAt: now.addingTimeInterval(-180),
                  completedAt: now.addingTimeInterval(-60)
                ),
              ]
            )
          )
        ),
        artifacts: [
          PaneAgentArtifact(
            title: "localhost:3000",
            url: URL(string: "http://localhost:3000")!
          )
        ]
      )
    }
  }
#endif
