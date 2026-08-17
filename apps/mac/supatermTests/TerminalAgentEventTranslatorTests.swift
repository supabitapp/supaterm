import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentEventTranslatorTests {
  @Test
  func nativeEventCarriesWorkingDirectory() throws {
    let request = try request(
      agent: .codex,
      json: #"{"session_id":"session-1","cwd":"/tmp/workspace","hook_event_name":"SessionStart"}"#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).first?.workingDirectoryPath
        == "/tmp/workspace"
    )
  }

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
          action: .progressUpdated(
            .replace([
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
            ]))
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
      #"{"session_id":"claude-1","hook_event_name":"SessionStart"}"#,
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
        .sessionStarted,
        .turnStarted,
        .turnRunning(detail: "Bash"),
        .attentionRequested(requestID: nil, message: "Choose a path"),
        .turnCompleted(message: "Done"),
        .sessionEnded,
      ]
    )
  }

  @Test
  func claudeTodoWriteReplacesProgress() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "PostToolUse",
          "tool_name": "TodoWrite",
          "tool_input": {
            "todos": [
              { "content": "Read state", "status": "completed", "activeForm": "Reading state" },
              { "content": "Wire tasks", "status": "in_progress", "activeForm": "Wiring tasks" },
              { "content": "Run checks", "status": "pending", "activeForm": "Running checks" }
            ]
          }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).last?.action
        == .progressUpdated(
          .replace([
            PaneAgentProgressRow(id: "0:Read state", title: "Read state", status: .completed),
            PaneAgentProgressRow(id: "1:Wire tasks", title: "Wire tasks", status: .running),
            PaneAgentProgressRow(id: "2:Run checks", title: "Run checks", status: .pending),
          ]))
    )
  }

  @Test
  func claudeTaskToolsMutateProgress() throws {
    let created = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "PostToolUse",
          "tool_name": "TaskCreate",
          "tool_input": { "subject": "Wire tasks", "description": "Show task state" },
          "tool_response": { "task": { "id": "task-7", "subject": "Wire tasks" } }
        }
        """#
    )
    let updated = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "PostToolUse",
          "tool_name": "TaskUpdate",
          "tool_input": { "taskId": "task-7", "status": "in_progress" }
        }
        """#
    )
    let deleted = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "PostToolUse",
          "tool_name": "TaskUpdate",
          "tool_input": { "task_id": "task-7", "status": "deleted" }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: created).last?.action
        == .progressUpdated(.upsert(id: "task-7", title: "Wire tasks", status: .pending))
    )
    #expect(
      TerminalAgentEventTranslator.events(for: updated).last?.action
        == .progressUpdated(.upsert(id: "task-7", title: nil, status: .running))
    )
    #expect(
      TerminalAgentEventTranslator.events(for: deleted).last?.action
        == .progressUpdated(.remove(id: "task-7"))
    )
  }

  @Test
  func claudeTaskHooksTrackTeammateWorkOnRootSession() throws {
    let created = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "turn_id": "turn-2",
          "agent_id": "worker-3",
          "hook_event_name": "TaskCreated",
          "task_id": "task-8",
          "task_subject": "Review changes",
          "teammate_name": "reviewer"
        }
        """#
    )
    let completed = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "turn_id": "turn-2",
          "agent_id": "worker-3",
          "hook_event_name": "TaskCompleted",
          "task_id": "task-8",
          "task_subject": "Review changes",
          "teammate_name": "reviewer"
        }
        """#
    )

    let createdEvents = TerminalAgentEventTranslator.events(for: created)
    let completedEvents = TerminalAgentEventTranslator.events(for: completed)
    let createdEvent = try #require(createdEvents.first)
    let completedEvent = try #require(completedEvents.first)
    #expect(createdEvents.count == 1)
    #expect(completedEvents.count == 1)
    #expect(createdEvent.scope.subagentID == nil)
    #expect(completedEvent.scope.subagentID == nil)
    #expect(
      createdEvent.action
        == .progressUpdated(.upsert(id: "task-8", title: "Review changes", status: .pending))
    )
    #expect(
      completedEvent.action
        == .progressUpdated(.upsert(id: "task-8", title: "Review changes", status: .completed))
    )
  }

  @Test
  func claudeStopReconcilesEveryActiveBackgroundTaskKind() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "Stop",
          "last_assistant_message": "Spawned.",
          "background_tasks": [
            { "id": "child-live", "type": "subagent", "status": "running" },
            { "id": "child-pending", "type": "subagent", "status": "pending" },
            { "id": "child-done", "type": "subagent", "status": "completed" },
            { "id": "teammate-task", "type": "teammate", "status": "running" },
            { "id": "workflow-task", "type": "workflow", "status": "pending" },
            { "id": "task-1", "type": "shell", "status": "running" }
          ],
          "session_crons": []
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .subagentsReconciled(
          liveSubagentIDs: ["child-live", "child-pending"],
          hasActiveTeammate: true,
          hasActiveWorkflow: true
        ),
        .turnContinuesInBackground,
      ]
    )
  }

  @Test
  func claudeStopReportsActiveWorkflows() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "Stop",
          "last_assistant_message": "Waiting.",
          "background_tasks": [
            {
              "id": "wbcr1wp0d",
              "type": "workflow",
              "status": "running",
              "name": "codex-balancer-research"
            },
            { "id": "wf-done", "type": "workflow", "status": "completed", "name": "dia-color" }
          ],
          "session_crons": []
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: true
        ),
        .turnContinuesInBackground,
      ]
    )
  }

  @Test
  func claudeStopWithOnlyFinishedWorkflowsReportsNoRunningWorkflow() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "Stop",
          "last_assistant_message": "Done.",
          "background_tasks": [
            { "id": "wf-done", "type": "workflow", "status": "completed", "name": "dia-color" }
          ],
          "session_crons": []
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        ),
        .turnCompleted(message: "Done."),
      ]
    )
  }

  @Test
  func claudeStopWithoutBackgroundTasksSkipsReconciliation() throws {
    let request = try request(
      agent: .claude,
      json: #"{"session_id":"claude-1","hook_event_name":"Stop","last_assistant_message":"Done"}"#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .turnCompleted(message: "Done")
      ]
    )
  }

  @Test
  func claudeStopWithDrainedBackgroundTasksReconcilesToNoChildren() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "claude-1",
          "hook_event_name": "Stop",
          "last_assistant_message": "Done",
          "background_tasks": [],
          "session_crons": []
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .subagentsReconciled(
          liveSubagentIDs: [],
          hasActiveTeammate: false,
          hasActiveWorkflow: false
        ),
        .turnCompleted(message: "Done"),
      ]
    )
  }

  @Test
  func codexLifecycleHasSharedSemantics() throws {
    let events = [
      #"{"session_id":"codex-1","hook_event_name":"SessionStart"}"#,
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
        .sessionStarted,
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
        .sessionStarted,
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
    #expect(
      events.map(\.action) == [
        .subagentStarted(nickname: nil, role: "explorer"),
        .subagentStopped,
      ]
    )
  }

  @Test
  func claudeSubagentLifecycleUsesHookRole() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "session-1",
          "agent_id": "agent-3",
          "agent_type": "workflow-subagent",
          "hook_event_name": "SubagentStart"
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .subagentStarted(kind: .workflow, nickname: nil, role: "workflow-subagent")
      ]
    )
  }

  @Test
  func claudeSubagentToolUseReportsHookActivity() throws {
    let request = try request(
      agent: .claude,
      json: #"""
        {
          "session_id": "session-1",
          "agent_id": "agent-3",
          "agent_type": "general-purpose",
          "hook_event_name": "PreToolUse",
          "tool_name": "Bash",
          "tool_input": { "command": "git status" }
        }
        """#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .turnRunning(detail: "Bash: git status")
      ]
    )
  }

  @Test
  func claudeSessionStartPreservesSource() throws {
    let request = try request(
      agent: .claude,
      json: #"{"session_id":"claude-1","hook_event_name":"SessionStart","source":"compact"}"#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request).map(\.action) == [
        .sessionResumed
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
