import Foundation
import SupatermTerminalCore
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct ClaudeHookEventTests {
  @Test
  func officialSessionStartFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.sessionStart)

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == ClaudeHookFixtures.sessionID)
    #expect(event.transcriptPath == ClaudeHookFixtures.transcriptPath)
    #expect(event.cwd == ClaudeHookFixtures.cwd)
  }

  @Test
  func officialNotificationFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.notification)

    #expect(event.hookEventName == .notification)
    #expect(event.notificationMessage() == "Claude needs your attention")
    #expect(event.title == "Needs input")
    #expect(event.notificationType == "request_input")
  }

  @Test
  func officialUserPromptSubmitFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.userPromptSubmit)

    #expect(event.hookEventName == .userPromptSubmit)
  }

  @Test
  func officialPreToolUseFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.preToolUse)

    #expect(event.hookEventName == .preToolUse)
    #expect(event.toolName == nil)
    #expect(event.toolUseID == nil)
    #expect(event.toolInput == nil)
  }

  @Test
  func officialStopFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.stop)

    #expect(event.hookEventName == .stop)
    #expect(event.lastAssistantMessage == "Done.")
  }

  @Test
  func officialSessionEndFixtureDecodes() throws {
    let event = try ClaudeHookFixtures.event(ClaudeHookFixtures.sessionEnd)

    #expect(event.hookEventName == .sessionEnd)
    #expect(event.reason == "exit")
  }

  @Test
  func parserIgnoresUnknownFieldsAndMissingOptionalFields() throws {
    let event = try ClaudeHookFixtures.event(
      """
      {
        "session_id": "\(ClaudeHookFixtures.sessionID)",
        "hook_event_name": "Notification",
        "message": "Needs review",
        "unknown": {
          "nested": [1, true, "value"]
        }
      }
      """
    )

    #expect(event.hookEventName == .notification)
    #expect(event.notificationMessage() == "Needs review")
    #expect(event.title == nil)
    #expect(event.notificationType == nil)
  }

  @Test
  func notificationWithoutMessageReturnsNil() throws {
    let event = try ClaudeHookFixtures.event(
      """
      {
        "session_id": "\(ClaudeHookFixtures.sessionID)",
        "hook_event_name": "Notification"
      }
      """
    )

    #expect(event.notificationMessage() == nil)
  }

  @Test
  func parserIgnoresKnownFieldTypeChanges() throws {
    let event = try ClaudeHookFixtures.event(
      """
      {
        "session_id": "\(ClaudeHookFixtures.sessionID)",
        "hook_event_name": "Notification",
        "message": "Needs review",
        "title": false,
        "notification_type": {
          "kind": "request_input"
        }
      }
      """
    )

    #expect(event.hookEventName == .notification)
    #expect(event.notificationMessage() == "Needs review")
    #expect(event.title == nil)
    #expect(event.notificationType == nil)
  }

  @Test
  func malformedJSONFixtureFailsBeforeParsing() {
    #expect(throws: (any Error).self) {
      _ = try ClaudeHookFixtures.event("{")
    }
  }
}
