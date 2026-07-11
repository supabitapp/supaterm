import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexHookEventTests {
  @Test
  func sessionStartFixtureDecodes() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.sessionStart)

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == CodexHookFixtures.sessionID)
    #expect(event.transcriptPath == CodexHookFixtures.transcriptPath)
    #expect(event.cwd == CodexHookFixtures.cwd)
  }

  @Test
  func toolFixturesPreserveNativeInput() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.preToolUse)
    let postToolUse = try CodexHookFixtures.event(CodexHookFixtures.postToolUse)

    #expect(event.hookEventName == .preToolUse)
    #expect(event.toolName == "Bash")
    #expect(event.toolInput == .object(["command": .string("git status --short")]))
    #expect(postToolUse.hookEventName == .postToolUse)
    #expect(postToolUse.toolName == "Bash")
    #expect(postToolUse.toolInput == .object(["command": .string("git status --short")]))
  }

  @Test
  func nativePayloadRoundTripsWithoutLoss() throws {
    let payload = #"""
      {
        "session_id": "session-123",
        "turn_id": "turn-456",
        "agent_id": "agent-789",
        "agent_type": "worker",
        "hook_event_name": "PostToolUse",
        "tool_name": "update_plan",
        "tool_input": {
          "explanation": "Keep the panel current",
          "plan": [
            { "step": "Read state", "status": "completed" },
            { "step": "Update panel", "status": "in_progress" }
          ]
        },
        "tool_response": {
          "content": [{ "type": "text", "text": "Plan updated" }]
        },
        "future_field": {
          "nested": [true, 42, null]
        }
      }
      """#
    let expected = try JSONDecoder().decode(JSONValue.self, from: Data(payload.utf8))
    let event = try CodexHookFixtures.event(payload)

    let encoded = try JSONEncoder().encode(event)
    let actual = try JSONDecoder().decode(JSONValue.self, from: encoded)

    #expect(actual == expected)
  }

  @Test
  func userPromptSubmitAndStopFixturesDecode() throws {
    let userPromptSubmit = try CodexHookFixtures.event(CodexHookFixtures.userPromptSubmit)
    let stop = try CodexHookFixtures.event(CodexHookFixtures.stop)

    #expect(userPromptSubmit.hookEventName == .userPromptSubmit)
    #expect(stop.hookEventName == .stop)
    #expect(stop.lastAssistantMessage == "Done.")
  }

  @Test
  func parserIgnoresKnownFieldTypeChanges() throws {
    let event = try CodexHookFixtures.event(
      """
      {
        "session_id": "\(CodexHookFixtures.sessionID)",
        "transcript_path": false,
        "cwd": "\(CodexHookFixtures.cwd)",
        "hook_event_name": "SessionStart",
        "source": {
          "kind": "resume"
        }
      }
      """
    )

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == CodexHookFixtures.sessionID)
    #expect(event.cwd == CodexHookFixtures.cwd)
    #expect(event.transcriptPath == nil)
    #expect(event.source == nil)
  }
}
