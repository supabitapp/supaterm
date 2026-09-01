import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentEventTranslatorTests {
  @Test(arguments: [SupatermManagedAgentKind.claude, .codex])
  func sessionStartReportsIdentity(agent: SupatermManagedAgentKind) throws {
    let request = try request(
      agent: agent,
      json: #"{"session_id":"session-1","cwd":"/tmp/workspace","hook_event_name":"SessionStart"}"#
    )

    #expect(
      TerminalAgentEventTranslator.events(for: request) == [
        TerminalAgentEvent(
          scope: TerminalAgentEvent.Scope(agent: agent.agentKind, sessionID: "session-1"),
          workingDirectoryPath: "/tmp/workspace",
          action: .sessionStarted
        )
      ]
    )
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

  @Test(arguments: [SupatermManagedAgentKind.claude, .codex])
  func subagentSessionStartIsIgnored(agent: SupatermManagedAgentKind) {
    let request = SupatermAgentHookRequest(
      agent: agent,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1",
        agentID: "child-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  private func request(
    agent: SupatermManagedAgentKind,
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
