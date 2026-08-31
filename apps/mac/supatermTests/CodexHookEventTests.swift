import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexHookEventTests {
  @Test
  func codexEnvironmentKeyStaysStable() {
    #expect(SupatermCodexEnvironment.threadIDKey == "CODEX_THREAD_ID")
  }

  @Test
  func sessionStartFixtureDecodes() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.sessionStart)

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == CodexHookFixtures.sessionID)
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

  @Test(arguments: ["startup", "resume", "clear", "compact"])
  func durableRootSessionStartAcceptsKnownSources(source: String) throws {
    let event = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: source,
      transcriptPath: "/tmp/transcript.jsonl"
    )
    let roundTrip = try JSONDecoder().decode(
      SupatermAgentHookEvent.self,
      from: JSONEncoder().encode(event)
    )

    #expect(event.transcriptPath == "/tmp/transcript.jsonl")
    #expect(event.isDurableCodexRootSessionStart)
    #expect(roundTrip == event)
  }

  @Test
  func durableRootSessionStartRejectsIncompleteSubagentAndUnknownSource() {
    let incomplete = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: "resume"
    )
    let subagent = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: "resume",
      transcriptPath: "/tmp/transcript.jsonl",
      agentID: "agent-123"
    )
    let unknownSource = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: "future",
      transcriptPath: "/tmp/transcript.jsonl"
    )

    #expect(!incomplete.isDurableCodexRootSessionStart)
    #expect(!subagent.isDurableCodexRootSessionStart)
    #expect(!unknownSource.isDurableCodexRootSessionStart)
  }

  @Test(arguments: [#""""#, "null"])
  func durableRootSessionStartRejectsPresentAgentID(agentID: String) throws {
    let event = try CodexHookFixtures.event(
      """
      {
        "agent_id": \(agentID),
        "cwd": "\(CodexHookFixtures.cwd)",
        "hook_event_name": "SessionStart",
        "session_id": "\(CodexHookFixtures.sessionID)",
        "source": "startup",
        "transcript_path": "/tmp/transcript.jsonl"
      }
      """
    )

    #expect(event.payload["agent_id"] != nil)
    #expect(!event.isDurableCodexRootSessionStart)
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
    #expect(event.source == nil)
  }

  @Test
  func nativeLifecycleNamesAndFutureNamesRemainLossless() throws {
    let expected: [(String, SupatermAgentHookEventName)] = [
      ("PermissionRequest", .permissionRequest),
      ("SubagentStart", .subagentStart),
      ("SubagentStop", .subagentStop),
      ("session_start", .nativeSessionStart),
      ("agent_start", .agentStart),
      ("agent_end", .agentEnd),
      ("session_shutdown", .sessionShutdown),
      ("FutureLifecycle", SupatermAgentHookEventName(rawValue: "FutureLifecycle")),
    ]

    for (rawValue, eventName) in expected {
      let event = try CodexHookFixtures.event(
        #"{"hook_event_name":"\#(rawValue)"}"#
      )
      #expect(event.hookEventName == eventName)
      #expect(event.hookEventName.rawValue == rawValue)
    }
  }
}
