import Foundation
import Testing

@testable import SupatermAgentFeature
@testable import supaterm

struct AgentTranscriptTailerTests {
  private func makeTranscript(_ contents: String) throws -> String {
    let url = FileManager.default.temporaryDirectory
      .appendingPathComponent("tailer-\(UUID().uuidString).jsonl")
    try Data(contents.utf8).write(to: url)
    return url.path
  }

  @Test
  func startReturnsNilForMissingFile() {
    #expect(AgentTranscriptTailer.start(at: "/nonexistent/transcript.jsonl") == nil)
  }

  @Test
  func startSkipsPartialTrailingLine() throws {
    let path = try makeTranscript(
      """
      {"type":"one"}
      {"type":"two"}
      {"type":"par
      """
    )

    let tick = try #require(AgentTranscriptTailer.start(at: path))

    #expect(tick.objects.map { $0["type"]?.stringValue } == ["one", "two"])
    #expect(!tick.didReset)
  }

  @Test
  func advanceConsumesLineOnceNewlineArrives() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n{\"type\":\"par")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    #expect(started.objects.count == 1)

    try Data("{\"type\":\"one\"}\n{\"type\":\"partial\"}\n".utf8)
      .write(to: URL(fileURLWithPath: path))

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["partial"])
    #expect(!tick.didReset)
  }

  @Test
  func advanceRestartsFromZeroWhenFileTruncates() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n{\"type\":\"two\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))
    #expect(started.objects.count == 2)

    try Data("{\"type\":\"fresh\"}\n".utf8).write(to: URL(fileURLWithPath: path))

    let tick = try #require(AgentTranscriptTailer.advance(started.cursor, at: path))
    #expect(tick.didReset)
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["fresh"])
    #expect(tick.cursor.offset == UInt64("{\"type\":\"fresh\"}\n".utf8.count))
  }

  @Test
  func advanceReturnsNilWhenFileDisappears() throws {
    let path = try makeTranscript("{\"type\":\"one\"}\n")
    let started = try #require(AgentTranscriptTailer.start(at: path))

    try FileManager.default.removeItem(atPath: path)

    #expect(AgentTranscriptTailer.advance(started.cursor, at: path) == nil)
  }

  @Test
  func nonObjectLinesAreSkipped() throws {
    let path = try makeTranscript(
      """
      [1,2,3]
      not json
      {"type":"kept"}
      """ + "\n"
    )

    let tick = try #require(AgentTranscriptTailer.start(at: path))
    #expect(tick.objects.map { $0["type"]?.stringValue } == ["kept"])
  }
}
