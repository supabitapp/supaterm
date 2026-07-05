import ComposableArchitecture
import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalAgentSessionStoreTests {
  @Test
  func recordsSessionSurfaceID() {
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(15),
      transcriptPollInterval: .seconds(1),
      sleep: { _ in }
    )
    let surfaceID = UUID()
    let context = SupatermCLIContext(surfaceID: surfaceID, tabID: UUID())

    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: nil
    )

    #expect(store.sessionSurfaceID(agent: .claude, sessionID: "session-1") == surfaceID)
  }

  @Test
  func runningTimeoutNotifiesDelegate() async {
    let clock = TestClock()
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)

    store.armRunningTimeout(agent: .codex, sessionID: "session-1", context: nil)

    await flushEffects()
    await clock.advance(by: .seconds(5))
    await flushEffects()

    #expect(events.expirations.count == 1)
    #expect(events.expirations.first?.0 == .codex)
    #expect(events.expirations.first?.1 == "session-1")
  }

  @Test
  func clearSessionCancelsPendingTimeout() async {
    let clock = TestClock()
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let surfaceID = UUID()

    store.beginSession(
      agent: .codex,
      sessionID: "session-1",
      context: SupatermCLIContext(surfaceID: surfaceID, tabID: UUID()),
      transcriptPath: nil
    )
    store.armRunningTimeout(agent: .codex, sessionID: "session-1", context: nil)
    store.clearSession(agent: .codex, sessionID: "session-1")

    await flushEffects()
    await clock.advance(by: .seconds(5))
    await flushEffects()

    #expect(events.expirations.isEmpty)
  }

  @Test
  func beginAgentPanelTrackingRejectsAgentsWithoutMonitors() {
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { _ in }
    )
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .pi,
      sessionID: "session-1",
      context: context,
      transcriptPath: nil
    )

    #expect(!store.beginAgentPanelTracking(agent: .pi, sessionID: "session-1", context: context))
  }

  @Test
  func beginCodexTrackingPublishesActiveTranscriptSnapshot() throws {
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { _ in }
    )
    events.bind(to: store)
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .codex,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )

    #expect(store.beginAgentPanelTracking(agent: .codex, sessionID: "session-1", context: context))
    #expect(events.transcriptSnapshots.count == 1)
    #expect(events.transcriptSnapshots.first?.status == .started("turn-1"))
    #expect(events.transcriptSnapshots.first?.detail == nil)
  }

  @Test
  func beginCodexTrackingIgnoresStaleFinalSnapshotAndPublishesLaterTurn() async throws {
    let clock = TestClock()
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-0"), to: transcriptURL)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .codex,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )

    #expect(store.beginAgentPanelTracking(agent: .codex, sessionID: "session-1", context: context))
    #expect(events.transcriptSnapshots.isEmpty)

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)

    await flushEffects()
    await clock.advance(by: .seconds(1))
    await flushEffects()

    #expect(events.transcriptSnapshots.count == 1)
    #expect(events.transcriptSnapshots.first?.status == .started("turn-1"))
    #expect(events.transcriptSnapshots.first?.detail == nil)
  }

  @Test
  func beginClaudePanelTrackingPublishesTranscriptTaskSnapshot() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { _ in }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Transcript task row",
          "status": "in_progress",
          "blockedBy": [],
        ]
      ],
      to: transcriptURL
    )
    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )

    #expect(store.beginAgentPanelTracking(agent: .claude, sessionID: "session-1", context: context))
    #expect(
      events.panelSnapshots == [
        AgentMonitorSnapshot(
          progressRows: [
            PaneAgentProgressRow(
              id: "claude-task:1",
              title: "Transcript task row",
              status: .running
            )
          ]
        )
      ]
    )
  }

  @Test
  func beginClaudePanelTrackingPollsTranscriptTaskChanges() async throws {
    let clock = TestClock()
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(5),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )

    #expect(store.beginAgentPanelTracking(agent: .claude, sessionID: "session-1", context: context))
    #expect(events.panelSnapshots == [AgentMonitorSnapshot()])

    try ClaudeProgressFixtures.appendTaskCreate(
      toolUseID: "toolu_create_1",
      subject: "Polled transcript row",
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskCreateResult(
      toolUseID: "toolu_create_1",
      taskID: "1",
      subject: "Polled transcript row",
      to: transcriptURL
    )

    await flushEffects()
    await clock.advance(by: .seconds(1))
    await flushEffects()

    #expect(
      events.panelSnapshots.last
        == AgentMonitorSnapshot(
          progressRows: [
            PaneAgentProgressRow(
              id: "claude-task:1",
              title: "Polled transcript row",
              status: .pending
            )
          ]
        )
    )
  }

  @Test
  func transcriptGrowthExtendsArmedRunningTimeout() async throws {
    let clock = TestClock()
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(3),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )
    #expect(store.beginAgentPanelTracking(agent: .claude, sessionID: "session-1", context: context))
    store.armRunningTimeout(agent: .claude, sessionID: "session-1", context: context)
    await flushEffects()

    for toolUseID in ["toolu_1", "toolu_2"] {
      try ClaudeProgressFixtures.appendTaskCreate(
        toolUseID: toolUseID,
        subject: "Heartbeat line",
        to: transcriptURL
      )
      await clock.advance(by: .seconds(1))
      await flushEffects()
    }
    await clock.advance(by: .seconds(2))
    await flushEffects()

    #expect(events.expirations.isEmpty)
  }

  @Test
  func transcriptGrowthDoesNotRearmCancelledRunningTimeout() async throws {
    let clock = TestClock()
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(3),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )
    #expect(store.beginAgentPanelTracking(agent: .claude, sessionID: "session-1", context: context))
    store.armRunningTimeout(agent: .claude, sessionID: "session-1", context: context)
    await flushEffects()
    store.cancelRunningTimeout(agent: .claude, sessionID: "session-1")

    try ClaudeProgressFixtures.appendTaskCreate(
      toolUseID: "toolu_1",
      subject: "Heartbeat line",
      to: transcriptURL
    )
    for _ in 0..<5 {
      await clock.advance(by: .seconds(1))
      await flushEffects()
    }

    #expect(events.expirations.isEmpty)
  }

  @Test
  func runningTimeoutExpiresAfterTranscriptGoesQuiet() async throws {
    let clock = TestClock()
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let events = SessionStoreEventsSpy()
    let store = TerminalAgentSessionStore(
      agentRunningTimeout: .seconds(3),
      transcriptPollInterval: .seconds(1),
      sleep: { duration in
        try await clock.sleep(for: duration)
      }
    )
    events.bind(to: store)
    let context = SupatermCLIContext(surfaceID: UUID(), tabID: UUID())
    store.beginSession(
      agent: .claude,
      sessionID: "session-1",
      context: context,
      transcriptPath: transcriptURL.path
    )
    #expect(store.beginAgentPanelTracking(agent: .claude, sessionID: "session-1", context: context))
    store.armRunningTimeout(agent: .claude, sessionID: "session-1", context: context)
    await flushEffects()

    try ClaudeProgressFixtures.appendTaskCreate(
      toolUseID: "toolu_1",
      subject: "Heartbeat line",
      to: transcriptURL
    )
    await clock.advance(by: .seconds(1))
    await flushEffects()
    await clock.advance(by: .seconds(2))
    await flushEffects()

    #expect(events.expirations.isEmpty)

    await clock.advance(by: .seconds(1))
    await flushEffects()

    #expect(events.expirations.count == 1)
    #expect(events.expirations.first?.0 == .claude)
    #expect(events.expirations.first?.1 == "session-1")
  }

  private func flushEffects() async {
    for _ in 0..<5 {
      await Task.yield()
    }
  }
}

@MainActor
private final class SessionStoreEventsSpy {
  var expirations: [(SupatermAgentKind, String)] = []
  var panelSnapshots: [AgentMonitorSnapshot] = []
  var transcriptSnapshots: [AgentMonitorSnapshot] = []

  func bind(to store: TerminalAgentSessionStore) {
    store.onMonitorSnapshot = { [weak self] snapshot, _, _, _ in
      if snapshot.status != nil {
        self?.transcriptSnapshots.append(snapshot)
      } else {
        self?.panelSnapshots.append(snapshot)
      }
    }
    store.onRunningTimeoutExpired = { [weak self] agent, sessionID, _ in
      self?.expirations.append((agent, sessionID))
    }
  }
}
