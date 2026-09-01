import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct TerminalAgentEventTranslatorTests {
  @Test(arguments: [SupatermAgentKind.claude, .codex])
  func sessionStartReportsIdentity(agent: SupatermAgentKind) throws {
    let request = try request(
      agent: agent,
      json: #"{"session_id":"session-1","cwd":"/tmp/workspace","hook_event_name":"SessionStart"}"#
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
        agentID: "child-1"
      )
    )

    #expect(TerminalAgentEventTranslator.events(for: request).isEmpty)
  }

  @Test
  func piHookEventsAreIgnored() {
    let request = SupatermAgentHookRequest(
      agent: .pi,
      event: SupatermAgentHookEvent(
        hookEventName: .sessionStart,
        sessionID: "session-1"
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
