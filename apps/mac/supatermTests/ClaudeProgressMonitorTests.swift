import Foundation
import Testing

@testable import supaterm

@MainActor
struct ClaudeProgressMonitorTests {
  private func rows(at path: String) throws -> [PaneAgentProgressRow] {
    let tick = try #require(AgentTranscriptTailer.start(at: path))
    return try #require(ClaudePanelMonitor().consume(AgentTranscriptUpdate(tick))).progressRows
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

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
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
  func goalStatusTranscriptPrependsGoalProgressRow() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendGoalStatus(
      condition: "Ship session goal progress",
      met: false,
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTodoWrite(
      [
        ["content": "Read transcript", "status": "completed"],
        ["content": "Wire rows", "status": "in_progress"],
      ],
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
        PaneAgentProgressRow(
          id: "claude-goal:Ship session goal progress",
          title: "Goal: Ship session goal progress",
          status: .running,
          kind: .goal
        ),
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
      ]
    )
  }

  @Test
  func completedGoalStatusMarksGoalProgressRowCompleted() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendGoalStatus(
      condition: "Ship session goal progress",
      met: true,
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
        PaneAgentProgressRow(
          id: "claude-goal:Ship session goal progress",
          title: "Goal: Ship session goal progress",
          status: .completed,
          kind: .goal
        )
      ]
    )
  }

  @Test
  func panelMonitorPrependsGoalRowToTaskRows() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendGoalStatus(
      condition: "Ship session goal progress",
      met: false,
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Task row",
          "status": "in_progress",
          "blockedBy": [],
        ]
      ],
      to: transcriptURL
    )

    let monitor = ClaudePanelMonitor()
    let transcriptTick = try #require(AgentTranscriptTailer.start(at: transcriptURL.path))
    let snapshot = try #require(monitor.consume(AgentTranscriptUpdate(transcriptTick)))

    #expect(
      snapshot.progressRows == [
        PaneAgentProgressRow(
          id: "claude-goal:Ship session goal progress",
          title: "Goal: Ship session goal progress",
          status: .running,
          kind: .goal
        ),
        PaneAgentProgressRow(
          id: "claude-task:1",
          title: "Task row",
          status: .running
        ),
      ]
    )
  }

  @Test
  func taskCreateAndUpdateTranscriptProducesProgressRows() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTaskCreate(
      toolUseID: "toolu_create_1",
      subject: "Wire transcript tasks",
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskCreateResult(
      toolUseID: "toolu_create_1",
      taskID: "1",
      subject: "Wire transcript tasks",
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskUpdate(
      taskID: "1",
      status: "in_progress",
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
        PaneAgentProgressRow(
          id: "claude-task:1",
          title: "Wire transcript tasks",
          status: .running
        )
      ]
    )
  }

  @Test
  func transcriptTasksKeepTaskIDOrderAcrossStatusChanges() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTaskReminder(
      [
        ["id": "1", "subject": "Phase A", "status": "completed", "blockedBy": []],
        ["id": "2", "subject": "Phase B1", "status": "in_progress", "blockedBy": []],
        ["id": "3", "subject": "Phase B2", "status": "pending", "blockedBy": []],
        ["id": "10", "subject": "Phase C", "status": "pending", "blockedBy": []],
      ],
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskUpdate(
      taskID: "2",
      status: "completed",
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskUpdate(
      taskID: "3",
      status: "in_progress",
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
        PaneAgentProgressRow(
          id: "claude-task:1",
          title: "Phase A",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "claude-task:2",
          title: "Phase B1",
          status: .completed
        ),
        PaneAgentProgressRow(
          id: "claude-task:3",
          title: "Phase B2",
          status: .running
        ),
        PaneAgentProgressRow(
          id: "claude-task:10",
          title: "Phase C",
          status: .pending
        ),
      ]
    )
  }

  @Test
  func taskReminderTranscriptProducesProgressRows() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Render reminder task",
          "status": "in_progress",
          "blockedBy": [],
        ],
        [
          "id": "internal",
          "subject": "Internal task",
          "status": "pending",
          "blockedBy": [],
          "metadata": ["_internal": true],
        ],
      ],
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(
      rows == [
        PaneAgentProgressRow(
          id: "claude-task:1",
          title: "Render reminder task",
          status: .running
        )
      ]
    )
  }

  @Test
  func emptyTaskReminderClearsTranscriptRows() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTaskReminder(
      [
        [
          "id": "1",
          "subject": "Task to clear",
          "status": "in_progress",
          "blockedBy": [],
        ]
      ],
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskReminder(
      [],
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(rows == [])
  }

  @Test
  func taskUpdateDeletesTranscriptTask() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    try ClaudeProgressFixtures.appendTaskCreate(
      toolUseID: "toolu_create_1",
      subject: "Delete transcript task",
      taskID: "1",
      to: transcriptURL
    )
    try ClaudeProgressFixtures.appendTaskUpdate(
      taskID: "1",
      status: "deleted",
      to: transcriptURL
    )

    let rows = try rows(at: transcriptURL.path)

    #expect(rows == [])
  }

  @Test
  func advanceConsumesOnlyCompleteTranscriptLines() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }

    let monitor = ClaudePanelMonitor()
    let start = try #require(AgentTranscriptTailer.start(at: transcriptURL.path))
    _ = monitor.consume(AgentTranscriptUpdate(start))
    let handle = try FileHandle(forWritingTo: transcriptURL)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data(#"{"type":"assistant"}"#.utf8))

    let result = try #require(AgentTranscriptTailer.advance(start.cursor, at: transcriptURL.path))

    #expect(result.cursor.offset == start.cursor.offset)
    #expect(monitor.consume(AgentTranscriptUpdate(result)) == nil)
  }

  @Test
  func advanceConsumesLineThatWasPartialWhenCursorWasPersisted() throws {
    let transcriptURL = try ClaudeProgressFixtures.makeTranscript()
    defer { try? FileManager.default.removeItem(at: transcriptURL.deletingLastPathComponent()) }
    let line = try JSONSerialization.data(
      withJSONObject: [
        "type": "assistant",
        "padding": String(repeating: "x", count: 70 * 1024),
        "message": [
          "content": [
            [
              "type": "tool_use",
              "name": "TodoWrite",
              "input": [
                "todos": [
                  ["content": "Persist boundary", "status": "in_progress"]
                ]
              ],
            ]
          ]
        ],
      ],
      options: [.sortedKeys]
    )
    let splitIndex = line.count / 2
    try Data(line.prefix(splitIndex)).write(to: transcriptURL)
    let monitor = ClaudePanelMonitor()
    let start = try #require(AgentTranscriptTailer.start(at: transcriptURL.path))
    _ = monitor.consume(AgentTranscriptUpdate(start))

    let handle = try FileHandle(forWritingTo: transcriptURL)
    try handle.seekToEnd()
    try handle.write(contentsOf: line.suffix(from: splitIndex))
    try handle.write(contentsOf: Data([0x0A]))
    try handle.close()

    let result = try #require(AgentTranscriptTailer.advance(start.cursor, at: transcriptURL.path))
    let snapshot = try #require(monitor.consume(AgentTranscriptUpdate(result)))

    #expect(
      snapshot.progressRows == [
        PaneAgentProgressRow(
          id: "claude-todo:0:Persist boundary",
          title: "Persist boundary",
          status: .running
        )
      ]
    )
  }
}
