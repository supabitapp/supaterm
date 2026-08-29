import AppKit
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCommandExecutorAgentHookTests {
  @Test(arguments: [SupatermAgentKind.claude, .codex])
  func sessionStartStoresActionableIdentityWithoutActivity(agent: SupatermAgentKind) throws {
    let harness = try makeClaudeHookHarness()
    let sessionID = "session-1"

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: agent,
        sessionID: sessionID,
        hookEventName: .sessionStart,
        context: harness.context,
        processID: getpid()
      )
    )

    #expect(harness.host.hasAgentSession(agent: agent, sessionID: sessionID))
    #expect(
      harness.host.agentStateStore.snapshots(for: harness.context.surfaceID).first?.isActionable
        == true
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
  }

  @Test
  func contextlessCodexSessionStartFindsUniqueDetectedPaneInWorkspace() throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    let processIdentity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    #expect(
      harness.host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: processIdentity,
          sequence: 1
        ),
        for: surface.id
      )
    )

    let candidates = harness.commandExecutor.agentHookCandidates(
      for: agentHookRequest(
        agent: .codex,
        sessionID: "contextless-session",
        hookEventName: .sessionStart,
        cwd: FileManager.default.currentDirectoryPath
      )
    )

    #expect(
      candidates
        == SupatermAgentHookCandidates(
          candidates: [
            SupatermAgentHookCandidate(
              context: SupatermCLIContext(surfaceID: surface.id, tabID: harness.tabID.rawValue),
              processID: processIdentity.processID
            )
          ]
        )
    )
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "contextless-session"))
  }

  @Test
  func contextlessCodexSessionStartFindsProcessWorkingDirectory() throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    let processIdentity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    surface.bridge.state.pwd = "/tmp/other-workspace"
    #expect(
      harness.host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: processIdentity,
          sequence: 1
        ),
        for: surface.id
      )
    )

    let candidates = harness.commandExecutor.agentHookCandidates(
      for: agentHookRequest(
        agent: .codex,
        sessionID: "contextless-session",
        hookEventName: .sessionStart,
        cwd: FileManager.default.currentDirectoryPath
      )
    )

    #expect(candidates.candidates.count == 1)
    #expect(candidates.candidates.first?.context.surfaceID == surface.id)
  }

  @Test
  func contextlessCodexSessionStartRejectsAmbiguousWorkspace() throws {
    let harness = try makeClaudeHookHarness()
    let firstSurface = try #require(harness.host.selectedSurfaceView)
    let secondPane = try harness.host.createPane(
      TerminalCreatePaneRequest(
        startupCommand: nil,
        direction: .right,
        focus: false,
        equalize: true,
        target: .pane(firstSurface.id)
      )
    )
    let secondSurface = try #require(harness.host.surfaces[secondPane.paneID])
    let processIdentity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    for (sequence, surface) in [firstSurface, secondSurface].enumerated() {
      #expect(
        harness.host.applyAgentDetection(
          agentDetectionObservation(
            phase: .idle,
            processIdentity: processIdentity,
            sequence: UInt64(sequence + 1)
          ),
          for: surface.id
        )
      )
    }

    let candidates = harness.commandExecutor.agentHookCandidates(
      for: agentHookRequest(
        agent: .codex,
        sessionID: "contextless-session",
        hookEventName: .sessionStart,
        cwd: FileManager.default.currentDirectoryPath
      )
    )

    #expect(candidates.candidates.count == 2)
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "contextless-session"))
  }

  @Test
  func agentHookCandidatesRejectEventsThatCannotOwnACodexRootSession() throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    let processIdentity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    #expect(
      harness.host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: processIdentity,
          sequence: 1
        ),
        for: surface.id
      )
    )
    let cwd = FileManager.default.currentDirectoryPath
    let event = SupatermAgentHookEvent(
      cwd: cwd,
      hookEventName: .sessionStart,
      sessionID: "session-1",
      transcriptPath: "/tmp/session-1.jsonl"
    )
    let requests = [
      SupatermAgentHookRequest(agent: .claude, event: event),
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: event
      ),
      SupatermAgentHookRequest(
        agent: .codex,
        event: SupatermAgentHookEvent(
          cwd: cwd,
          hookEventName: .stop,
          sessionID: "session-1",
          transcriptPath: "/tmp/session-1.jsonl"
        )
      ),
      SupatermAgentHookRequest(
        agent: .codex,
        event: SupatermAgentHookEvent(
          cwd: cwd,
          hookEventName: .sessionStart,
          sessionID: "session-1"
        )
      ),
      SupatermAgentHookRequest(
        agent: .codex,
        event: SupatermAgentHookEvent(
          hookEventName: .sessionStart,
          sessionID: "session-1",
          transcriptPath: "/tmp/session-1.jsonl"
        )
      ),
    ]

    for request in requests {
      #expect(harness.commandExecutor.agentHookCandidates(for: request).candidates.isEmpty)
    }
  }

  @Test(
    arguments: [SupatermAgentKind.claude, .codex],
    [
      SupatermAgentHookEventName.notification,
      .permissionRequest,
      .postToolUse,
      .preToolUse,
      .sessionEnd,
      .stop,
      .subagentStart,
      .subagentStop,
      .userPromptSubmit,
    ])
  func nonIdentityEventHasNoEffect(
    agent: SupatermAgentKind,
    eventName: SupatermAgentHookEventName
  ) throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    let sessionID = "session-1"
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: agent,
        sessionID: sessionID,
        hookEventName: .sessionStart,
        context: harness.context,
        processID: getpid()
      )
    )
    let before = harness.host.agentStateStore.snapshots(for: harness.context.surfaceID)

    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: agent,
        sessionID: sessionID,
        hookEventName: eventName,
        context: harness.context,
        lastAssistantMessage: "Done",
        processID: getpid()
      )
    )

    #expect(harness.host.agentStateStore.snapshots(for: harness.context.surfaceID) == before)
    #expect(result.desktopNotification == nil)
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
  }

  @Test
  func newSessionStartReplacesForegroundIdentity() throws {
    let harness = try makeClaudeHookHarness()

    for sessionID in ["parent-session", "child-session"] {
      _ = try harness.commandExecutor.handleAgentHook(
        agentHookRequest(
          agent: .codex,
          sessionID: sessionID,
          hookEventName: .sessionStart,
          context: harness.context,
          processID: getpid()
        )
      )
    }

    #expect(
      harness.host.agentStateStore.foregroundSessionID(
        for: harness.context.surfaceID,
        agent: .codex
      ) == "child-session"
    )
  }

  @Test
  func ephemeralCodexSessionCannotReplacePersistedSession() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: codexSessionStartEvent(
          sessionID: "persisted-session",
          transcriptPath: "/tmp/persisted-session.jsonl"
        ),
        processID: processID
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: codexSessionStartEvent(sessionID: "ephemeral-session"),
        processID: processID
      )
    )

    #expect(
      harness.host.agentStateStore.foregroundSessionID(
        for: harness.context.surfaceID,
        agent: .codex
      ) == "persisted-session"
    )
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "ephemeral-session"))
    let session = try #require(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session
    )
    #expect(session.sessionID == "persisted-session")
    #expect(session.forkStartupCommand == .shell("codex fork persisted-session"))
  }

  @Test
  func ephemeralCodexSessionCannotBindAnEmptyPane() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: codexSessionStartEvent(sessionID: "ephemeral-session"),
        processID: getpid()
      )
    )

    #expect(harness.host.agentStateStore.snapshots(for: harness.context.surfaceID).isEmpty)
  }

  @Test
  func nestedCodexSessionCannotReplacePersistedSession() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()

    _ = try harness.commandExecutor.handleAgentHook(
      codexSessionStartRequest(
        context: harness.context,
        sessionID: "root-session",
        processID: processID
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexSessionStartRequest(
        cwd: "/tmp/codex/memories",
        context: harness.context,
        sessionID: "nested-session",
        inheritedSessionID: "root-session",
        processID: processID
      )
    )

    #expect(
      harness.host.agentStateStore.foregroundSessionID(
        for: harness.context.surfaceID,
        agent: .codex
      ) == "root-session"
    )
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "nested-session"))
    let session = try #require(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session
    )
    #expect(session.sessionID == "root-session")
    #expect(session.forkStartupCommand == .shell("codex fork root-session"))
  }

  @Test
  func nestedCodexSessionCannotBindAnEmptyPane() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      codexSessionStartRequest(
        context: harness.context,
        sessionID: "nested-session",
        inheritedSessionID: "root-session",
        processID: getpid()
      )
    )

    #expect(harness.host.agentStateStore.snapshots(for: harness.context.surfaceID).isEmpty)
  }

  @Test
  func matchingInheritedCodexSessionBindsIdentity() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      codexSessionStartRequest(
        context: harness.context,
        sessionID: "root-session",
        inheritedSessionID: "root-session",
        processID: getpid()
      )
    )

    #expect(harness.host.hasAgentSession(agent: .codex, sessionID: "root-session"))
  }

  @Test
  func persistedCodexRootCanMoveToAnotherWorkingDirectory() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()

    _ = try harness.commandExecutor.handleAgentHook(
      codexSessionStartRequest(
        context: harness.context,
        sessionID: "first-session",
        processID: processID
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: codexSessionStartEvent(
          cwd: "/tmp/second-workspace",
          sessionID: "second-session",
          transcriptPath: "/tmp/second-session.jsonl"
        ),
        processID: processID
      )
    )

    #expect(
      harness.host.agentStateStore.foregroundSessionID(
        for: harness.context.surfaceID,
        agent: .codex
      ) == "second-session"
    )
  }

  @Test
  func commandFinishedClearsSessionIdentity() throws {
    let harness = try makeClaudeHookHarness()
    let sessionID = "session-1"
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: sessionID,
        hookEventName: .sessionStart,
        context: harness.context,
        processID: getpid()
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    #expect(!harness.host.hasAgentSession(agent: .claude, sessionID: sessionID))
  }

  @Test
  func piNativeLifecycleRoutesNotifiesAndClearsState() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    let sessionID = "pi-session"
    let processID = getpid()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .pi,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .nativeSessionStart,
          sessionID: sessionID,
          source: "pi-notify-supaterm"
        ),
        processID: processID
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .pi,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .agentStart,
          sessionID: sessionID,
          turnID: "turn-1"
        ),
        processID: processID
      )
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == .pi(.running))

    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .pi,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .agentEnd,
          message: "Pi run needs attention",
          sessionID: sessionID,
          stopReason: "error",
          turnID: "turn-1"
        ),
        processID: processID
      )
    )
    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .pi(.needsInput, detail: "Pi run needs attention")
    )
    #expect(result.desktopNotification?.title == "Pi")

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .pi,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .sessionShutdown,
          sessionID: sessionID
        ),
        processID: processID
      )
    )
    #expect(!harness.host.hasAgentSession(agent: .pi, sessionID: sessionID))
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
  }
}

private func codexSessionStartEvent(
  cwd: String = CodexHookFixtures.cwd,
  sessionID: String,
  transcriptPath: String? = nil
) -> SupatermAgentHookEvent {
  SupatermAgentHookEvent(
    cwd: cwd,
    hookEventName: .sessionStart,
    sessionID: sessionID,
    transcriptPath: transcriptPath
  )
}

private func codexSessionStartRequest(
  cwd: String = CodexHookFixtures.cwd,
  context: SupatermCLIContext,
  sessionID: String,
  inheritedSessionID: String? = nil,
  processID: Int32
) -> SupatermAgentHookRequest {
  SupatermAgentHookRequest(
    agent: .codex,
    context: context,
    event: codexSessionStartEvent(
      cwd: cwd,
      sessionID: sessionID,
      transcriptPath: "\(cwd)/\(sessionID).jsonl"
    ),
    inheritedSessionID: inheritedSessionID,
    processID: processID
  )
}
