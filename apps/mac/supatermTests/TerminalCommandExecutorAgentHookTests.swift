import AppKit
import Clocks
import ComposableArchitecture
import SupatermSupport
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCommandExecutorAgentHookTests {
  @Test
  func claudeNotificationUsesStoredSessionSurfaceWhenAmbientContextIsMissing() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .claude(.needsInput, detail: "Claude needs your attention")
    )
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func claudeSessionStartShowsWorkspaceWithoutMarkingTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.workingDirectoryPath
        == "\(ClaudeHookFixtures.cwd)/"
    )
  }
  @Test
  func claudeSessionStartStoresTaskProgressRows() async throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Wire progress rows",
          "status": "in_progress",
          "blockedBy": [],
        ]
      ],
      to: transcriptURL
    )
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: ClaudeHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: ClaudeHookFixtures.sessionID,
          transcriptPath: transcriptURL.path
        )
      )
    )

    let expectedRows = [
      PaneAgentProgressRow(
        id: "claude-task:1",
        title: "Wire progress rows",
        status: .running
      )
    ]
    let didLoadRows = await waitUntil {
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows
        == expectedRows
    }

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(didLoadRows)
  }
  @Test
  func sessionTranscriptGoalStatusUpdatesPanelProgressRows() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: ClaudeHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: ClaudeHookFixtures.sessionID,
          transcriptPath: transcriptURL.path
        )
      )
    )

    try ClaudeProgressFixtures.appendGoalStatus(
      condition: "Ship session goal progress",
      met: false,
      to: transcriptURL
    )
    await advanceClock(clock)

    let didLoadProgress = await waitUntil {
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(
          id: "claude-goal:Ship session goal progress",
          title: "Goal: Ship session goal progress",
          status: .running,
          kind: .goal
        )
      ]
    }
    #expect(didLoadProgress)
  }
  @Test
  func claudePreToolUseMarksTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))
  }
  @Test
  func commandFinishedClearsAgentActivityAndStoredSessionRouting() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(!harness.host.hasAgentSession(agent: .claude, sessionID: ClaudeHookFixtures.sessionID))

    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func queuedTranscriptUpdateCannotResurrectClearedSession() throws {
    let harness = try makeClaudeHookHarness()
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    #expect(
      harness.host.clearAgentState(for: harness.context.surfaceID)
    )

    harness.commandExecutor.handleMonitorSnapshot(
      AgentMonitorSnapshot(status: .started("turn-late"), detail: "Late transcript update"),
      scope: TerminalAgentEvent.Scope(
        agent: .codex,
        sessionID: CodexHookFixtures.sessionID
      ),
      context: harness.context
    )

    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: CodexHookFixtures.sessionID))
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
  }
  @Test
  func staleTranscriptSnapshotCannotOverwriteCurrentTurnPresentation() throws {
    let harness = try makeClaudeHookHarness()
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .userPromptSubmit,
          sessionID: CodexHookFixtures.sessionID,
          turnID: "turn-2"
        )
      )
    )

    harness.commandExecutor.handleMonitorSnapshot(
      AgentMonitorSnapshot(
        status: .started("turn-1"),
        detail: "Stale detail",
        hoverMessages: ["Stale hover"],
        progressRows: [
          PaneAgentProgressRow(id: "stale", title: "Stale progress", status: .running)
        ]
      ),
      scope: TerminalAgentEvent.Scope(
        agent: .codex,
        sessionID: CodexHookFixtures.sessionID
      ),
      context: harness.context
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows.isEmpty
        == true
    )
  }
  @Test
  func staleTurnCompletionDoesNotNotify() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "codex-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .userPromptSubmit,
          sessionID: "codex-session",
          turnID: "turn-2"
        )
      )
    )

    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .stop,
          lastAssistantMessage: "Stale completion",
          sessionID: "codex-session",
          turnID: "turn-1"
        )
      )
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))
  }
  @Test
  func unscopedClaudeAttentionSurvivesTimeoutAndResolvesOnToolCompletion() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification, context: harness.context)
    )

    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .claude(.needsInput, detail: "Claude needs your attention")
    )

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .postToolUse,
          sessionID: ClaudeHookFixtures.sessionID,
          toolName: "Bash",
          toolUseID: "tool-1"
        )
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running, detail: "Bash"))
  }
  @Test
  func closingSurfaceCancelsTranscriptTracking() throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }
    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    #expect(
      harness.commandExecutor.agentMonitorStore.isTracking(
        scope: TerminalAgentEvent.Scope(
          agent: .codex,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )

    harness.host.closeSurface(harness.context.surfaceID)

    #expect(
      !harness.commandExecutor.agentMonitorStore.isTracking(
        scope: TerminalAgentEvent.Scope(
          agent: .codex,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )
  }
  @Test
  func unregisteringWindowCancelsTranscriptTracking() throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }
    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    harness.registry.unregister(windowControllerID: harness.windowControllerID)

    #expect(
      !harness.commandExecutor.agentMonitorStore.isTracking(
        scope: TerminalAgentEvent.Scope(
          agent: .codex,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )
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
    #expect(
      harness.host.agentStateRecords(for: harness.context.surfaceID).first?.processes
        .contains(where: { $0.processID == processID }) == true
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
    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == TerminalHostState.AgentActivity(kind: .pi, phase: .running)
    )

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
        == TerminalHostState.AgentActivity(
          kind: .pi,
          phase: .needsInput,
          detail: "Pi run needs attention"
        )
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
  @Test
  func claudeNotificationUsesGenericMessage() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func claudeNotificationWithoutMessageOnlyMarksNeedsInput() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        event: SupatermAgentHookEvent(
          hookEventName: .notification,
          notificationType: "permission_prompt",
          sessionID: ClaudeHookFixtures.sessionID,
          title: "Needs input"
        )
      )
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.needsInput))
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }
  @Test
  func claudeNotificationDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Claude needs your attention",
          subtitle: "Needs input",
          title: "Claude Code",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .claude(.needsInput, detail: "Claude needs your attention")
    )
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func terminalDesktopNotificationIsSuppressedAfterMatchingClaudeHookNotification() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Needs input", "Claude needs your attention")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func claudeUserPromptSubmitReturnsTabToRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func claudeForkedSessionRecoversRoutingFromUserPromptSubmit() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: "forked-session",
        hookEventName: .userPromptSubmit,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))

    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: "forked-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Forked turn done."
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Forked turn done.",
          subtitle: "Turn complete",
          title: "Claude Code",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Forked turn done.")
  }
  @Test(arguments: [SupatermAgentHookEventName.preToolUse, .postToolUse])
  func claudeForkedSessionRecoversRoutingFromToolActivity(
    hookEventName: SupatermAgentHookEventName
  ) throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: "forked-session",
        hookEventName: hookEventName,
        context: harness.context
      )
    )

    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: "forked-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Forked tool turn done."
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(result.desktopNotification?.body == "Forked tool turn done.")
  }
  @Test
  func claudeStopMarksTabIdle() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }
  @Test
  func claudeStopDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Claude Code",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }
  @Test
  func claudeSessionEndRemovesStoredSessionRouting() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.idle))
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionEnd)
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }
  @Test
  func claudeSessionEndClearsTaskProgressRows() async throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Wire progress rows",
          "status": "completed",
          "blockedBy": [],
        ]
      ],
      to: transcriptURL
    )
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: ClaudeHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: ClaudeHookFixtures.sessionID,
          transcriptPath: transcriptURL.path
        )
      )
    )
    let didLoadRows = await waitUntil {
      harness.host.agentPanelPresentation(for: harness.context.surfaceID) != nil
    }
    #expect(didLoadRows)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionEnd)
    )

    #expect(harness.host.agentPanelPresentation(for: harness.context.surfaceID) == nil)
  }
  @Test
  func storedClaudeSessionSurvivesRegistryReattachment() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    harness.registry.unregister(windowControllerID: harness.windowControllerID)
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )
    harness.registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: harness.windowControllerID,
      store: harness.store,
      terminal: harness.host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    harness.registry.updateWindow(window, for: harness.windowControllerID)
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func codexSessionStartTracksTranscriptLifecycleWithoutHookFallback() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.userPromptSubmit,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .localShellCall(command: ["git", "status", "--short"]),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .assistantMessage("Updating the registry and sidebar"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didUpdateDetail = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Updating the registry and sidebar")
        && harness.host.codexHoverMarkdown(for: harness.tabID)
          == "Updating the registry and sidebar"
    }
    #expect(didUpdateDetail)

    try CodexTranscriptFixtures.append(
      .assistantMessage(
        "Final answer should stay out of the running subtitle",
        phase: "final_answer"
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didLoadFinalAnswer = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.running)
        && harness.host.codexHoverMarkdown(for: harness.tabID)
          == "Final answer should stay out of the running subtitle"
    }
    #expect(didLoadFinalAnswer)

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1", lastAgentMessage: "Done."),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didComplete = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }
    #expect(didComplete)
  }
  @Test
  func codexSessionStartShowsAlreadyRunningTranscriptSnapshot() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Resuming active rollout"), to: transcriptPath)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    let didLoadSnapshot = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Resuming active rollout")
    }
    #expect(didLoadSnapshot)
  }

  @Test
  func codexUsageLimitStopsTranscriptDrivenActivity() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(
      .tokenCount(usedPercent: 100, includesUsage: false),
      to: transcriptPath
    )

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    let didStop = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }
    #expect(didStop)
  }

  @Test
  func restoredCodexSessionResumesTranscriptMonitoringWithoutAnotherHook() async throws {
    initializeGhosttyForTests()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-restored"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Resumed from transcript"), to: transcriptPath)

    let registry = TerminalWindowRegistry()
    _ = makeCommandExecutor(registry: registry)
    let host = TerminalHostState()
    host.handleCommand(.ensureInitialTab(focusing: false, startupCommand: nil))
    let surfaceID = try #require(host.selectedSurfaceView?.id)
    let tabID = try #require(host.selectedTabID)
    let process = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
    host.restoreAgentState(
      [
        TerminalPaneAgentRecord(
          agent: .codex,
          sessionID: "restored-codex",
          processes: [process],
          transcriptPath: transcriptPath.path,
          turnLifecycle: .active("turn-restored"),
          phase: .running,
          detail: "Persisted detail",
          hoverMessages: [],
          nativePlanRows: [],
          transcriptRows: [],
          activeChildren: [],
          isForeground: true,
          revision: 1
        )
      ],
      for: surfaceID
    )
    let store = Store(initialState: AppFeature.State()) { AppFeature() }
    let windowControllerID = UUID()
    registry.register(
      keyboardShortcutForAction: { _ in nil },
      windowControllerID: windowControllerID,
      store: store,
      terminal: host,
      requestConfirmedWindowClose: {}
    )
    let window = makeWindow()
    registry.updateWindow(window, for: windowControllerID)

    let didResume = await waitUntil {
      host.agentActivity(for: tabID)
        == .codex(.running, detail: "Resumed from transcript")
    }

    #expect(didResume)
    #expect(host.agentPanelPresentation(for: surfaceID)?.session == nil)
  }
  @Test
  func codexSessionStartWithClearSourceShowsAlreadyRunningTranscriptSnapshot() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Resuming after clear"), to: transcriptPath)

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: CodexHookFixtures.sessionID,
          source: "clear",
          transcriptPath: transcriptPath.path
        )
      )
    )

    let didLoadSnapshot = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Resuming after clear")
    }
    #expect(didLoadSnapshot)
  }
  @Test
  func codexPreToolUseShowsCurrentTool() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))
  }
  @Test
  func codexPostToolUseShowsCurrentTool() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.postToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))
  }
  @Test
  func codexPostToolUsePlanUpdatesPanelWithoutTranscript() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: CodexHookFixtures.planUpdate([
          ("Read state", "completed"),
          ("Update panel", "in_progress"),
          ("Verify behavior", "pending"),
        ])
      )
    )

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(
          id: "0:Read state",
          title: "Read state",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "1:Update panel",
          title: "Update panel",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "2:Verify behavior",
          title: "Verify behavior",
          status: .pending
        ),
      ]
    )
  }
  @Test
  func codexPreToolUseRecoversMissingSessionAndStartsPanelTracking() throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.preToolUse,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))
    #expect(
      harness.commandExecutor.agentMonitorStore.isTracking(
        scope: TerminalAgentEvent.Scope(
          agent: .codex,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )
  }
  @Test
  func codexTranscriptDetailOverridesOptimisticPreToolUseRunningState() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.preToolUse,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running, detail: "Bash"))

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    let didLoadDetail = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    }

    #expect(didLoadDetail)
  }
  @Test
  func codexTranscriptStopsAfterCommandFinished() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(
      .assistantMessage("Tracking before command finished"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didLoadDetail = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Tracking before command finished")
        && harness.host.codexHoverMarkdown(for: harness.tabID) == "Tracking before command finished"
    }
    #expect(didLoadDetail)

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: CodexHookFixtures.sessionID))

    try CodexTranscriptFixtures.append(
      .assistantMessage("Late transcript update"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
  }
  @Test
  func codexUserPromptSubmitStartsTurn() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.userPromptSubmit, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))
    let session = try #require(harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session)
    let expectedSession = try #require(
      PaneAgentPanelSession.supported(
        agent: .codex,
        sessionID: CodexHookFixtures.sessionID,
        workingDirectoryPath: "\(CodexHookFixtures.cwd)/"
      )
    )
    #expect(session == expectedSession)
  }
  @Test
  func codexTranscriptIgnoresToolCallsAfterAssistantMessage() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "sed -n '1,40p' docs/coding-agents-integration.md"
        ]
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didKeepAssistantDetail = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    }
    #expect(didKeepAssistantDetail)
  }
  @Test
  func codexTranscriptIgnoresReasoningAfterAssistantMessageAcrossPolls() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didLoadAssistantDetail = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    }
    #expect(didLoadAssistantDetail)

    try CodexTranscriptFixtures.append(
      .reasoning("Planning the next step"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )
  }
  @Test
  func codexTranscriptAccumulatesHoverMessagesInChronologicalOrder() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptPath
    )
    try CodexTranscriptFixtures.append(
      .assistantMessage("Updating the registry and sidebar"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didAccumulateMessages = await waitUntil {
      harness.host.codexHoverMarkdown(for: harness.tabID) == """
        Inspecting the transcript path

        Updating the registry and sidebar
        """
    }
    #expect(didAccumulateMessages)
  }
  @Test
  func codexTranscriptKeepsFullHoverMessageWhenRunningDetailIsTruncated() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    let longMessage = Array(repeating: "message", count: 30).joined(separator: " ")
    let truncatedMessage = String(longMessage.prefix(157)) + "..."

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    try CodexTranscriptFixtures.append(
      .assistantMessage(longMessage),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didLoadLongMessage = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: truncatedMessage)
        && harness.host.codexHoverMarkdown(for: harness.tabID) == longMessage
    }
    #expect(didLoadLongMessage)
  }
  @Test
  func codexTranscriptIgnoresExecCommandRunningDetail() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "git status --short"
        ]
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didRemainRunning = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.running)
    }
    #expect(didRemainRunning)
  }
  @Test
  func codexTranscriptEventFallbackUpdatesDetailAndAbortedTurnClearsRunning() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.turnStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    let didStart = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.running)
    }
    #expect(didStart)

    try CodexTranscriptFixtures.append(
      .agentReasoning("Inspecting transcript activity"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .agentMessage("Need approval?", phase: "commentary"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didLoadMessage = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Need approval?")
    }
    #expect(didLoadMessage)

    try CodexTranscriptFixtures.append(
      .turnAborted(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    let didAbort = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }
    #expect(didAbort)
  }
  @Test
  func codexTurnCompleteMarksTabIdle() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.turnStarted(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    let didStart = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.running)
    }
    #expect(didStart)

    try CodexTranscriptFixtures.append(.turnComplete(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    let didComplete = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }
    #expect(didComplete)
  }
  @Test
  func codexChildTranscriptMessageReplacesToolDetailWithoutReplacingRootMonitor() async throws {
    let harness = try makeClaudeHookHarness()
    let rootTranscript = try CodexTranscriptFixtures.makeTranscript()
    let childTranscript = try CodexTranscriptFixtures.makeTranscript()
    defer {
      try? FileManager.default.removeItem(at: rootTranscript.deletingLastPathComponent())
      try? FileManager.default.removeItem(at: childTranscript.deletingLastPathComponent())
    }
    let childScope = TerminalAgentEvent.Scope(
      agent: .codex,
      sessionID: CodexHookFixtures.sessionID,
      turnID: "root-turn",
      subagentID: "child-1"
    )

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: rootTranscript,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .userPromptSubmit,
          sessionID: CodexHookFixtures.sessionID,
          transcriptPath: rootTranscript.path,
          turnID: "root-turn"
        )
      )
    )
    try CodexTranscriptFixtures.append(
      .subagentSessionMeta(
        id: "child-1",
        sessionID: CodexHookFixtures.sessionID,
        nickname: "Mendel"
      ),
      to: childTranscript
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "child-turn"), to: childTranscript)
    try CodexTranscriptFixtures.append(
      .assistantMessage("Tracing native haptic calls"),
      to: childTranscript
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          agentType: "default",
          hookEventName: .subagentStart,
          sessionID: CodexHookFixtures.sessionID,
          transcriptPath: childTranscript.path,
          turnID: "root-turn",
          agentID: "child-1"
        )
      )
    )

    let didLoadChildMessage = await waitUntil {
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?
        .activeChildren.first?.detail == "Tracing native haptic calls"
    }
    #expect(didLoadChildMessage)
    #expect(harness.commandExecutor.agentMonitorStore.isTracking(scope: childScope))

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .postToolUse,
          sessionID: CodexHookFixtures.sessionID,
          toolName: "Bash",
          transcriptPath: childTranscript.path,
          turnID: "root-turn",
          agentID: "child-1"
        )
      )
    )
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?
        .activeChildren.first?.detail == "Tracing native haptic calls"
    )

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "root-turn"), to: rootTranscript)
    try CodexTranscriptFixtures.append(
      .assistantMessage("Coordinating child results"),
      to: rootTranscript
    )
    let didKeepRootMonitor = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Coordinating child results")
    }
    #expect(didKeepRootMonitor)
  }
  @Test
  func codexStopDeliversDesktopNotificationWhenWindowIsInactive() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Codex",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == "Done.")
  }
  @Test
  func codexNewSamePaneSessionReplacesForkActionSource() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "parent-session",
        hookEventName: .userPromptSubmit,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .userPromptSubmit,
        context: harness.context
      )
    )

    let session = try #require(harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session)
    #expect(
      session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "child-session",
          workingDirectoryPath: "\(CodexHookFixtures.cwd)/"
        )
    )
    #expect(session.forkStartupCommand.contains("codex fork child-session"))
  }
  @Test
  func codexSamePaneSessionStartRoutesStopToNewestSession() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Child done."
      )
    )

    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Child done.",
          subtitle: "Turn complete",
          title: "Codex",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Child done.")
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == "Child done.")
  }
  @Test
  func codexStopAfterCommandFinishedDoesNotRoute() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "foreground-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "foreground-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Foreground done."
      )
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
  }
  @Test
  func codexCommandFinishedClearsBackgroundSessionRouting() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Child done."
      )
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID).isEmpty)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }
  @Test
  func codexSessionStartAfterCommandFinishedStartsFreshForegroundSession() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    let result = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "child-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Child done."
      )
    )

    #expect(
      result.desktopNotification
        == DesktopNotificationRequest(
          body: "Child done.",
          subtitle: "Turn complete",
          title: "Codex",
          sourceSurfaceID: harness.context.surfaceID
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Child done.")
  }
  @Test
  func codexStopReplacesHoverHistoryWithLastAssistantMessage() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock,
      windowActivity: .inactive
    )
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the transcript path"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Updating the registry and sidebar"), to: transcriptPath)
    await advanceClock(clock)

    let didLoadHistory = await waitUntil {
      harness.host.codexHoverMarkdown(for: harness.tabID) == """
        Inspecting the transcript path

        Updating the registry and sidebar
        """
    }
    #expect(didLoadHistory)

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop, context: harness.context)
    )

    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == "Done.")
  }
  @Test
  func codexStopClearsNativePlanImmediately() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: CodexHookFixtures.sessionID,
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: CodexHookFixtures.planUpdate([
          ("Report validation and caveats", "in_progress")
        ])
      )
    )

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(
          id: "0:Report validation and caveats",
          title: "Report validation and caveats",
          status: .running
        )
      ]
    )

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows.isEmpty
        == true
    )
  }
  @Test
  func codexStopKeepsStructuredCompletionWhenTerminalFallbackArrives() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Codex", "Agent turn complete")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
  }
  @Test
  func codexUserPromptSubmitClearsStructuredCompletionSuppression() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.userPromptSubmit)
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onDesktopNotification?("Codex", "Agent turn complete")

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Agent turn complete")
  }
  @Test
  func codexNewTurnRemainsRunningDespiteStaleFinalSnapshot() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-0"),
      to: transcriptPath
    )

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(CodexHookFixtures.userPromptSubmit, transcriptPath: transcriptPath)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    await flushEffects()

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .taskStarted(turnID: "turn-1"),
      to: transcriptPath
    )
    let didObserveTurn = await waitUntil {
      harness.host.agentTurnID(
        agent: .codex,
        sessionID: CodexHookFixtures.sessionID
      ) == "turn-1"
    }

    #expect(didObserveTurn)
    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1"),
      to: transcriptPath
    )
    let didComplete = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }

    #expect(didComplete)
  }
  @Test
  func codexTranscriptCompletionHidesNativePlanRows() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    _ = try harness.commandExecutor.handleAgentHook(
      codexHook(
        CodexHookFixtures.sessionStart,
        transcriptPath: transcriptPath,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: CodexHookFixtures.planUpdate([
          ("Inspect state", "completed"),
          ("Commit and push scoped changes", "in_progress"),
        ])
      )
    )

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(
          id: "0:Inspect state",
          title: "Inspect state",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "1:Commit and push scoped changes",
          title: "Commit and push scoped changes",
          status: .running
        ),
      ]
    )

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(
      .assistantMessage("Transcript running"),
      to: transcriptPath
    )
    let didStart = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Transcript running")
    }
    #expect(didStart)
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows.count == 2
    )

    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptPath)
    let didComplete = await waitUntil {
      harness.host.agentActivity(for: harness.tabID) == .codex(.idle)
    }

    #expect(didComplete)
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows.isEmpty
        == true
    )
  }
  @Test
  func codexUserPromptSubmitStartsTrackingWhenTranscriptPathArrivesLater() async throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Transcript path arrived late"), to: transcriptPath)

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .userPromptSubmit,
          sessionID: CodexHookFixtures.sessionID,
          transcriptPath: transcriptPath.path
        )
      )
    )

    let didLoadTranscript = await waitUntil {
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Transcript path arrived late")
    }
    #expect(didLoadTranscript)
  }
  @Test
  func stopWithoutAssistantMessageOnlyMarksTabIdle() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        event: SupatermAgentHookEvent(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .stop,
          lastAssistantMessage: "   ",
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID).isEmpty)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
  }
}
