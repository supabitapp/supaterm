import PostHog
import Testing

@testable import supaterm

struct AppTelemetryTests {
  @Test
  func configurationReadsTrackedInfoDictionary() throws {
    let configuration = try #require(
      AppTelemetry.Configuration(
        infoDictionary: [
          "PostHogAPIKey": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "identified_only",
        ]
      )
    )

    #expect(configuration.apiKey == "phc_test")
    #expect(configuration.host == "https://us.i.posthog.com")
    #expect(configuration.personProfiles == .identifiedOnly)
  }

  @Test
  func configurationRejectsMissingOrInvalidValues() {
    #expect(
      AppTelemetry.Configuration(
        infoDictionary: [
          "PostHogAPIKey": "phc_test",
          "PostHogHost": "",
          "PostHogPersonProfiles": "identified_only",
        ]
      ) == nil
    )

    #expect(
      AppTelemetry.Configuration(
        infoDictionary: [
          "PostHogAPIKey": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "invalid",
        ]
      ) == nil
    )
  }

  @Test
  func isEnabledRequiresAnalyticsAndNonDebugBuild() {
    #expect(AppTelemetry.isEnabled(appPrefs: .default, isDebugBuild: false))
    #expect(
      !AppTelemetry.isEnabled(
        appPrefs: AppPrefs(
          appearanceMode: .system,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppTelemetry.isEnabled(appPrefs: .default, isDebugBuild: true))
  }
}
