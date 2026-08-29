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
  func codexSessionStartRejectsMissingTranscriptPath() {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test
  func codexSessionStartRejectsEmptyTranscriptPath() {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1",
        transcriptPath: ""
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test
  func codexSessionStartAcceptsMatchingInheritedSession() {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1",
        transcriptPath: "/tmp/session-1.jsonl"
      ),
      inheritedSessionID: "session-1"
    )

    #expect(TerminalAgentEventTranslator.events(for: request).count == 1)
  }

  @Test
  func codexSessionStartRejectsDifferentInheritedSession() {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "nested-session",
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
  func codexIgnoresNonIdentityEvents(eventName: SupatermAgentHookEventName) {
    let request = SupatermAgentHookRequest(
      agent: .codex,
      event: SupatermAgentHookEvent(
        hookEventName: eventName,
        sessionID: "session-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test(arguments: [SupatermAgentKind.claude, .codex])
  func subagentSessionStartIsIgnored(agent: SupatermAgentKind) {
    let request = SupatermAgentHookRequest(
      agent: agent,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1",
        transcriptPath: agent == .codex ? "/tmp/session-1.jsonl" : nil,
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
