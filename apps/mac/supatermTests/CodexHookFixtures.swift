import Foundation

@testable import SupatermCLIShared

enum CodexHookFixtures {
  static let sessionID = "session-123"
  static let cwd = "/Users/Developer/code/github.com/supabitapp/supaterm"

  static let sessionStart = """
    {
      "session_id": "\(sessionID)",
      "cwd": "\(cwd)",
      "hook_event_name": "SessionStart",
      "source": "resume"
    }
    """

  static let preToolUse = """
    {
      "session_id": "\(sessionID)",
      "cwd": "\(cwd)",
      "hook_event_name": "PreToolUse",
      "tool_name": "Bash",
      "tool_input": {
        "command": "git status --short"
      }
    }
    """

  static let postToolUse = """
    {
      "session_id": "\(sessionID)",
      "cwd": "\(cwd)",
      "hook_event_name": "PostToolUse",
      "tool_name": "Bash",
      "tool_input": {
        "command": "git status --short"
      }
    }
    """

  static let userPromptSubmit = """
    {
      "session_id": "\(sessionID)",
      "cwd": "\(cwd)",
      "hook_event_name": "UserPromptSubmit",
      "prompt": "continue"
    }
    """

  static let stop = """
    {
      "session_id": "\(sessionID)",
      "cwd": "\(cwd)",
      "hook_event_name": "Stop",
      "last_assistant_message": "Done."
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
      agent: .codex,
      context: context,
      event: try event(json)
    )
  }
}
