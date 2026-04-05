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
    #expect(result.1?.detail == "Reasoning · Inspecting the workspace")
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
}
