import Foundation

enum CodexTranscriptFixtures {
  private static func fixtureURL(named name: String) -> URL {
    URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .appendingPathComponent("Fixtures")
      .appendingPathComponent(name)
  }

  enum Line {
    case sessionMeta(id: String)
    case taskStarted(turnID: String)
    case turnStarted(turnID: String)
    case taskComplete(turnID: String, lastAgentMessage: String? = nil)
    case tokenCount(usedPercent: Int, includesUsage: Bool)
    case turnComplete(turnID: String)
    case turnAborted(turnID: String)
    case turnContext(turnID: String)
    case threadGoalUpdated(turnID: String, objective: String, status: String)
    case goalContext(objective: String)
    case userMessage(String)
    case localShellCall(command: [String])
    case functionCall(name: String, arguments: [String: Any]? = nil, callID: String = "call-1")
    case reasoning(String)
    case assistantMessage(String, phase: String? = nil)
    case agentReasoning(String)
    case agentMessage(String, phase: String? = nil)

    var json: String {
      let object: [String: Any]
      switch self {
      case .sessionMeta(let id):
        object = [
          "timestamp": "2026-04-05T07:00:00.000Z",
          "type": "session_meta",
          "payload": [
            "id": id
          ],
        ]

      case .taskStarted(let turnID):
        object = event(
          type: "task_started",
          payload: [
            "turn_id": turnID,
            "model_context_window": NSNull(),
            "collaboration_mode_kind": "default",
          ]
        )

      case .turnStarted(let turnID):
        object = event(
          type: "turn_started",
          payload: [
            "turn_id": turnID
          ]
        )

      case .taskComplete(let turnID, let lastAgentMessage):
        var payload: [String: Any] = ["turn_id": turnID]
        if let lastAgentMessage {
          payload["last_agent_message"] = lastAgentMessage
        }
        object = event(type: "task_complete", payload: payload)

      case .tokenCount(let usedPercent, let includesUsage):
        object = event(
          type: "token_count",
          payload: [
            "info": includesUsage ? ["model_context_window": 353_400] : NSNull(),
            "rate_limits": [
              "primary": ["used_percent": usedPercent],
              "rate_limit_reached_type": NSNull(),
            ],
          ]
        )

      case .turnComplete(let turnID):
        object = event(
          type: "turn_complete",
          payload: [
            "turn_id": turnID
          ]
        )

      case .turnAborted(let turnID):
        object = event(
          type: "turn_aborted",
          payload: [
            "turn_id": turnID,
            "reason": "interrupted",
          ]
        )

      case .turnContext(let turnID):
        object = [
          "timestamp": "2026-04-05T07:00:00.000Z",
          "type": "turn_context",
          "payload": [
            "turn_id": turnID
          ],
        ]

      case .threadGoalUpdated(let turnID, let objective, let status):
        object = event(
          type: "thread_goal_updated",
          payload: [
            "threadId": "thread-1",
            "turnId": turnID,
            "goal": [
              "threadId": "thread-1",
              "objective": objective,
              "status": status,
              "tokensUsed": 1200,
              "timeUsedSeconds": 90,
              "createdAt": 1,
              "updatedAt": 2,
            ],
          ]
        )

      case .goalContext(let objective):
        object = responseItem(
          payload: [
            "type": "message",
            "role": "user",
            "content": [
              [
                "type": "input_text",
                "text": """
                <codex_internal_context source="goal">
                Continue working toward the active thread goal.

                <objective>
                \(objective)
                </objective>
                </codex_internal_context>
                """,
              ]
            ],
          ]
        )

      case .userMessage(let text):
        object = responseItem(
          payload: [
            "type": "message",
            "role": "user",
            "content": [
              [
                "type": "input_text",
                "text": text,
              ]
            ],
          ]
        )

      case .localShellCall(let command):
        object = responseItem(
          payload: [
            "type": "local_shell_call",
            "status": "in_progress",
            "action": [
              "type": "exec",
              "command": command,
            ],
          ]
        )

      case .functionCall(let name, let arguments, let callID):
        object = responseItem(
          payload: [
            "type": "function_call",
            "name": name,
            "arguments": jsonString(arguments ?? [:]),
            "call_id": callID,
          ]
        )

      case .reasoning(let text):
        object = responseItem(
          payload: [
            "type": "reasoning",
            "id": "rs_123",
            "summary": [summaryText(text)],
          ]
        )

      case .assistantMessage(let text, let phase):
        var payload: [String: Any] = [
          "type": "message",
          "role": "assistant",
          "content": [outputText(text)],
        ]
        if let phase {
          payload["phase"] = phase
        }
        object = responseItem(payload: payload)

      case .agentReasoning(let text):
        object = event(type: "agent_reasoning", payload: ["text": text])

      case .agentMessage(let text, let phase):
        var payload: [String: Any] = ["message": text]
        if let phase {
          payload["phase"] = phase
        }
        object = event(type: "agent_message", payload: payload)
      }
      return jsonString(object)
    }
  }

  static func makeTranscript(copyingFixtureNamed fixtureName: String? = nil) throws -> URL {
    let directoryURL = FileManager.default.temporaryDirectory.appendingPathComponent(
      UUID().uuidString,
      isDirectory: true
    )
    try FileManager.default.createDirectory(at: directoryURL, withIntermediateDirectories: true)
    let fileURL = directoryURL.appendingPathComponent("transcript.jsonl")
    if let fixtureName {
      try FileManager.default.copyItem(at: fixtureURL(named: fixtureName), to: fileURL)
    } else {
      try Data().write(to: fileURL)
    }
    return fileURL
  }

  static func append(
    _ line: Line,
    to fileURL: URL
  ) throws {
    try append(line.json, to: fileURL)
  }

  static func append(
    _ line: String,
    to fileURL: URL
  ) throws {
    let handle = try FileHandle(forWritingTo: fileURL)
    defer { try? handle.close() }
    try handle.seekToEnd()
    try handle.write(contentsOf: Data((line + "\n").utf8))
  }

  private static func event(
    type: String,
    payload: [String: Any]
  ) -> [String: Any] {
    [
      "timestamp": "2026-04-05T07:00:00.000Z",
      "type": "event_msg",
      "payload": [
        "type": type,
        "payload": payload,
      ],
    ]
  }

  private static func responseItem(payload: [String: Any]) -> [String: Any] {
    [
      "timestamp": "2026-04-05T07:00:00.000Z",
      "type": "response_item",
      "payload": payload,
    ]
  }

  private static func jsonString(_ object: [String: Any]) -> String {
    guard
      let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
      let string = String(bytes: data, encoding: .utf8)
    else {
      preconditionFailure("Invalid Codex transcript fixture JSON")
    }
    return string
  }

  private static func outputText(_ text: String) -> [String: Any] {
    [
      "type": "output_text",
      "text": text,
    ]
  }

  private static func summaryText(_ text: String) -> [String: Any] {
    [
      "type": "summary_text",
      "text": text,
    ]
  }
}
