import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentEventTranslatorTests {
  @Test
  func codexPlanUpdateBecomesScopedProgress() throws {
    let request = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "hook_event_name": "PostToolUse",
          "tool_name": "update_plan",
          "tool_input": {
            "plan": [
              { "step": "Read state", "status": "completed" },
              { "step": "Update panel", "status": "in_progress" },
              { "step": "Verify behavior", "status": "pending" }
            ]
          }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request) == [
        TerminalAgentEvent(
          scope: TerminalAgentEvent.Scope(
            agent: .codex,
            sessionID: "session-1",
            turnID: "turn-2"
          ),
          action: .progressUpdated([
            PaneAgentProgressRow(
              id: "0:Read state",
              title: "Read state",
              status: .completed
            ),
            PaneAgentProgressRow(
              id: "1:Update panel",
              title: "Update panel",
              status: .running
            ),
            PaneAgentProgressRow(
              id: "2:Verify behavior",
              title: "Verify behavior",
              status: .pending
            ),
          ])
        )
      ]
    )
  }

  @Test
  func codexPermissionRequestNeedsInput() throws {
    let request = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "hook_event_name": "PermissionRequest",
          "tool_name": "Bash",
          "tool_input": { "command": "git push" }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request) == [
        TerminalAgentEvent(
          scope: TerminalAgentEvent.Scope(
            agent: .codex,
            sessionID: "session-1",
            turnID: "turn-2"
          ),
          action: .attentionRequested(
            requestID: "tool:Bash",
            message: "Bash requires approval"
          )
        )
      ]
    )
  }

  @Test
  func codexToolCompletionResolvesPermissionAttention() throws {
    let request = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "hook_event_name": "PostToolUse",
          "tool_name": "Bash",
          "tool_use_id": "call-1"
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .attentionResolved(requestID: "id:call-1"),
        .attentionResolved(requestID: "tool:Bash"),
        .turnRunning(detail: "Bash"),
      ]
    )
  }

  @Test
  func codexUserQuestionNeedsInput() throws {
    let request = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "hook_event_name": "PreToolUse",
          "tool_name": "request_user_input",
          "tool_input": {
            "questions": [
              {
                "header": "Approach",
                "question": "Which implementation should I use?",
                "options": []
              }
            ]
          }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .attentionRequested(
          requestID: "tool:request_user_input",
          message: "Which implementation should I use?"
        )
      ]
    )
  }

  @Test
  func codexUserQuestionCompletionResolvesAttention() throws {
    let request = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "hook_event_name": "PostToolUse",
          "tool_name": "request_user_input",
          "tool_input": { "questions": [] }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .attentionResolved(requestID: "tool:request_user_input")
      ]
    )
  }

  @Test
  func claudeLifecycleHasSharedSemantics() throws {
    let events = [
      #"{"session_id":"claude-1","hook_event_name":"SessionStart","transcript_path":"/tmp/claude.jsonl"}"#,
      #"{"session_id":"claude-1","hook_event_name":"UserPromptSubmit"}"#,
      #"{"session_id":"claude-1","hook_event_name":"PreToolUse","tool_name":"Bash"}"#,
      #"""
      {
        "session_id": "claude-1",
        "hook_event_name": "Notification",
        "notification_type": "permission_prompt",
        "message": "Choose a path"
      }
      """#,
      #"{"session_id":"claude-1","hook_event_name":"Stop","last_assistant_message":"Done"}"#,
      #"{"session_id":"claude-1","hook_event_name":"SessionEnd"}"#,
    ]

    #expect(
      try events.flatMap { json in
        TerminalAgentEventTranslator.events(for: try request(agent: .claude, json: json))
          .map(\.action)
      } == [
        .sessionStarted(transcriptPath: "/tmp/claude.jsonl"),
        .turnStarted,
        .turnRunning(detail: "Bash"),
        .attentionRequested(requestID: nil, message: "Choose a path"),
        .turnCompleted(message: "Done"),
        .sessionEnded,
      ]
    )
  }

  @Test
  func codexLifecycleHasSharedSemantics() throws {
    let events = [
      #"{"session_id":"codex-1","hook_event_name":"SessionStart","transcript_path":"/tmp/codex.jsonl"}"#,
      #"{"session_id":"codex-1","turn_id":"turn-1","hook_event_name":"UserPromptSubmit"}"#,
      #"{"session_id":"codex-1","turn_id":"turn-1","hook_event_name":"PreToolUse","tool_name":"Bash"}"#,
      #"{"session_id":"codex-1","turn_id":"turn-1","hook_event_name":"Stop","last_assistant_message":"Done"}"#,
      #"{"session_id":"codex-1","hook_event_name":"SessionEnd"}"#,
    ]

    #expect(
      try events.flatMap { json in
        TerminalAgentEventTranslator.events(for: try request(agent: .codex, json: json))
          .map(\.action)
      } == [
        .sessionStarted(transcriptPath: "/tmp/codex.jsonl"),
        .turnStarted,
        .turnRunning(detail: "Bash"),
        .turnCompleted(message: "Done"),
        .sessionEnded,
      ]
    )
  }

  @Test
  func piLifecycleHasSharedSemantics() throws {
    let events = [
      #"{"session_id":"pi-1","hook_event_name":"session_start"}"#,
      #"{"session_id":"pi-1","hook_event_name":"agent_start"}"#,
      #"{"session_id":"pi-1","hook_event_name":"agent_end","message":"Done","stop_reason":"stop"}"#,
      #"{"session_id":"pi-1","hook_event_name":"session_shutdown","reason":"exit"}"#,
    ]

    #expect(
      try events.flatMap { json in
        TerminalAgentEventTranslator.events(for: try request(agent: .pi, json: json))
          .map(\.action)
      } == [
        .sessionStarted(transcriptPath: nil),
        .turnStarted,
        .turnCompleted(message: "Done"),
        .sessionEnded,
      ]
    )
  }

  @Test(arguments: ["length", "error", "aborted"])
  func piIncompleteRunNeedsInput(stopReason: String) throws {
    let request = try request(
      agent: .pi,
      json: #"""
        {
          "session_id": "pi-1",
          "hook_event_name": "agent_end",
          "message": "Run needs attention",
          "stop_reason": "\#(stopReason)"
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .attentionRequested(requestID: nil, message: "Run needs attention")
      ]
    )
  }

  @Test
  func codexSubagentLifecycleIsScopedToChild() throws {
    let started = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "agent_id": "agent-3",
          "agent_type": "explorer",
          "hook_event_name": "SubagentStart"
        }
        """#
    )
    let stopped = try request(
      agent: .codex,
      json: #"""
        {
          "session_id": "session-1",
          "turn_id": "turn-2",
          "agent_id": "agent-3",
          "agent_type": "explorer",
          "hook_event_name": "SubagentStop"
        }
        """#
    )

    let events =
      TerminalAgentEventTranslator.events(for: started)
      + TerminalAgentEventTranslator.events(for: stopped)

    #expect(events.map(\.scope.subagentID) == ["agent-3", "agent-3"])
    #expect(events.map(\.action) == [.subagentStarted(type: "explorer"), .subagentStopped])
  }

  @Test
  func claudeSessionStartPreservesSource() throws {
    let request = try request(
      agent: .claude,
      json: #"{"session_id":"claude-1","hook_event_name":"SessionStart","source":"compact"}"#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .sessionResumed(transcriptPath: nil)
      ]
    )
  }

  @Test(arguments: ["permission_prompt", "idle_prompt", "elicitation_dialog"])
  func actionableClaudeNotificationNeedsInput(notificationType: String) throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "Notification",
          "notification_type": "\#(notificationType)",
          "message": "Choose"
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .attentionRequested(requestID: nil, message: "Choose")
      ]
    )
  }

  @Test(
    arguments: [
      "auth_success", "elicitation_complete", "elicitation_response", "agent_needs_input",
      "agent_completed", "request_input", nil,
    ])
  func informationalClaudeNotificationIsIgnored(notificationType: String?) throws {
    let request = SupatermAgentHookRequest(
      agent: .claude,
      event: SupatermAgentHookEvent(
        hookEventName: .notification,
        message: "Info",
        notificationType: notificationType,
        sessionID: "claude-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test
  func scopedChildActivityDoesNotSynthesizeLifecycle() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "root-1",
          "hook_event_name": "PreToolUse",
          "tool_name": "Bash",
          "agent_id": "child-1",
          "agent_type": "reviewer"
        }
        """#
    )

    let events = TerminalAgentEventTranslator.events(for: request)

    #expect(events.map(\.scope.sessionID) == ["root-1"])
    #expect(events.map(\.scope.subagentID) == ["child-1"])
    #expect(events.map(\.action) == [.turnRunning(detail: "Bash")])
  }

  private func request(
    agent: SupatermAgentKind,
    json: String
  ) throws -> SupatermAgentHookRequest {
    SupatermAgentHookRequest(
      agent: agent,
      event: try JSONDecoder().decode(
        SupatermAgentHookEvent.self,
        from: Data(json.utf8)
      )
    )
  }
}
