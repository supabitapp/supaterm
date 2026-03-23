import Foundation
import Testing

@testable import SupatermCLIShared

enum ClaudeHookFixtures {
  static let sessionID = "session-123"
  static let transcriptPath = "/tmp/claude/transcript.jsonl"
  static let cwd = "/Users/Developer/code/github.com/supabitapp/supaterm"

  static let sessionStart = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "hook_event_name": "SessionStart",
      "source": "startup",
      "model": "claude-sonnet-4-5",
      "agent_type": "assistant"
    }
    """

  static let notification = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "hook_event_name": "Notification",
      "message": "Claude needs your attention",
      "title": "Needs input",
      "notification_type": "request_input"
    }
    """

  static let userPromptSubmit = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "permission_mode": "acceptEdits",
      "hook_event_name": "UserPromptSubmit",
      "prompt": "Use the recommended option"
    }
    """

  static let preToolUse = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "permission_mode": "acceptEdits",
      "hook_event_name": "PreToolUse",
      "tool_name": "AskUserQuestion",
      "tool_use_id": "toolu_123",
      "tool_input": {
        "questions": [
          {
            "header": "Storage",
            "question": "Which storage strategy should the plan lock in for sp claude-hook?",
            "options": [
              { "label": "File-backed" },
              { "label": "App memory" }
            ]
          }
        ]
      }
    }
    """

  static let stop = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "permission_mode": "acceptEdits",
      "hook_event_name": "Stop",
      "stop_hook_active": false,
      "last_assistant_message": "Done."
    }
    """

  static let sessionEnd = """
    {
      "session_id": "\(sessionID)",
      "transcript_path": "\(transcriptPath)",
      "cwd": "\(cwd)",
      "hook_event_name": "SessionEnd",
      "reason": "exit"
    }
    """

  static func object(_ json: String) throws -> JSONObject {
    let data = Data(json.utf8)
    let value = try JSONDecoder().decode(JSONValue.self, from: data)
    guard case .object(let object) = value else {
      Issue.record("Expected Claude hook fixture to decode to a JSON object.")
      throw ClaudeHookFixtureError.notObject
    }
    return object
  }

  static func request(
    _ json: String,
    context: SupatermCLIContext? = nil
  ) throws -> SupatermClaudeHookRequest {
    .init(
      context: context,
      event: try object(json)
    )
  }
}

private enum ClaudeHookFixtureError: Error {
  case notObject
}
