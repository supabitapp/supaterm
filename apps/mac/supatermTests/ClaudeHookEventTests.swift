import Foundation
import Testing

@testable import SupatermCLIShared
@testable import supaterm

struct ClaudeHookEventTests {
  @Test
  func officialSessionStartFixtureDecodes() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.sessionStart))

    #expect(event.name == .sessionStart)
    #expect(event.sessionID == ClaudeHookFixtures.sessionID)
    #expect(event.transcriptPath == ClaudeHookFixtures.transcriptPath)
    #expect(event.cwd == ClaudeHookFixtures.cwd)
    #expect(event.source == "startup")
    #expect(event.model == "claude-sonnet-4-5")
    #expect(event.agentType == "assistant")
  }

  @Test
  func officialNotificationFixtureDecodes() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.notification))

    #expect(event.name == .notification)
    #expect(try event.notificationMessage() == "Claude needs your attention")
    #expect(event.title == "Needs input")
    #expect(event.notificationType == "request_input")
  }

  @Test
  func officialUserPromptSubmitFixtureDecodes() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.userPromptSubmit))

    #expect(event.name == .userPromptSubmit)
    #expect(event.permissionMode == "acceptEdits")
    #expect(event.prompt == "Use the recommended option")
  }

  @Test
  func officialPreToolUseFixtureDecodesAndExtractsPendingQuestion() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.preToolUse))

    #expect(event.name == .preToolUse)
    #expect(event.permissionMode == "acceptEdits")
    #expect(event.toolName == "AskUserQuestion")
    #expect(event.toolUseID == "toolu_123")
    #expect(
      event.pendingQuestion()
        == "Which storage strategy should the plan lock in for sp claude-hook?\n[File-backed] [App memory]"
    )
  }

  @Test
  func officialStopFixtureDecodes() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.stop))

    #expect(event.name == .stop)
    #expect(event.permissionMode == "acceptEdits")
    #expect(event.stopHookActive == false)
    #expect(event.lastAssistantMessage == "Done.")
  }

  @Test
  func officialSessionEndFixtureDecodes() throws {
    let event = try ClaudeHookEvent(eventObject: ClaudeHookFixtures.object(ClaudeHookFixtures.sessionEnd))

    #expect(event.name == .sessionEnd)
    #expect(event.reason == "exit")
  }

  @Test
  func parserIgnoresUnknownFieldsAndMissingOptionalFields() throws {
    let event = try ClaudeHookEvent(
      eventObject: ClaudeHookFixtures.object(
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
    )

    #expect(event.name == .notification)
    #expect(try event.notificationMessage() == "Needs review")
    #expect(event.title == nil)
    #expect(event.notificationType == nil)
  }

  @Test
  func notificationWithoutMessageFailsValidation() throws {
    let event = try ClaudeHookEvent(
      eventObject: ClaudeHookFixtures.object(
        """
        {
          "session_id": "\(ClaudeHookFixtures.sessionID)",
          "hook_event_name": "Notification"
        }
        """
      )
    )

    #expect(throws: ClaudeHookError.missingNotificationMessage) {
      _ = try event.notificationMessage()
    }
  }

  @Test
  func malformedJSONFixtureFailsBeforeParsing() {
    #expect(throws: (any Error).self) {
      _ = try ClaudeHookFixtures.object("{")
    }
  }
}
