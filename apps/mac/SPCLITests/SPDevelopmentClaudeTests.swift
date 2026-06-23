import ArgumentParser
import Foundation
import Testing

@testable import SPCLI
@testable import SupatermCLIShared

struct SPDevelopmentClaudeTests {
  private let context = SupatermCLIContext(
    surfaceID: UUID(uuidString: "44B71943-17BA-4D8B-B595-0EB650F8D762")!,
    tabID: UUID(uuidString: "BB4F5340-2947-4A4F-AD94-CF699B9C495A")!
  )

  @Test
  func defaultSessionIDUsesSurfaceID() {
    let builder = SPDevelopmentClaudeEventBuilder(currentDirectoryPath: "/tmp/supaterm")

    #expect(
      builder.defaultSessionID(for: context)
        == "sp-development-44b71943-17ba-4d8b-b595-0eb650f8d762"
    )
  }

  @Test
  func preToolUseBuildsGenericPayload() throws {
    let builder = SPDevelopmentClaudeEventBuilder(currentDirectoryPath: "/tmp/supaterm")
    let event = try builder.event(.preToolUse, context: context)

    #expect(event.cwd == "/tmp/supaterm")
    #expect(event.hookEventName == .preToolUse)
    #expect(event.permissionMode == "acceptEdits")
    #expect(event.sessionID == builder.defaultSessionID(for: context))
    #expect(event.toolName == nil)
    #expect(event.toolUseID == nil)
    #expect(event.toolInput == nil)
  }

  @Test
  func notificationBuildsGenericAttentionPayload() throws {
    let builder = SPDevelopmentClaudeEventBuilder(currentDirectoryPath: "/tmp/supaterm")
    let event = try builder.event(.notification, context: context, sessionIDOverride: "debug-session")

    #expect(event.hookEventName == .notification)
    #expect(event.message == "Claude needs your attention")
    #expect(event.notificationType == "request_input")
    #expect(event.sessionID == "debug-session")
    #expect(event.title == "Needs input")
  }

  @Test
  func stopAndSessionEndUseExpectedHookNames() throws {
    let builder = SPDevelopmentClaudeEventBuilder(currentDirectoryPath: "/tmp/supaterm")
    let stop = try builder.event(.stop, context: context)
    let sessionEnd = try builder.event(.sessionEnd, context: context)

    #expect(stop.hookEventName == .stop)
    #expect(stop.lastAssistantMessage == "Done.")
    #expect(stop.stopHookActive == false)
    #expect(sessionEnd.hookEventName == .sessionEnd)
    #expect(sessionEnd.reason == "exit")
  }

  @Test
  func runtimeGateRejectsNonDevelopmentBuild() {
    do {
      try SPDevelopmentAvailability.validate(isDevelopmentBuild: false)
      Issue.record("Expected development gate to reject a non-development build.")
    } catch let error as ValidationError {
      #expect(
        error.description
          == "This command is only available when Supaterm is running a development build."
      )
    } catch {
      Issue.record("Unexpected error: \(error)")
    }
  }

  @Test
  func runtimeGateAllowsDevelopmentBuild() throws {
    try SPDevelopmentAvailability.validate(isDevelopmentBuild: true)
  }
}
