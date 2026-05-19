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
      .appendingPathComponent(ClaudeTaskProgressReader.sanitizedTaskListID(sessionID), isDirectory: true)
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
