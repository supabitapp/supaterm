import Testing

@testable import supaterm

struct AppCrashReportingTests {
  @Test
  func configurationReadsTrackedInfoDictionary() throws {
    let configuration = try #require(
      AppCrashReporting.Configuration(
        infoDictionary: [
          "SentryDSN": "https://examplePublicKey@o0.ingest.us.sentry.io/1"
        ]
      )
    )

    #expect(configuration.dsn == "https://examplePublicKey@o0.ingest.us.sentry.io/1")
  }

  @Test
  func configurationRejectsMissingOrInvalidValues() {
    #expect(
      AppCrashReporting.Configuration(
        infoDictionary: [
          "SentryDSN": ""
        ]
      ) == nil
    )

    #expect(AppCrashReporting.Configuration(infoDictionary: [:]) == nil)
  }

  @Test
  func isEnabledRequiresCrashReportsAndNonDebugBuild() {
    #expect(AppCrashReporting.isEnabled(supatermSettings: .default, isDebugBuild: false))
    #expect(
      !AppCrashReporting.isEnabled(
        supatermSettings: SupatermSettings(
          appearanceMode: .system,
          analyticsEnabled: true,
          crashReportsEnabled: false,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppCrashReporting.isEnabled(supatermSettings: .default, isDebugBuild: true))
  }
}
