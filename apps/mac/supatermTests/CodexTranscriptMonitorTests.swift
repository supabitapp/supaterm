import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

struct CodexTranscriptMonitorTests {
  private struct Advance {
    let cursor: AgentTranscriptTailCursor
    let objects: [JSONObject]
  }

  private func readStart(
    at path: String
  ) -> (cursor: AgentTranscriptTailCursor, objects: [JSONObject])? {
    guard let tick = AgentTranscriptTailer.start(at: path) else { return nil }
    return (tick.cursor, tick.objects)
  }

  private func advance(
    _ cursor: AgentTranscriptTailCursor,
    at path: String
  ) -> Advance? {
    guard let tick = AgentTranscriptTailer.advance(cursor, at: path) else { return nil }
    return Advance(cursor: tick.cursor, objects: tick.objects)
  }

  private func objects(
    _ lines: [CodexTranscriptFixtures.Line]
  ) throws -> [JSONObject] {
    try lines.map { line in
      try #require(
        JSONDecoder().decode(JSONValue.self, from: Data(line.json.utf8)).objectValue
      )
    }
  }

  @MainActor
  private func snapshot(
    _ lines: [CodexTranscriptFixtures.Line]
  ) throws -> AgentMonitorSnapshot {
    let monitor = CodexPanelMonitor()
    return try #require(
      monitor.consume(AgentTranscriptUpdate(objects: objects(lines)))
    )
  }

  @Test
  func agentProgressParsingSupportsUpstreamInProgressStatuses() {
    #expect(AgentProgressParsing.status("in_progress") == .running)
    #expect(AgentProgressParsing.status("inProgress") == .running)
    #expect(AgentProgressParsing.status("inprogress") == .pending)
  }

  @Test
  @MainActor
  func startBuildsProjectionFromSyntheticRolloutItems() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.sessionMeta(id: "session-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the workspace"), to: transcriptURL)

    let result = try #require(readStart(at: transcriptURL.path))
    let monitor = CodexPanelMonitor()
    let projection = try #require(
      monitor.consume(AgentTranscriptUpdate(objects: result.objects))
    )

    #expect(result.cursor.offset > 0)
    #expect(projection.status == .started("turn-1"))
    #expect(projection.detail == "Inspecting the workspace")
    #expect(projection.hoverMessages == ["Inspecting the workspace"])
  }

  @Test
  @MainActor
  func startBuildsCompletedTurnFromSyntheticLifecycle() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .taskComplete(turnID: "turn-1", lastAgentMessage: "Done."),
    ])

    #expect(projection.status == .completed("turn-1"))
    #expect(projection.detail == nil)
    #expect(projection.hoverMessages == ["Done."])
  }

  @Test
  @MainActor
  func exhaustedUsageLimitFailsActiveTurn() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .tokenCount(usedPercent: 100, includesUsage: false),
    ])

    #expect(projection.status == .failed("turn-1"))
  }

  @Test
  @MainActor
  func roundedUsagePercentageDoesNotFailActiveTurn() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .tokenCount(usedPercent: 100, includesUsage: true),
    ])

    #expect(projection.status == .started("turn-1"))
  }

  @Test
  @MainActor
  func advanceIgnoresToolPayloadAndProjectsAssistantMessage() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    let start = try #require(readStart(at: transcriptURL.path))
    let monitor = CodexPanelMonitor()
    _ = monitor.consume(AgentTranscriptUpdate(objects: start.objects))

    try CodexTranscriptFixtures.append(.assistantMessage("Reading the file"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: ["cmd": "sed -n '1,40p' docs/coding-agents-integration.md"]
      ),
      to: transcriptURL
    )

    let result = try #require(advance(start.cursor, at: transcriptURL.path))
    let projection = try #require(
      monitor.consume(AgentTranscriptUpdate(objects: result.objects))
    )

    #expect(projection.status == .started("turn-1"))
    #expect(projection.detail == "Reading the file")
    #expect(projection.hoverMessages == ["Reading the file"])
  }

  @Test
  @MainActor
  func threadGoalUpdatedAddsGoalProgressRow() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .threadGoalUpdated(
        turnID: "turn-1",
        objective: "Ship agent panel goal progress",
        status: "active"
      ),
    ])

    #expect(
      projection.progressRows == [
        PaneAgentProgressRow(
          id: "goal:Ship agent panel goal progress",
          title: "Goal: Ship agent panel goal progress",
          status: .running,
          kind: .goal
        )
      ]
    )
  }

  @Test
  @MainActor
  func internalGoalContextAddsGoalProgressRow() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .goalContext(objective: "figure out what in this folder"),
    ])

    #expect(
      projection.progressRows == [
        PaneAgentProgressRow(
          id: "goal:figure out what in this folder",
          title: "Goal: figure out what in this folder",
          status: .running,
          kind: .goal
        )
      ]
    )
  }

  @Test
  @MainActor
  func activeGoalCarriesIntoManualTurnWithoutGoalContext() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .goalContext(objective: "continue to finish firmware mapping"),
      .turnAborted(turnID: "turn-1"),
      .taskStarted(turnID: "turn-2"),
      .userMessage("try commit again first"),
    ])

    #expect(
      projection.progressRows == [
        PaneAgentProgressRow(
          id: "goal:continue to finish firmware mapping",
          title: "Goal: continue to finish firmware mapping",
          status: .running,
          kind: .goal
        )
      ]
    )
  }

  @Test
  @MainActor
  func completedTurnHidesGoalProgressRow() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .threadGoalUpdated(
        turnID: "turn-1",
        objective: "Ship agent panel goal progress",
        status: "complete"
      ),
      .taskComplete(turnID: "turn-1"),
    ])

    #expect(projection.status == .completed("turn-1"))
    #expect(projection.progressRows.isEmpty)
  }

  @Test
  @MainActor
  func reasoningIsDiscardedWhileAssistantDetailIsProjected() throws {
    let projection = try snapshot([
      .turnContext(turnID: "turn-ctx"),
      .agentReasoning("Planning the next step"),
      .agentMessage("Applying the change"),
    ])

    #expect(projection.status == .started("turn-ctx"))
    #expect(projection.detail == "Applying the change")
    #expect(projection.hoverMessages == ["Applying the change"])
  }

  @Test
  @MainActor
  func startReadsSanitizedJSONLFixture() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript(
      copyingFixtureNamed: "codex-transcript-sanitized.jsonl"
    )
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let result = try #require(readStart(at: transcriptURL.path))
    let monitor = CodexPanelMonitor()
    let projection = try #require(
      monitor.consume(AgentTranscriptUpdate(objects: result.objects))
    )

    #expect(projection.status == .started("turn-fixture"))
    #expect(projection.detail == nil)
  }

  @Test
  func advanceDoesNotConsumePartialLineAfterSanitizedFixture() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript(
      copyingFixtureNamed: "codex-transcript-sanitized.jsonl"
    )
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let start = try #require(readStart(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(
      CodexTranscriptFixtures.Line.assistantMessage("partial").json,
      to: transcriptURL
    )
    let handle = try FileHandle(forWritingTo: transcriptURL)
    defer { try? handle.close() }
    try handle.seekToEnd()
    let offset = handle.offsetInFile
    try handle.truncate(atOffset: offset == 0 ? 0 : offset - 1)

    let result = try #require(advance(start.cursor, at: transcriptURL.path))

    #expect(result.objects.isEmpty)
    #expect(result.cursor.offset == start.cursor.offset)
  }

  @Test
  @MainActor
  func finalAnswerReplacesRunningSidebarState() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .agentMessage("Inspecting the repo"),
      .assistantMessage("Done.", phase: "final_answer"),
    ])

    #expect(projection.detail == nil)
    #expect(projection.hoverMessages == ["Done."])
  }

  @Test
  @MainActor
  func incrementalProjectionMatchesFullProjection() throws {
    let lines = [
      CodexTranscriptFixtures.Line.taskStarted(turnID: "turn-1"),
      .agentMessage("Inspecting the repo"),
      .assistantMessage("Done.", phase: "final_answer"),
    ]
    let fullProjection = try snapshot(lines)
    let incrementalMonitor = CodexPanelMonitor()
    var incrementalProjection: AgentMonitorSnapshot?
    for line in lines {
      incrementalProjection =
        incrementalMonitor.consume(
          AgentTranscriptUpdate(objects: try objects([line]))
        ) ?? incrementalProjection
    }

    #expect(incrementalProjection == fullProjection)
  }

  @Test
  @MainActor
  func monitorRetainsOnlyRecentHoverMessages() throws {
    let messages = (1...12).map { "Progress \($0)" }
    let projection = try snapshot(
      [.taskStarted(turnID: "turn-1")]
        + messages.map { .agentMessage($0) }
    )

    #expect(projection.hoverMessages == Array(messages.suffix(8)))
    #expect(projection.detail == "Progress 12")
    #expect(projection.status == .started("turn-1"))
  }

  @Test
  @MainActor
  func monitorBoundsRetainedHoverMessageLength() throws {
    let projection = try snapshot([
      .taskStarted(turnID: "turn-1"),
      .agentMessage(String(repeating: "x", count: 20_000)),
    ])

    let hoverMessage = try #require(projection.hoverMessages.first)
    #expect(hoverMessage.count == 16_000)
    #expect(hoverMessage.hasSuffix("..."))
    #expect(projection.detail?.count == 160)
  }
}
