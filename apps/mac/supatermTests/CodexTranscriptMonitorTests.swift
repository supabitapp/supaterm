import Foundation
import Testing

@testable import supaterm

struct CodexTranscriptMonitorTests {
  @Test
  func advanceReadsLatestStatusAndDetail() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(.taskStarted(turnID: "turn-1"), to: transcriptURL)
    try CodexTranscriptFixtures.append(.reasoning("Inspecting the workspace"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.0.offset > cursor.offset)
    #expect(result.1?.status == .started("turn-1"))
    #expect(result.1?.detail == "Thinking...")
  }

  @Test
  func advanceDetectsFinalTurnStatus() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(.taskComplete(turnID: "turn-1"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.status == .completed("turn-1"))
    #expect(result.1?.status?.isFinal == true)
  }

  @Test
  func advancePrefersAssistantMessageOverToolCallWithinSingleRead() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
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
  func advanceUsesExecCommandCmdForToolDetail() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
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

    #expect(result.1?.detail == "sed -n '1,40p' docs/coding-agents-integration.md")
  }

  @Test
  func advanceFormatsGenericToolCallsAsExecuting() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(.functionCall(name: "update_plan"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.detail == "Executing update_plan")
  }

  @Test
  func advanceFallsBackToWorkingWhenExecCommandHasNoCmd() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(.functionCall(name: "exec_command"), to: transcriptURL)

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.detail == "Working...")
  }

  @Test
  func advanceShowsThinkingForEmptyReasoningPayload() throws {
    let transcriptURL = try CodexTranscriptFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let cursor = try #require(CodexTranscriptMonitor.makeCursor(at: transcriptURL.path))
    try CodexTranscriptFixtures.append(
      #"{"timestamp":"2026-04-05T07:00:00.000Z","type":"response_item","payload":{"# +
        #""type":"reasoning","summary":[],"content":null}}"#,
      to: transcriptURL
    )

    let result = try #require(CodexTranscriptMonitor.advance(cursor, at: transcriptURL.path))

    #expect(result.1?.detail == "Thinking...")
  }
}
