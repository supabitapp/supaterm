import AppKit
import CustomDump
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
  func claudeTaskHooksDrivePanelProgress() throws {
    let harness = try makeClaudeHookHarness()
    let created = """
      {
        "session_id": "\(ClaudeHookFixtures.sessionID)",
        "cwd": "\(ClaudeHookFixtures.cwd)",
        "hook_event_name": "TaskCreated",
        "task_id": "task-7",
        "task_subject": "Wire task status"
      }
      """
    let completed = """
      {
        "session_id": "\(ClaudeHookFixtures.sessionID)",
        "cwd": "\(ClaudeHookFixtures.cwd)",
        "hook_event_name": "TaskCompleted",
        "task_id": "task-7",
        "task_subject": "Wire task status"
      }
      """

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(created, context: harness.context)
    )
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(id: "task-7", title: "Wire task status", status: .pending)
      ]
    )

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(completed, context: harness.context)
    )
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(id: "task-7", title: "Wire task status", status: .completed)
      ]
    )
  }
  @Test
  func claudeStopKeepsTabRunningWhileBackgroundTaskRemains() throws {
    try verifyClaudeStopKeepsTabRunning(
      ClaudeHookFixtures.stopWithPendingBackgroundTask
    )
  }
  @Test
  func claudeStopKeepsTabRunningWhileCronRemains() throws {
    try verifyClaudeStopKeepsTabRunning(ClaudeHookFixtures.stopWithPendingCron)
  }
  private func verifyClaudeStopKeepsTabRunning(_ stop: String) throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(stop, context: harness.context)
    )

    expectNoDifference(
      harness.host.agentActivity(for: harness.tabID),
      .claude(.running)
    )
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
  }
  @Test
  func claudeStopMarksTabIdleAfterBackgroundWorkDrains() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(
        ClaudeHookFixtures.stopWithPendingBackgroundTask,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.stop, context: harness.context)
    )

    expectNoDifference(
      harness.host.agentActivity(for: harness.tabID),
      .claude(.idle)
    )
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }
  @Test
  func claudeIdlePromptDoesNotOverridePendingBackgroundWork() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.preToolUse, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(
        ClaudeHookFixtures.stopWithPendingBackgroundTask,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.idlePrompt, context: harness.context)
    )

    expectNoDifference(
      harness.host.agentActivity(for: harness.tabID),
      .claude(.running)
    )
    #expect(result.desktopNotification == nil)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)

    harness.host.handleDesktopNotification(
      body: "Claude is waiting for your input",
      surfaceID: harness.context.surfaceID,
      title: "Claude Code"
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func claudeBackgroundNotificationSuppressesItsTerminalAlert() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    let message = "thermo-risk needs permission for Bash"

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .notification,
          message: message,
          notificationType: "worker_permission_prompt",
          sessionID: ClaudeHookFixtures.sessionID
        )
      )
    )

    #expect(result.desktopNotification == nil)
    harness.host.handleDesktopNotification(
      body: message,
      surfaceID: harness.context.surfaceID,
      title: "Claude Code"
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }
  @Test
  func claudeSubagentStopRemovesChildWithoutNotifyingOrIdlingRootTurn() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    func childEvent(
      _ hookEventName: SupatermAgentHookEventName,
      lastAssistantMessage: String? = nil
    ) -> SupatermAgentHookEvent {
      SupatermAgentHookEvent(
        agentType: "general-purpose",
        hookEventName: hookEventName,
        lastAssistantMessage: lastAssistantMessage,
        sessionID: ClaudeHookFixtures.sessionID,
        agentID: "child-1"
      )
    }

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.subagentStart)
      )
    )

    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.subagentStop, lastAssistantMessage: "Child summary.")
      )
    )

    #expect(result.desktopNotification == nil)
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.running))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.activeChildren.isEmpty
        == true
    )
  }

  @Test
  func claudeChildAttentionDoesNotCreatePaneAlert() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    func childEvent(_ hookEventName: SupatermAgentHookEventName) -> SupatermAgentHookEvent {
      SupatermAgentHookEvent(
        agentType: "general-purpose",
        hookEventName: hookEventName,
        message: hookEventName == .notification ? "Child needs permission" : nil,
        notificationType: hookEventName == .notification ? "permission_prompt" : nil,
        sessionID: ClaudeHookFixtures.sessionID,
        agentID: "child-1"
      )
    }

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.userPromptSubmit, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.subagentStart)
      )
    )
    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.notification)
      )
    )

    let child = try #require(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.activeChildren.first
    )
    #expect(child.phase == .needsInput)
    #expect(result.desktopNotification == nil)

    harness.host.handleDesktopNotification(
      body: "Child needs permission",
      surfaceID: harness.context.surfaceID,
      title: "Claude Code"
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func claudeMissingChildNotificationSuppressesItsTerminalAlert() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          agentType: "general-purpose",
          hookEventName: .notification,
          message: "Child needs permission",
          notificationType: "permission_prompt",
          sessionID: ClaudeHookFixtures.sessionID,
          agentID: "child-missed"
        )
      )
    )

    #expect(result.desktopNotification == nil)
    harness.host.handleDesktopNotification(
      body: "Child needs permission",
      surfaceID: harness.context.surfaceID,
      title: "Claude Code"
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func claudeBackgroundNotificationUsesContextWithoutSessionState() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    let message = "thermo-risk needs permission for Bash"

    let result = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: SupatermAgentHookEvent(
          hookEventName: .notification,
          message: message,
          notificationType: "worker_permission_prompt",
          sessionID: ClaudeHookFixtures.sessionID
        )
      )
    )

    #expect(result.desktopNotification == nil)
    harness.host.handleDesktopNotification(
      body: message,
      surfaceID: harness.context.surfaceID,
      title: "Claude Code"
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
  }

  @Test
  func claudeSubagentTurnStartKeepsRecentStructuredNotification() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)
    func childEvent(_ hookEventName: SupatermAgentHookEventName) -> SupatermAgentHookEvent {
      SupatermAgentHookEvent(
        agentType: "general-purpose",
        hookEventName: hookEventName,
        sessionID: ClaudeHookFixtures.sessionID,
        agentID: "child-1"
      )
    }

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .claude,
        sessionID: ClaudeHookFixtures.sessionID,
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Root turn done."
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.subagentStart)
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .claude,
        context: harness.context,
        event: childEvent(.userPromptSubmit)
      )
    )

    #expect(harness.host.clearRecentStructuredNotification(for: harness.context.surfaceID))
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
        == TerminalHostState.AgentActivity(agent: .pi, phase: .running)
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
          agent: .pi,
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
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID).isEmpty)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).status == nil)
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
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).status == .done)

    harness.host.updateWindowActivity(
      WindowActivityState(isKeyWindow: true, isVisible: true)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).status == nil)
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

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID).isEmpty)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
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
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).latestResponse?.text == "Done.")
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
    #expect(session.forkStartupCommand == .shell("codex fork child-session"))
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
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).latestResponse?.text == "Child done.")
  }
  @Test
  func codexSameProcessSessionInForegroundDirectoryReplacesForegroundSession() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()

    for sessionID in ["parent-session", "child-session"] {
      for hookEventName in [
        SupatermAgentHookEventName.sessionStart,
        .userPromptSubmit,
      ] {
        _ = try harness.commandExecutor.handleAgentHook(
          agentHookRequest(
            agent: .codex,
            sessionID: sessionID,
            hookEventName: hookEventName,
            context: harness.context,
            processID: processID
          )
        )
      }
    }

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "child-session",
          workingDirectoryPath: "\(CodexHookFixtures.cwd)/"
        )
    )
  }
  @Test
  func codexInternalSessionCannotReplaceForegroundSession() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "foreground-session",
        hookEventName: .sessionStart,
        context: harness.context,
        processID: processID
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "foreground-session",
        hookEventName: .userPromptSubmit,
        context: harness.context,
        processID: processID
      )
    )

    let internalSessionID = "internal-session"
    for hookEventName in [
      SupatermAgentHookEventName.sessionStart,
      .userPromptSubmit,
    ] {
      _ = try harness.commandExecutor.handleAgentHook(
        SupatermAgentHookRequest(
          agent: .codex,
          context: harness.context,
          event: SupatermAgentHookEvent(
            cwd: "/tmp/codex/memories",
            hookEventName: hookEventName,
            sessionID: internalSessionID
          ),
          processID: processID
        )
      )
    }

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.session
        == PaneAgentPanelSession.supported(
          agent: .codex,
          sessionID: "foreground-session",
          workingDirectoryPath: "\(CodexHookFixtures.cwd)/"
        )
    )
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: internalSessionID))
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
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).latestResponse?.text == nil)
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
  func codexPlanUpdateRecoversMissingSession() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: CodexHookFixtures.planUpdate([
          ("Recovered session", "in_progress")
        ]),
        processID: getpid()
      )
    )

    #expect(
      harness.host.agentPanelPresentation(for: harness.context.surfaceID)?.progressRows == [
        PaneAgentProgressRow(
          id: "0:Recovered session",
          title: "Recovered session",
          status: .running
        )
      ]
    )
    #expect(
      harness.host.hasAgentSession(agent: .codex, sessionID: CodexHookFixtures.sessionID)
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
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).latestResponse?.text == nil)
  }

  @Test
  func stopWithoutAssistantMessageShowsDoneInTheBackground() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

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

    #expect(result.desktopNotification?.body == "Agent turn complete")
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Agent turn complete")
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).status == .done)
    #expect(harness.host.tabAgentPresentation(for: harness.tabID).latestResponse?.text == nil)
  }
}
