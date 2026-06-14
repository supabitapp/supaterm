import Foundation
import Testing

@testable import supaterm

struct CodexTranscriptMonitorTests {
  @Test
  func agentProgressParsingSupportsUpstreamInProgressStatuses() {
    #expect(AgentProgressParsing.status("in_progress") == .running)
    #expect(AgentProgressParsing.status("inProgress") == .running)
    #expect(AgentProgressParsing.status("inprogress") == .pending)
  }

  @Test
  func startBuildsConversationFromSyntheticRolloutItems() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.sessionMeta(id: "session-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the workspace"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot

    #expect(result.0.offset > 0)
    #expect(conversation.sessionID == "session-1")
    #expect(batch.records.count == 3)
    #expect(snapshot.status == .started("turn-1"))
    #expect(snapshot.detail == "Inspecting the workspace")
    #expect(snapshot.hoverMessages == ["Inspecting the workspace"])
  }

  @Test
  func startBuildsCompletedTurnFromSyntheticLifecycle() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1", lastAgentMessage: "Done."), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot

    #expect(snapshot.status == .completed("turn-1"))
    #expect(snapshot.detail == nil)
    #expect(snapshot.hoverMessages == ["Done."])
    #expect(conversation.turns.count == 1)
    #expect(conversation.turns[0].status == .completed)
  }

  @Test
  func advanceReconstructsSyntheticToolAndAssistantItems() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    let start = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    var conversation = CodexConversationState()
    if let batch = start.1 {
      conversation.absorb(batch.records)
    }

    try CodexTranscriptFixtures.append(.assistantMessage("Reading the file"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "sed -n '1,40p' docs/coding-agents-integration.md"
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(start.0, at: transcriptURL.path))
    let batch = try #require(result.batch)
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot

    #expect(snapshot.status == .started("turn-1"))
    #expect(snapshot.detail == "Reading the file")
    #expect(snapshot.hoverMessages == ["Reading the file"])
    #expect(conversation.turns[0].items.count == 2)
  }

  @Test
  func updatePlanFunctionCallUpdatesProgressRows() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "update_plan",
        arguments: [
          "plan": [
            ["step": "Read terminal state", "status": "completed"],
            ["step": "Wire panel overlay", "status": "inProgress"],
            ["step": "Run tests", "status": "pending"],
          ]
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)

    #expect(
      conversation.sidebarSnapshot.progressRows == [
        PaneAgentProgressRow(
          id: "0:Read terminal state",
          title: "Read terminal state",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "1:Wire panel overlay",
          title: "Wire panel overlay",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "2:Run tests",
          title: "Run tests",
          status: .pending
        ),
      ]
    )
  }

  @Test
  func threadGoalUpdatedAddsGoalProgressRow() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .threadGoalUpdated(
        turnID: "turn-1",
        objective: "Ship agent panel goal progress",
        status: "active"
      ),
      to: transcriptURL
    )
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "update_plan",
        arguments: [
          "plan": [
            ["step": "Wire goal parser", "status": "completed"],
            ["step": "Run tests", "status": "in_progress"],
          ]
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)

    #expect(
      conversation.sidebarSnapshot.progressRows == [
        PaneAgentProgressRow(
          id: "goal:Ship agent panel goal progress",
          title: "Goal: Ship agent panel goal progress",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "0:Wire goal parser",
          title: "Wire goal parser",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "1:Run tests",
          title: "Run tests",
          status: .running
        ),
      ]
    )
  }

  @Test
  func internalGoalContextAddsGoalProgressRow() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .goalContext(objective: "figure out what in this folder"),
      to: transcriptURL
    )
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "update_plan",
        arguments: [
          "plan": [
            ["step": "Inspect top-level contents and metadata", "status": "in_progress"],
            ["step": "Summarize what matters in the folder", "status": "pending"],
          ]
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)

    #expect(
      conversation.sidebarSnapshot.progressRows == [
        PaneAgentProgressRow(
          id: "goal:figure out what in this folder",
          title: "Goal: figure out what in this folder",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "0:Inspect top-level contents and metadata",
          title: "Inspect top-level contents and metadata",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "1:Summarize what matters in the folder",
          title: "Summarize what matters in the folder",
          status: .pending
        ),
      ]
    )
  }

  @Test
  func activeGoalCarriesIntoManualTurnWithoutGoalContext() {
    var conversation = CodexConversationState()
    conversation.absorb(
      [
        .eventMessage(type: "task_started", payload: ["turn_id": .string("turn-1")]),
        .responseItem(
          type: "message",
          payload: [
            "role": .string("user"),
            "content": .array([
              .object([
                "text": .string(
                  """
                  <codex_internal_context source="goal">
                  <objective>
                  continue to finish firmware mapping
                  </objective>
                  </codex_internal_context>
                  """
                )
              ])
            ]),
          ]
        ),
        .eventMessage(type: "turn_aborted", payload: ["turn_id": .string("turn-1")]),
        .eventMessage(type: "task_started", payload: ["turn_id": .string("turn-2")]),
        .responseItem(
          type: "message",
          payload: [
            "role": .string("user"),
            "content": .array([.object(["text": .string("try commit again first")])]),
          ]
        ),
        .responseItem(
          type: "function_call",
          payload: [
            "name": .string("update_plan"),
            "arguments": .string(
              #"{"plan":[{"step":"Commit and push operand evidence work","status":"in_progress"}]}"#
            ),
          ]
        ),
      ]
    )

    #expect(
      conversation.sidebarSnapshot.progressRows == [
        PaneAgentProgressRow(
          id: "goal:continue to finish firmware mapping",
          title: "Goal: continue to finish firmware mapping",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "0:Commit and push operand evidence work",
          title: "Commit and push operand evidence work",
          status: .running
        ),
      ]
    )
  }

  @Test
  func completedTurnHidesGoalProgressRow() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .threadGoalUpdated(
        turnID: "turn-1",
        objective: "Ship agent panel goal progress",
        status: "complete"
      ),
      to: transcriptURL
    )
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)

    #expect(conversation.sidebarSnapshot.status == .completed("turn-1"))
    #expect(conversation.sidebarSnapshot.progressRows.isEmpty)
  }

  @Test
  func completedTurnHidesProgressRows() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "update_plan",
        arguments: [
          "plan": [
            ["step": "Inspect state", "status": "completed"],
            ["step": "Commit and push scoped changes", "status": "in_progress"],
            ["step": "Report final status", "status": "pending"],
          ]
        ]
      ),
      to: transcriptURL
    )
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)

    #expect(conversation.sidebarSnapshot.status == .completed("turn-1"))
    #expect(conversation.sidebarSnapshot.progressRows.isEmpty)
  }

  @Test
  func advanceReconstructsSyntheticReasoningStream() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.turnContext(turnID: "turn-ctx"), to: transcriptURL)
    let start = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    var conversation = CodexConversationState()
    if let batch = start.1 {
      conversation.absorb(batch.records)
    }

    try CodexTranscriptFixtures.append(.agentReasoning("Planning the next step"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.agentMessage("Applying the change"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(start.0, at: transcriptURL.path))
    let batch = try #require(result.batch)
    conversation.absorb(batch.records)

    #expect(conversation.turns.count == 1)
    #expect(conversation.turns[0].id == "turn-ctx")
    #expect(conversation.turns[0].items.count == 2)
    #expect(conversation.sidebarSnapshot.detail == "Applying the change")
  }

  @Test
  func startReadsSanitizedJSONLFixture() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript(
      copyingFixtureNamed: "codex-transcript-sanitized.jsonl"
    )
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    let batch = try #require(result.1)
    var conversation = CodexConversationState()
    conversation.absorb(batch.records)
    let snapshot = conversation.sidebarSnapshot

    #expect(conversation.sessionID == "session-fixture")
    #expect(conversation.turns.count == 1)
    #expect(conversation.turns[0].id == "turn-fixture")
    #expect(snapshot.status == .started("turn-fixture"))
    #expect(snapshot.detail == nil)
  }

  @Test
  func advanceDoesNotConsumePartialLineAfterSanitizedFixture() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript(
      copyingFixtureNamed: "codex-transcript-sanitized.jsonl"
    )
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let start = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))

    let partialMessage = CodexTranscriptFixtures.Line.assistantMessage("partial").json
    try CodexTranscriptFixtures.append(
      partialMessage,
      to: transcriptURL
    )
    let handle = try FileHandle(forWritingTo: transcriptURL)
    defer { try? handle.close() }
    try handle.seekToEnd()
    let offset = handle.offsetInFile
    try handle.truncate(atOffset: offset == 0 ? 0 : offset - 1)

    let result = try #require(CodexTranscriptMonitor.advance(start.0, at: transcriptURL.path))

    #expect(result.batch == nil)
    #expect(result.cursor.offset == start.0.offset)
  }

  @Test
  func finalAnswerReplacesRunningSidebarState() {
    var conversation = CodexConversationState()
    conversation.absorb(
      [
        .eventMessage(type: "task_started", payload: ["turn_id": .string("turn-1")]),
        .eventMessage(type: "agent_message", payload: ["message": .string("Inspecting the repo")]),
        .responseItem(
          type: "message",
          payload: [
            "role": .string("assistant"),
            "phase": .string("final_answer"),
            "content": .array([.object(["text": .string("Done.")])]),
          ]
        ),
      ]
    )

    #expect(conversation.sidebarSnapshot.detail == nil)
    #expect(conversation.sidebarSnapshot.hoverMessages == ["Done."])
  }

  @Test
  func fullRecomputeMatchesIncrementalAssistantSidebarState() {
    var incrementalConversation = CodexConversationState()
    incrementalConversation.absorb(
      [
        .eventMessage(type: "task_started", payload: ["turn_id": .string("turn-1")]),
        .eventMessage(type: "agent_message", payload: ["message": .string("Inspecting the repo")]),
        .responseItem(
          type: "message",
          payload: [
            "role": .string("assistant"),
            "phase": .string("final_answer"),
            "content": .array([.object(["text": .string("Done.")])]),
          ]
        ),
      ]
    )

    let rebuiltConversation = CodexConversationState(
      turns: [
        CodexConversationTurn(
          id: "turn-1",
          status: .inProgress,
          error: nil,
          items: [
            .message(CodexConversationMessage(role: "assistant", text: "Inspecting the repo", phase: nil)),
            .message(CodexConversationMessage(role: "assistant", text: "Done.", phase: "final_answer")),
          ],
          startedAt: nil,
          completedAt: nil,
          durationMs: nil
        )
      ]
    )

    #expect(incrementalConversation.sidebarSnapshot == rebuiltConversation.sidebarSnapshot)
  }
}
