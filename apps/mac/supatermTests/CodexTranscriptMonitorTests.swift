import Foundation
import Testing

@testable import supaterm

struct CodexTranscriptMonitorTests {
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
    let snapshot = CodexTranscriptSnapshot(conversation: conversation)

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
    let snapshot = CodexTranscriptSnapshot(conversation: conversation)

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
    let batch = try #require(result.1)
    conversation.absorb(batch.records)
    let snapshot = CodexTranscriptSnapshot(conversation: conversation)

    #expect(snapshot.status == .started("turn-1"))
    #expect(snapshot.detail == "Reading the file")
    #expect(snapshot.hoverMessages == ["Reading the file"])
    #expect(conversation.turns[0].items.count == 2)
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
    let batch = try #require(result.1)
    conversation.absorb(batch.records)

    #expect(conversation.turns.count == 1)
    #expect(conversation.turns[0].id == "turn-ctx")
    #expect(conversation.turns[0].items.count == 2)
    #expect(CodexTranscriptSnapshot(conversation: conversation).detail == "Applying the change")
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
    let snapshot = CodexTranscriptSnapshot(conversation: conversation)

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

    #expect(result.1 == nil)
    #expect(result.0.offset == start.0.offset)
  }
}
