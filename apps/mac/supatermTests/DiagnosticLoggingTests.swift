import Testing

@testable import SupatermSupport

struct DiagnosticLoggingTests {
  @Test
  func environmentForcesVerboseLogging() {
    #expect(
      SupatermLog.isVerboseLoggingForced(
        environment: ["SUPATERM_VERBOSE_LOGGING": "1"]
      )
    )
    #expect(
      !SupatermLog.isVerboseLoggingForced(
        environment: ["SUPATERM_VERBOSE_LOGGING": "0"]
      )
    )
    #expect(!SupatermLog.isVerboseLoggingForced(environment: [:]))
  }
}
