import Foundation
import Testing

@testable import supaterm

struct ClaudeProgressMonitorTests {
  @Test
  func taskFilesProduceProgressRows() throws {
    let homeDirectoryURL = try ClaudeProgressFixtures.makeHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }

    try ClaudeProgressFixtures.writeTask(
      id: "task-2",
      subject: "Wire panel rows",
      status: "in_progress",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL,
      filename: "2.json"
    )
    try ClaudeProgressFixtures.writeTask(
      id: "task-1",
      subject: "Read tasks",
      status: "completed",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL,
      filename: "1.json"
    )
    try ClaudeProgressFixtures.writeTask(
      id: "task-internal",
      subject: "Internal task",
      status: "pending",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL,
      filename: "3.json",
      metadata: ["_internal": true]
    )

    #expect(
      ClaudeTaskProgressReader.progressRows(
        sessionID: "session:123",
        homeDirectoryURL: homeDirectoryURL
      ) == [
        PaneAgentProgressRow(
          id: "claude-task:task-1",
          title: "Read tasks",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "claude-task:task-2",
          title: "Wire panel rows",
          status: .running
        ),
      ]
    )
  }

  @Test
  func taskFilesUseClaudeCodeCompactOrder() throws {
    let homeDirectoryURL = try ClaudeProgressFixtures.makeHomeDirectory()
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    try ClaudeProgressFixtures.writeTask(
      id: "1",
      subject: "Blocked pending",
      status: "pending",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL,
      blockedBy: ["2"]
    )
    try ClaudeProgressFixtures.writeTask(
      id: "2",
      subject: "Current task",
      status: "in_progress",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL
    )
    try ClaudeProgressFixtures.writeTask(
      id: "3",
      subject: "Recent completion",
      status: "completed",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL
    )
    try ClaudeProgressFixtures.writeTask(
      id: "4",
      subject: "Older completion",
      status: "completed",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL
    )
    try ClaudeProgressFixtures.writeTask(
      id: "5",
      subject: "Available pending",
      status: "pending",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL
    )
    try setTaskModificationDate(
      now.addingTimeInterval(-31),
      id: "4",
      sessionID: "session:123",
      homeDirectoryURL: homeDirectoryURL
    )

    #expect(
      ClaudeTaskProgressReader.progressRows(
        sessionID: "session:123",
        homeDirectoryURL: homeDirectoryURL,
        now: now
      ) == [
        PaneAgentProgressRow(
          id: "claude-task:3",
          title: "Recent completion",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "claude-task:2",
          title: "Current task",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "claude-task:5",
          title: "Available pending",
          status: .pending
        ),
        PaneAgentProgressRow(
          id: "claude-task:1",
          title: "Blocked pending",
          status: .pending
        ),
        PaneAgentProgressRow(
          id: "claude-task:4",
          title: "Older completion",
          status: .completed
        ),
      ]
    )
  }

  @Test
  func todoWriteTranscriptProducesProgressRows() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTodoWrite(
      [
        ["content": "Read transcript", "status": "completed"],
        ["content": "Wire rows", "status": "in_progress"],
        ["content": "Run tests", "status": "pending"],
      ],
      to: transcriptURL
    )

    let result = ClaudeTodoTranscriptMonitor.start(at: transcriptURL.path)

    #expect(
      result.rows == [
        PaneAgentProgressRow(
          id: "claude-todo:0:Read transcript",
          title: "Read transcript",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "claude-todo:1:Wire rows",
          title: "Wire rows",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "claude-todo:2:Run tests",
          title: "Run tests",
          status: .pending
        ),
      ]
    )
  }

  @Test
  func advanceConsumesOnlyCompleteTranscriptLines() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let start = ClaudeTodoTranscriptMonitor.start(at: transcriptURL.path)
    let handle = try FileHandle(forWritingTo: transcriptURL)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(#"{"type":"assistant"}"#.utf8))

    let result = try #require(ClaudeTodoTranscriptMonitor.advance(start.cursor, at: transcriptURL.path))

    #expect(result.cursor.transcriptOffset == start.cursor.transcriptOffset)
    #expect(result.rows == nil)
  }

  private func setTaskModificationDate(
    _ date: Date,
    id: String,
    sessionID: String,
    homeDirectoryURL: URL
  ) throws {
    let taskURL =
      homeDirectoryURL
      .appendingPathComponent(".claude", isDirectory: true)
      .appendingPathComponent("tasks", isDirectory: true)
      .appendingPathComponent(ClaudeTaskProgressReader.sanitizedTaskListID(sessionID), isDirectory: true)
      .appendingPathComponent("\(id).json")
    try FileManager.default.setAttributes([.modificationDate: date], ofItemAtPath: taskURL.path)
  }
}
