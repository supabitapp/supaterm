import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexHookEventTests {
  @Test
  func sessionStartFixtureDecodes() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.sessionStart)

    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == CodexHookFixtures.sessionID)
    #expect(event.cwd == CodexHookFixtures.cwd)
    #expect(event.source == "resume")
  }

  @Test
  func preToolUseFixtureIgnoresUnknownToolInputFields() throws {
    let event = try CodexHookFixtures.event(CodexHookFixtures.preToolUse)

    #expect(event.hookEventName == .preToolUse)
    #expect(event.toolName == "Bash")
    #expect(event.toolInput == .init())
  }

  @Test
  func userPromptSubmitAndStopFixturesDecode() throws {
    let userPromptSubmit = try CodexHookFixtures.event(CodexHookFixtures.userPromptSubmit)
    let stop = try CodexHookFixtures.event(CodexHookFixtures.stop)

    #expect(userPromptSubmit.hookEventName == .userPromptSubmit)
    #expect(userPromptSubmit.prompt == "continue")
    #expect(stop.hookEventName == .stop)
    #expect(stop.lastAssistantMessage == "Done.")
  }
}
