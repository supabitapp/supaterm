import Foundation

@testable import supaterm

enum ClaudeProgressFixtures {
  static func makeHomeDirectory() throws -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString,
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }

  static func makeTranscript() throws -> URL {
    let directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString,
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let fileURL = directoryURL.appendingPathComponent("transcript.jsonl")
    try Data().write(to: fileURL)
    return fileURL
  }

  static func appendTodoWrite(
    _ todos: [[String: String]],
    to transcriptURL: URL
  ) throws {
    try appendLine(
      [
        "type": "assistant",
        "message": [
          "content": [
            [
              "type": "tool_use",
              "name": "TodoWrite",
              "input": [
                "todos": todos
              ],
            ]
          ]
        ],
      ],
      to: transcriptURL
    )
  }

  static func appendTaskCreate(
    toolUseID: String,
    subject: String,
    description: String = "",
    activeForm: String = "",
    blockedBy: [String] = [],
    metadata: [String: Any]? = nil,
    taskID: String? = nil,
    timestamp: String = "2026-05-26T15:47:17.000Z",
    to transcriptURL: URL
  ) throws {
    var input: [String: Any] = [
      "subject": subject,
      "description": description,
      "activeForm": activeForm,
    ]
    if !blockedBy.isEmpty {
      input["blockedBy"] = blockedBy
    }
    if let metadata {
      input["metadata"] = metadata
    }
    if let taskID {
      input["id"] = taskID
    }
    try appendLine(
      [
        "type": "assistant",
        "timestamp": timestamp,
        "message": [
          "content": [
            [
              "type": "tool_use",
              "id": toolUseID,
              "name": "TaskCreate",
              "input": input,
            ]
          ]
        ],
      ],
      to: transcriptURL
    )
  }

  static func appendTaskCreateResult(
    toolUseID: String,
    taskID: String,
    subject: String,
    timestamp: String = "2026-05-26T15:47:17.100Z",
    to transcriptURL: URL
  ) throws {
    try appendLine(
      [
        "type": "user",
        "timestamp": timestamp,
        "message": [
          "content": [
            [
              "tool_use_id": toolUseID,
              "type": "tool_result",
              "content": "Task #\(taskID) created successfully: \(subject)",
            ]
          ]
        ],
        "toolUseResult": [
          "task": [
            "id": taskID,
            "subject": subject,
          ]
        ],
      ],
      to: transcriptURL
    )
  }

  static func appendTaskUpdate(
    taskID: String,
    status: String,
    subject: String? = nil,
    addBlockedBy: [String] = [],
    metadata: [String: Any]? = nil,
    timestamp: String = "2026-05-26T15:47:18.000Z",
    to transcriptURL: URL
  ) throws {
    var input: [String: Any] = [
      "taskId": taskID,
      "status": status,
    ]
    if let subject {
      input["subject"] = subject
    }
    if !addBlockedBy.isEmpty {
      input["addBlockedBy"] = addBlockedBy
    }
    if let metadata {
      input["metadata"] = metadata
    }
    try appendLine(
      [
        "type": "assistant",
        "timestamp": timestamp,
        "message": [
          "content": [
            [
              "type": "tool_use",
              "id": "toolu_update_\(taskID)",
              "name": "TaskUpdate",
              "input": input,
            ]
          ]
        ],
      ],
      to: transcriptURL
    )
  }

  static func appendTaskReminder(
    _ tasks: [[String: Any]],
    timestamp: String = "2026-05-26T15:50:27.000Z",
    to transcriptURL: URL
  ) throws {
    try appendLine(
      [
        "type": "attachment",
        "timestamp": timestamp,
        "attachment": [
          "type": "task_reminder",
          "content": tasks,
          "itemCount": tasks.count,
        ],
      ],
      to: transcriptURL
    )
  }

  static func appendGoalStatus(
    condition: String,
    met: Bool,
    timestamp: String = "2026-06-14T14:24:06.660Z",
    to transcriptURL: URL
  ) throws {
    var attachment: [String: Any] = [
      "type": "goal_status",
      "condition": condition,
      "met": met,
    ]
    if !met {
      attachment["sentinel"] = true
    } else {
      attachment["reason"] = "Condition met"
      attachment["iterations"] = 1
      attachment["durationMs"] = 7056
      attachment["tokens"] = 76
    }
    try appendLine(
      [
        "type": "attachment",
        "timestamp": timestamp,
        "attachment": attachment,
      ],
      to: transcriptURL
    )
  }

  static func appendText(
    role: String,
    text: String,
    timestamp: String = "2026-06-14T14:24:06.660Z",
    to transcriptURL: URL
  ) throws {
    try appendLine(
      [
        "type": role,
        "timestamp": timestamp,
        "message": [
          "content": [
            [
              "type": "text",
              "text": text,
            ]
          ]
        ],
      ],
      to: transcriptURL
    )
  }

  static func writeTask(
    id: String,
    subject: String,
    status: String,
    sessionID: String,
    homeDirectoryURL: URL,
    filename: String? = nil,
    blockedBy: [String] = [],
    metadata: [String: Any]? = nil
  ) throws {
    let taskDirectoryURL =
      homeDirectoryURL
      .appendingPathComponent(".claude", isDirectory: true)
      .appendingPathComponent("tasks", isDirectory: true)
      .appendingPathComponent(
        ClaudeTaskProgressReader.sanitizedTaskListID(sessionID),
        isDirectory: true
      )
    try FileManager.default.createDirectory(at: taskDirectoryURL, withIntermediateDirectories: true)
    var object: [String: Any] = [
      "id": id,
      "subject": subject,
      "status": status,
      "blockedBy": blockedBy,
    ]
    if let metadata {
      object["metadata"] = metadata
    }
    let url = taskDirectoryURL.appendingPathComponent(filename ?? "\(id).json")
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try data.write(to: url)
  }

  private static func appendLine(
    _ object: [String: Any],
    to url: URL
  ) throws {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    let handle = try FileHandle(forWritingTo: url)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: data)
    try handle.write(contentsOf: Data([0x0A]))
  }
}
