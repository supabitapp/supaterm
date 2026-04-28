import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexHookEventTests {
  @Test
  func sessionStartFixtureDecodes() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.sessionStart)

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == CodexHookFixtures.sessionID)
    #expect(event.transcriptPath == CodexHookFixtures.transcriptPath)
    #expect(event.cwd == CodexHookFixtures.cwd)
  }

  @Test
  func toolFixturesIgnoreUnknownToolInputFields() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.preToolUse)
    let postToolUse = try CodexHookFixtures.event(CodexHookFixtures.postToolUse)

    #expect(event.hookEventName == .preToolUse)
    #expect(event.toolName == "Bash")
    #expect(event.toolInput == SupatermAgentHookToolInput())
    #expect(postToolUse.hookEventName == .postToolUse)
    #expect(postToolUse.toolName == "Bash")
    #expect(postToolUse.toolInput == SupatermAgentHookToolInput())
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
        "transcript_path": false,
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
    #expect(event.transcriptPath == nil)
    #expect(event.source == nil)
  }
}
