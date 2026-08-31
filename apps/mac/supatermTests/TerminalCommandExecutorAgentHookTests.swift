import AppKit
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalCommandExecutorAgentHookTests {
  @Test(arguments: [SupatermAgentKind.claude, .codex])
  func sessionStartStoresActionableIdentityWithoutChangingActivity(
    agent: SupatermAgentKind
  ) throws {
    let harness = try makeClaudeHookHarness()
    let sessionID = "session-1"
    if agent == .codex {
      try applyCurrentCodexDetection(to: harness)
    }
    let activityBefore = harness.host.agentActivity(for: harness.tabID)

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
    #expect(harness.host.agentActivity(for: harness.tabID) == activityBefore)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
  }

  @Test
  func codexCandidatesKeepEveryLiveDetectedPaneAndRawTitleEvidence() throws {
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
    let sessionID = "session-1"
    firstSurface.bridge.state.title = "\(sessionID) | Working"
    firstSurface.setTitleOverride("Custom title")
    secondSurface.bridge.state.title = "\(sessionID) | Working"
    for (index, surface) in [firstSurface, secondSurface].enumerated() {
      #expect(
        harness.host.applyAgentDetection(
          agentDetectionObservation(
            phase: .idle,
            processIdentity: processIdentity,
            sequence: UInt64(index + 1)
          ),
          for: surface.id
        )
      )
    }

    let response = harness.commandExecutor.agentHookCandidates(
      for: codexCandidateQuery(
        sessionID: sessionID,
        cwd: FileManager.default.currentDirectoryPath
      )
    )

    #expect(firstSurface.effectiveTitle() == "Custom title")
    #expect(response.candidates.count == 2)
    #expect(Set(response.candidates.map(\.context.surfaceID)) == [firstSurface.id, secondSurface.id])
    #expect(
      response.candidates.map(\.processID)
        == Array(repeating: processIdentity.processID, count: 2)
    )
    #expect(
      response.candidates.map(\.processStartTimeMicroseconds)
        == Array(repeating: processIdentity.startTimeMicroseconds, count: 2)
    )
    #expect(response.candidates.map(\.sessionIDMatchesTitle) == [true, true])
    #expect(response.candidates.map(\.workingDirectoryMatches) == [true, true])
    #expect(response.candidates.compactMap(\.ownedSessionID).isEmpty)
  }

  @Test(
    arguments: [
      "019c8ad3-4601-70d9-b980-311e16d7a44c",
      "Ready | 019c8ad3-4601-70d9-b980-311e16d7a44c",
      "supaterm | 019c8ad3-4601-70d9-b980-311e16d7a44c | Ready",
      "019c8ad3-4601-70d9-b980-311e1... | Ready",
      "supaterm | 019c8ad3-4601-70d9-b980-311e1... | Ready",
      "019c8ad3-4601-70d9-b980-311e1... Working",
      "⠋ 019c8ad3-4601-70d9-b980-311e1...",
    ]
  )
  func codexCandidateMatchesExactSessionIDTitleSegment(rawTitle: String) throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    try applyCurrentCodexDetection(to: harness)
    let sessionID = "019c8ad3-4601-70d9-b980-311e16d7a44c"
    surface.bridge.state.title = rawTitle

    let response = harness.commandExecutor.agentHookCandidates(
      for: codexCandidateQuery(sessionID: sessionID)
    )

    let candidate = try #require(response.candidates.first)
    #expect(response.candidates.count == 1)
    #expect(candidate.sessionIDMatchesTitle)
  }

  @Test(
    arguments: [
      "notes-019c8ad3-4601-70d9-b980-311e16d7a44c",
      "019c8ad3-4601-70d9-b980-311e16d7a44c-notes",
      "supaterm | (019c8ad3-4601-70d9-b980-311e16d7a44c) | Ready",
      "supaterm | notes-019c8ad3-4601-70d9-b980-311e1... | Ready",
    ]
  )
  func codexCandidateRejectsSessionIDInsideCustomTitle(rawTitle: String) throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    try applyCurrentCodexDetection(to: harness)
    let sessionID = "019c8ad3-4601-70d9-b980-311e16d7a44c"
    surface.bridge.state.title = rawTitle

    let response = harness.commandExecutor.agentHookCandidates(
      for: codexCandidateQuery(sessionID: sessionID)
    )

    let candidate = try #require(response.candidates.first)
    #expect(response.candidates.count == 1)
    #expect(!candidate.sessionIDMatchesTitle)
  }

  @Test
  func codexCandidateTitleEvidenceSurvivesOwnedSessionRotation() throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    try applyCurrentCodexDetection(to: harness)
    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "owned-session",
        hookEventName: .sessionStart,
        context: harness.context,
        processID: getpid()
      )
    )
    surface.bridge.state.title = "Ready | other-session"

    let response = harness.commandExecutor.agentHookCandidates(
      for: codexCandidateQuery(sessionID: "other-session")
    )

    let candidate = try #require(response.candidates.first)
    #expect(response.candidates.count == 1)
    #expect(candidate.ownedSessionID == "owned-session")
    #expect(candidate.sessionIDMatchesTitle)
  }

  @Test
  func codexCandidatesPruneDeadDetections() throws {
    let harness = try makeClaudeHookHarness()
    let surface = try #require(harness.host.selectedSurfaceView)
    #expect(
      harness.host.applyAgentDetection(
        agentDetectionObservation(
          phase: .idle,
          processIdentity: TerminalAgentProcessIdentity(
            processID: Int32.max,
            startTimeMicroseconds: 1
          ),
          sequence: 1
        ),
        for: surface.id
      )
    )

    let response = harness.commandExecutor.agentHookCandidates(
      for: codexCandidateQuery(sessionID: "session-1")
    )

    #expect(response.candidates.isEmpty)
    #expect(harness.host.agentDetectionStore.observation(for: surface.id) == nil)
  }

  @Test
  func codexCandidateQueryRejectsNonRootEvent() throws {
    let harness = try makeClaudeHookHarness()
    try applyCurrentCodexDetection(to: harness)
    let query = SupatermAgentHookCandidateQuery(
      event: SupatermAgentHookEvent(
        cwd: FileManager.default.currentDirectoryPath,
        hookEventName: .sessionStart,
        sessionID: "session-1",
        source: "internal",
        transcriptPath: "/tmp/session-1.jsonl"
      )
    )

    #expect(harness.commandExecutor.agentHookCandidates(for: query).candidates.isEmpty)
  }

  @Test
  func codexCandidateResponseDetectsLiveAppServer() throws {
    let harness = try makeClaudeHookHarness()
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/yes")
    process.arguments = ["app-server"]
    process.standardOutput = FileHandle.nullDevice
    try process.run()
    defer {
      if process.isRunning {
        process.terminate()
      }
      process.waitUntilExit()
    }
    let query = codexCandidateQuery(
      sessionID: "session-1",
      emitterProcessID: process.processIdentifier
    )

    #expect(harness.commandExecutor.agentHookCandidates(for: query).sharedCodexHost)
    #expect(
      !harness.commandExecutor.agentHookCandidates(
        for: codexCandidateQuery(
          sessionID: "session-1",
          emitterProcessID: Int32.max
        )
      ).sharedCodexHost
    )
  }

  @Test
  func codexSessionStartBindsOnlyTheDetectedPID() throws {
    let harness = try makeClaudeHookHarness()
    let processIdentity = try applyCurrentCodexDetection(to: harness)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "session-1",
        hookEventName: .sessionStart,
        context: harness.context,
        processID: processIdentity.processID
      )
    )

    let snapshot = try #require(
      harness.host.agentStateStore.snapshots(for: harness.context.surfaceID).first
    )
    #expect(snapshot.sessionID == "session-1")
    #expect(snapshot.processes == [processIdentity])
  }

  @Test
  func codexSessionStartRejectsAStaleCandidatePID() throws {
    let harness = try makeClaudeHookHarness()
    try applyCurrentCodexDetection(to: harness)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "session-1",
        hookEventName: .sessionStart,
        context: harness.context,
        processID: Int32.max
      )
    )

    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "session-1"))
  }

  @Test
  func codexSessionStartRejectsAReusedCandidatePID() throws {
    let harness = try makeClaudeHookHarness()
    let processIdentity = try applyCurrentCodexDetection(to: harness)

    _ = try harness.commandExecutor.handleAgentHook(
      agentHookRequest(
        agent: .codex,
        sessionID: "session-1",
        hookEventName: .sessionStart,
        context: harness.context,
        processID: processIdentity.processID,
        processStartTimeMicroseconds: processIdentity.startTimeMicroseconds + 1
      )
    )

    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "session-1"))
  }

  @Test
  func internalCodexSessionCannotBindBeforeRoot() throws {
    let harness = try makeClaudeHookHarness()
    let processIdentity = try applyCurrentCodexDetection(to: harness)
    let request = SupatermAgentHookRequest(
      agent: .codex,
      context: harness.context,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/codex/memories",
        hookEventName: .sessionStart,
        sessionID: "nested-session",
        source: SupatermCodexRootSessionStart.Source.startup.rawValue,
        transcriptPath: "/tmp/codex/memories/nested-session.jsonl"
      ),
      inheritedSessionID: "root-session",
      processID: processIdentity.processID
    )

    _ = try harness.commandExecutor.handleAgentHook(request)

    #expect(harness.host.agentStateStore.snapshots(for: harness.context.surfaceID).isEmpty)
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
    if agent == .codex {
      try applyCurrentCodexDetection(to: harness)
    }
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
    let activityBefore = harness.host.agentActivity(for: harness.tabID)

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
    #expect(harness.host.agentActivity(for: harness.tabID) == activityBefore)
    #expect(harness.host.unreadNotificationCount(for: harness.tabID) == 0)
  }

  @Test
  func newSessionStartReplacesForegroundIdentity() throws {
    let harness = try makeClaudeHookHarness()
    try applyCurrentCodexDetection(to: harness)

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
  func codexInternalSessionCannotReplaceForegroundIdentity() throws {
    let harness = try makeClaudeHookHarness()
    let processID = getpid()
    try applyCurrentCodexDetection(to: harness)

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
      SupatermAgentHookRequest(
        agent: .codex,
        context: harness.context,
        event: SupatermAgentHookEvent(
          cwd: "/tmp/codex/memories",
          hookEventName: .sessionStart,
          sessionID: "internal-session"
        ),
        processID: processID
      )
    )

    #expect(
      harness.host.agentStateStore.foregroundSessionID(
        for: harness.context.surfaceID,
        agent: .codex
      ) == "foreground-session"
    )
    #expect(!harness.host.hasAgentSession(agent: .codex, sessionID: "internal-session"))
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

private func codexCandidateQuery(
  sessionID: String,
  cwd: String = CodexHookFixtures.cwd,
  emitterProcessID: Int32? = nil
) -> SupatermAgentHookCandidateQuery {
  SupatermAgentHookCandidateQuery(
    event: SupatermAgentHookEvent(
      cwd: cwd,
      hookEventName: .sessionStart,
      sessionID: sessionID,
      source: SupatermCodexRootSessionStart.Source.startup.rawValue,
      transcriptPath: "\(cwd)/\(sessionID).jsonl"
    ),
    emitterProcessID: emitterProcessID
  )
}

@MainActor
@discardableResult
private func applyCurrentCodexDetection(
  to harness: ClaudeHookHarness,
  sequence: UInt64 = 1
) throws -> TerminalAgentProcessIdentity {
  let processIdentity = try #require(TerminalAgentProcessInspector.identity(for: getpid()))
  #expect(
    harness.host.applyAgentDetection(
      agentDetectionObservation(
        phase: .idle,
        processIdentity: processIdentity,
        sequence: sequence
      ),
      for: harness.context.surfaceID
    )
  )
  return processIdentity
}
