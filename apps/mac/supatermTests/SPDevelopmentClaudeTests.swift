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
  func sessionStartBuildsIdentityPayload() throws {
    let builder = SPDevelopmentClaudeEventBuilder(currentDirectoryPath: "/tmp/supaterm")
    let event = try builder.sessionStartEvent(
      context: context,
      sessionIDOverride: "debug-session"
    )

    #expect(event.payload["cwd"]?.stringValue == "/tmp/supaterm")
    #expect(event.hookEventName == .sessionStart)
    #expect(event.sessionID == "debug-session")
    #expect(event.agentType == "assistant")
    #expect(event.payload["model"]?.stringValue == "sp-development")
    #expect(event.source == "sp development")
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
