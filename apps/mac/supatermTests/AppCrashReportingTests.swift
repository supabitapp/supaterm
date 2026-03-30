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
    #expect(AppCrashReporting.isEnabled(appPrefs: .default, isDebugBuild: false))
    #expect(
      !AppCrashReporting.isEnabled(
        appPrefs: AppPrefs(
          appearanceMode: .system,
          analyticsEnabled: true,
          crashReportsEnabled: false,
          updateChannel: .stable,
          updatesAutomaticallyCheckForUpdates: true,
          updatesAutomaticallyDownloadUpdates: false
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppCrashReporting.isEnabled(appPrefs: .default, isDebugBuild: true))
  }
}
