import AppKit
import Clocks
import ComposableArchitecture
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
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
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.needsInput))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Claude needs your attention")
  }
  @Test
  func claudeSessionStartDoesNotMarkTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.sessionStart, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
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

    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
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
      .init(
        agent: .claude,
        event: .init(
          hookEventName: .notification,
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
        == .init(
          body: "Claude needs your attention",
          subtitle: "Needs input",
          title: "Claude Code"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.agentActivity(for: harness.tabID) == .claude(.needsInput))
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
        == .init(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Claude Code"
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
  func staleStoredClaudeSessionIsClearedAfterContextPaneDisappears() throws {
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
    harness.registry.updateWindow(makeWindow(), for: harness.windowControllerID)
    _ = try harness.commandExecutor.handleAgentHook(
      ClaudeHookFixtures.request(ClaudeHookFixtures.notification)
    )

    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == nil)
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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Updating the registry and sidebar")
    )
    #expect(
      harness.host.codexHoverMarkdown(for: harness.tabID)
        == "Updating the registry and sidebar"
    )

    try CodexTranscriptFixtures.append(
      .assistantMessage(
        "Final answer should stay out of the running subtitle",
        phase: "final_answer"
      ),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running)
    )
    #expect(
      harness.host.codexHoverMarkdown(for: harness.tabID)
        == "Final answer should stay out of the running subtitle"
    )

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1", lastAgentMessage: "Done."),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
  }
  @Test
  func codexSessionStartShowsAlreadyRunningTranscriptSnapshot() throws {
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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Resuming active rollout")
    )
  }
  @Test
  func codexSessionStartWithClearSourceShowsAlreadyRunningTranscriptSnapshot() throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Resuming after clear"), to: transcriptPath)

    _ = try harness.commandExecutor.handleAgentHook(
      .init(
        agent: .codex,
        context: harness.context,
        event: .init(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: CodexHookFixtures.sessionID,
          source: "clear",
          transcriptPath: transcriptPath.path
        )
      )
    )

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Resuming after clear")
    )
  }
  @Test
  func codexPreToolUseDoesNotMarkTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.preToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
  }
  @Test
  func codexPostToolUseDoesNotMarkTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.postToolUse, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
  }
  @Test
  func codexUserPromptSubmitDoesNotMarkTabRunning() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.userPromptSubmit, context: harness.context)
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)
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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )
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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Inspecting the transcript path")
    )

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

    #expect(
      harness.host.codexHoverMarkdown(for: harness.tabID) == """
        Inspecting the transcript path

        Updating the registry and sidebar
        """
    )
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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: truncatedMessage)
    )
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == longMessage)
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

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))
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

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

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

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Need approval?")
    )

    try CodexTranscriptFixtures.append(
      .turnAborted(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
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

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(.turnComplete(turnID: "turn-1"), to: transcriptPath)
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
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
        == .init(
          body: "Done.",
          subtitle: "Turn complete",
          title: "Codex"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.unreadNotifiedSurfaceIDs(in: harness.tabID) == Set([harness.context.surfaceID]))
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Done.")
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == "Done.")
  }
  @Test
  func codexBackgroundSessionStopDoesNotNotifyForegroundPane() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    let result = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
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
    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == nil)
  }
  @Test
  func codexForegroundStopStillRoutesImmediatelyAfterCommandFinished() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "foreground-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    let result = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "foreground-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Foreground done."
      )
    )

    #expect(
      result.desktopNotification
        == .init(
          body: "Foreground done.",
          subtitle: "Turn complete",
          title: "Codex"
        )
    )
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 1)
    #expect(harness.host.latestNotificationText(for: harness.tabID) == "Foreground done.")
  }
  @Test
  func codexBackgroundSessionStopAfterCommandFinishedDoesNotRoute() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    let result = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
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
  func codexBackgroundSessionCanClaimForegroundAfterNewSessionStart() throws {
    let harness = try makeClaudeHookHarness(windowActivity: .inactive)

    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "parent-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )

    let surface = try #require(harness.host.selectedSurfaceView)
    surface.bridge.onCommandFinished?()

    _ = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "child-session",
        hookEventName: .sessionStart,
        context: harness.context
      )
    )
    let result = try harness.commandExecutor.handleAgentHook(
      codexHookRequest(
        sessionID: "child-session",
        hookEventName: .stop,
        context: harness.context,
        lastAssistantMessage: "Child done."
      )
    )

    #expect(
      result.desktopNotification
        == .init(
          body: "Child done.",
          subtitle: "Turn complete",
          title: "Codex"
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

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.stop, context: harness.context)
    )

    #expect(harness.host.codexHoverMarkdown(for: harness.tabID) == "Done.")
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
  func codexTranscriptIgnoresStaleFinalSnapshotUntilNextTurnCompletes() async throws {
    let clock = TestClock()
    let harness = try makeClaudeHookHarness(
      agentRunningTimeout: .milliseconds(10),
      clock: clock
    )
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

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    await flushEffects()

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    try CodexTranscriptFixtures.append(
      .taskStarted(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.running))

    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1"),
      to: transcriptPath
    )
    await advanceClock(clock)

    #expect(harness.host.agentActivity(for: harness.tabID) == .codex(.idle))
  }
  @Test
  func codexUserPromptSubmitStartsTrackingWhenTranscriptPathArrivesLater() throws {
    let harness = try makeClaudeHookHarness()
    let transcriptPath = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptPath.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptPath)
    try CodexTranscriptFixtures.append(.assistantMessage("Transcript path arrived late"), to: transcriptPath)

    _ = try harness.commandExecutor.handleAgentHook(
      .init(
        agent: .codex,
        context: harness.context,
        event: .init(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .sessionStart,
          sessionID: CodexHookFixtures.sessionID
        )
      )
    )

    #expect(harness.host.agentActivity(for: harness.tabID) == nil)

    _ = try harness.commandExecutor.handleAgentHook(
      .init(
        agent: .codex,
        context: harness.context,
        event: .init(
          cwd: CodexHookFixtures.cwd,
          hookEventName: .userPromptSubmit,
          sessionID: CodexHookFixtures.sessionID,
          transcriptPath: transcriptPath.path
        )
      )
    )

    #expect(
      harness.host.agentActivity(for: harness.tabID)
        == .codex(.running, detail: "Transcript path arrived late")
    )
  }
  @Test
  func stopWithoutAssistantMessageOnlyMarksTabIdle() throws {
    let harness = try makeClaudeHookHarness()

    _ = try harness.commandExecutor.handleAgentHook(
      CodexHookFixtures.request(CodexHookFixtures.sessionStart, context: harness.context)
    )
    let result = try harness.commandExecutor.handleAgentHook(
      .init(
        agent: .codex,
        event: .init(
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
