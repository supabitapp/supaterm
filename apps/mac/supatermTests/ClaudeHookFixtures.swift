import Foundation

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
      "hook_event_name": "PreToolUse"
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

  static func event(_ json: String) throws -> SupatermAgentHookEvent {
    try JSONDecoder().decode(SupatermAgentHookEvent.self, from: Data(json.utf8))
  }

  static func request(
    _ json: String,
    context: SupatermCLIContext? = nil
  ) throws -> SupatermAgentHookRequest {
    .init(
      agent: .claude,
      context: context,
      event: try event(json)
    )
  }
}
