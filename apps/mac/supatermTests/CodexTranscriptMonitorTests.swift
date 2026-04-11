import Foundation
import Testing

@testable import supaterm

struct CodexTranscriptMonitorTests {
  @Test
  func startReadsActiveTranscriptSnapshot() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the workspace"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))

    #expect(result.0.offset > 0)
    #expect(result.1?.status == .started("turn-1"))
    #expect(result.1?.detail == "Inspecting the workspace")
  }

  @Test
  func startSuppressesCompletedTranscriptSnapshotButKeepsPolling() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptURL)

    let initial = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))

    #expect(initial.1 == nil)

    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-2"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(initial.0, at: transcriptURL.path))

    #expect(result.1?.status == .started("turn-2"))
  }

  @Test
  func startDoesNotReusePreviousTurnDetailWhenNewTurnOnlyStarted() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.assistantMessage("Finished the previous turn"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-0"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))

    #expect(result.1?.status == .started("turn-1"))
    #expect(result.1?.detail == nil)
  }

  @Test
  func startDoesNotReusePreviousTurnDetailForNewTurnReasoning() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try CodexTranscriptFixtures.append(.assistantMessage("Finished the previous turn"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-0"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.reasoning("Planning the next step"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))

    #expect(result.1?.status == .started("turn-1"))
    #expect(result.1?.detail == nil)
  }

  @Test
  func advancePrefersAssistantMessageOverToolCallWithinSingleRead() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the transcript path"), to: transcriptURL)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "sed -n '1,40p' docs/coding-agents-integration.md"
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.detail == "Inspecting the transcript path")
  }

  @Test
  func advanceIgnoresReasoningAfterAssistantMessageAcrossReads() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (initialCursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(.assistantMessage("Inspecting the transcript path"), to: transcriptURL)

    let firstResult = try #require(CodexTranscriptMonitor.advance(initialCursor, at: transcriptURL.path))

    #expect(firstResult.1?.detail == "Inspecting the transcript path")

    try CodexTranscriptFixtures.append(.reasoning("Planning the next step"), to: transcriptURL)

    let secondResult = try #require(CodexTranscriptMonitor.advance(firstResult.0, at: transcriptURL.path))

    #expect(secondResult.1 == nil)
  }

  @Test
  func advanceIgnoresExecCommandToolDetail() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(
      .functionCall(
        name: "exec_command",
        arguments: [
          "cmd": "sed -n '1,40p' docs/coding-agents-integration.md"
        ]
      ),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1 == nil)
  }

  @Test
  func advanceIgnoresGenericToolCalls() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(.functionCall(name: "update_plan"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1 == nil)
  }

  @Test
  func advanceIgnoresExecCommandWithoutCommandText() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(.functionCall(name: "exec_command"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1 == nil)
  }

  @Test
  func advanceIgnoresReasoningPayloadWithoutMessageText() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(
      #"{"timestamp":"2026-04-05T07:00:00.000Z","type":"response_item","payload":{"type":"reasoning","#
        + #""summary":[],"content":null}}"#,
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1 == nil)
  }

  @Test
  func advanceDetectsFinalTurnStatus() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.status == .completed("turn-1"))
    #expect(result.1?.status?.isFinal == true)
  }

  @Test
  func advanceKeepsFullAssistantMessageForHoverHistory() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let longMessage = Array(repeating: "message", count: 30).joined(separator: " ")
    let truncatedMessage = String(longMessage.prefix(157)) + "..."
    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)

    try CodexTranscriptFixtures.append(.assistantMessage(longMessage), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.detail == truncatedMessage)
    #expect(result.1?.messages == [longMessage])
    #expect(result.1?.replacesMessages == false)
  }

  @Test
  func advanceFinalAssistantMessageReplacesHoverMessagesWithoutRunningDetail() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let (initialCursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)

    try CodexTranscriptFixtures.append(
      .assistantMessage("Inspecting the transcript path"),
      to: transcriptURL
    )

    let firstResult = try #require(CodexTranscriptMonitor.advance(initialCursor, at: transcriptURL.path))

    #expect(firstResult.1?.detail == "Inspecting the transcript path")
    #expect(firstResult.1?.messages == ["Inspecting the transcript path"])
    #expect(firstResult.1?.replacesMessages == false)

    try CodexTranscriptFixtures.append(
      .assistantMessage("Done.", phase: "final_answer"),
      to: transcriptURL
    )

    let secondResult = try #require(CodexTranscriptMonitor.advance(firstResult.0, at: transcriptURL.path))

    #expect(secondResult.1?.detail == nil)
    #expect(secondResult.1?.messages == ["Done."])
    #expect(secondResult.1?.replacesMessages == true)
  }

  @Test
  func advanceTaskCompleteCarriesLastAgentMessageForHoverReplacement() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let longMessage = Array(repeating: "message", count: 30).joined(separator: " ")
    let (cursor, initialUpdate) = try #require(CodexTranscriptMonitor.start(at: transcriptURL.path))
    #expect(initialUpdate == nil)
    try CodexTranscriptFixtures.append(
      .taskComplete(turnID: "turn-1", lastAgentMessage: longMessage),
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.status == .completed("turn-1"))
    #expect(result.1?.detail == nil)
    #expect(result.1?.messages == [longMessage])
    #expect(result.1?.replacesMessages == true)
  }
}
