import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentEventTranslatorTests {
  @Test(arguments: [SupatermAgentKind.claude, .codex])
  func sessionStartReportsIdentity(agent: SupatermAgentKind) {
    let request = SupatermAgentHookRequest(
      agent: agent,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "session-1",
        source: agent == .codex ? SupatermCodexRootSessionStart.Source.startup.rawValue : nil,
        transcriptPath: agent == .codex ? "/tmp/session-1.jsonl" : nil
      )
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request) == [
        TerminalAgentEvent(
          scope: TerminalAgentEvent.Scope(agent: agent, sessionID: "session-1"),
          workingDirectoryPath: "/tmp/workspace",
          action: .sessionStarted
        )
      ]
    )
  }

  @Test
  func codexSessionStartRejectsMissingAndInvalidIdentity() {
    let missingSession = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        source: SupatermCodexRootSessionStart.Source.startup.rawValue,
        transcriptPath: "/tmp/session-1.jsonl"
      )
    )
    let invalidStart = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "session-1",
        source: "internal",
        transcriptPath: "/tmp/session-1.jsonl"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: missingSession).isEmpty)
    #expect(TerminalAgentEventTranslator.events(for: invalidStart).isEmpty)
  }

  @Test
  func codexSessionStartRejectsMismatchedInheritedSession() {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "nested-session",
        source: SupatermCodexRootSessionStart.Source.startup.rawValue,
        transcriptPath: "/tmp/nested-session.jsonl"
      ),
      inheritedSessionID: "root-session"
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test(
    arguments: [
      SupatermAgentHookEventName.notification,
      .permissionRequest,
      .postToolUse,
      .preToolUse,
      .sessionEnd,
      .stop,
      .subagentStart,
      .subagentStop,
      .userPromptSubmit,
    ])
  func claudeIgnoresNonIdentityEvents(eventName: SupatermAgentHookEventName) {
    let request = SupatermAgentHookRequest(
      agent: .claude,
      event: SupatermAgentHookEvent(
        hookEventName: eventName,
        sessionID: "session-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test
  func claudeSubagentSessionStartIsIgnored() {
    let request = SupatermAgentHookRequest(
      agent: .claude,
      event: SupatermAgentHookEvent(
        cwd: "/tmp/workspace",
        hookEventName: .sessionStart,
        sessionID: "session-1",
        agentID: "child-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
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
