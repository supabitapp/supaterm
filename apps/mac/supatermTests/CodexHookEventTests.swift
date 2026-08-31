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

  @Test(arguments: SupatermCodexRootSessionStart.Source.allCases)
  func codexRootSessionStartAcceptsDurableSources(
    source: SupatermCodexRootSessionStart.Source
  ) throws {
    let event = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: source.rawValue,
      transcriptPath: "/tmp/transcript.jsonl"
    )
    let roundTrip = try JSONDecoder().decode(
      SupatermAgentHookEvent.self,
      from: JSONEncoder().encode(event)
    )
    let sessionStart = try #require(event.codexRootSessionStart)

    #expect(sessionStart.cwd == CodexHookFixtures.cwd)
    #expect(sessionStart.sessionID == CodexHookFixtures.sessionID)
    #expect(sessionStart.source == source)
    #expect(event.transcriptPath == "/tmp/transcript.jsonl")
    #expect(roundTrip.codexRootSessionStart == sessionStart)
    #expect(roundTrip == event)
  }

  @Test(arguments: ["cwd", "session_id", "source", "transcript_path"])
  func codexRootSessionStartRejectsMissingDurableField(field: String) throws {
    var payload: JSONObject = [
      "cwd": .string(CodexHookFixtures.cwd),
      "hook_event_name": .string(SupatermAgentHookEventName.sessionStart.rawValue),
      "session_id": .string(CodexHookFixtures.sessionID),
      "source": .string(SupatermCodexRootSessionStart.Source.resume.rawValue),
      "transcript_path": .string("/tmp/transcript.jsonl"),
    ]
    payload.removeValue(forKey: field)
    let event = try JSONDecoder().decode(
      SupatermAgentHookEvent.self,
      from: JSONEncoder().encode(JSONValue.object(payload))
    )

    #expect(event.codexRootSessionStart == nil)
  }

  @Test(arguments: [#""""#, "null", #""agent-123""#])
  func codexRootSessionStartRequiresAbsentAgentID(agentID: String) throws {
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
    #expect(event.codexRootSessionStart == nil)
  }

  @Test
  func codexRootSessionStartRejectsOtherEventsAndSources() {
    let wrongEvent = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionEnd,
      sessionID: CodexHookFixtures.sessionID,
      source: SupatermCodexRootSessionStart.Source.resume.rawValue,
      transcriptPath: "/tmp/transcript.jsonl"
    )
    let unknownSource = SupatermAgentHookEvent(
      cwd: CodexHookFixtures.cwd,
      hookEventName: .sessionStart,
      sessionID: CodexHookFixtures.sessionID,
      source: "future",
      transcriptPath: "/tmp/transcript.jsonl"
    )

    #expect(wrongEvent.codexRootSessionStart == nil)
    #expect(unknownSource.codexRootSessionStart == nil)
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
