import PostHog
import Testing

@testable import supaterm

struct AppPostHogTests {
  @Test
  func configurationReadsTrackedInfoDictionary() throws {
    let configuration = try #require(
      AppPostHog.Configuration(
        infoDictionary: [
          "PostHogProjectToken": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "identified_only",
        ]
      )
    )

    #expect(configuration.projectToken == "phc_test")
    #expect(configuration.host == "https://us.i.posthog.com")
    #expect(configuration.personProfiles == .identifiedOnly)
  }

  @Test
  func configurationRejectsMissingOrInvalidValues() {
    #expect(
      AppPostHog.Configuration(
        infoDictionary: [
          "PostHogProjectToken": "phc_test",
          "PostHogHost": "",
          "PostHogPersonProfiles": "identified_only",
        ]
      ) == nil
    )

    #expect(
      AppPostHog.Configuration(
        infoDictionary: [
          "PostHogProjectToken": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "invalid",
        ]
      ) == nil
    )

    #expect(AppPostHog.Configuration(infoDictionary: [:]) == nil)
  }

  @Test
  func configKeepsLifecycleAutocaptureEnabled() throws {
    let configuration = try #require(
      AppPostHog.Configuration(
        infoDictionary: [
          "PostHogProjectToken": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "identified_only",
        ]
      )
    )
    let config = AppPostHog.makeConfig(
      configuration: configuration,
      supatermSettings: .default
    )

    #expect(config.captureApplicationLifecycleEvents)
    #expect(!config.captureScreenViews)
    #expect(!config.enableSwizzling)
    #expect(config.errorTrackingConfig.autoCapture)
    #expect(config.personProfiles == .identifiedOnly)
  }

  @Test
  func setupRequiresAnalyticsOrErrorReportingAndNonDebugBuild() {
    #expect(AppPostHog.isSetupEnabled(supatermSettings: .default, isDebugBuild: false))
    #expect(
      AppPostHog.isSetupEnabled(
        supatermSettings: SupatermSettings(
          appearanceMode: .system,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(
      !AppPostHog.isSetupEnabled(
        supatermSettings: SupatermSettings(
          appearanceMode: .system,
          analyticsEnabled: false,
          crashReportsEnabled: false,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppPostHog.isSetupEnabled(supatermSettings: .default, isDebugBuild: true))
  }

  @Test
  func analyticsRequiresAnalyticsAndNonDebugBuild() {
    #expect(AppPostHog.isAnalyticsEnabled(supatermSettings: .default, isDebugBuild: false))
    #expect(
      !AppPostHog.isAnalyticsEnabled(
        supatermSettings: SupatermSettings(
          appearanceMode: .system,
          analyticsEnabled: false,
          crashReportsEnabled: true,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppPostHog.isAnalyticsEnabled(supatermSettings: .default, isDebugBuild: true))
  }

  @Test
  func errorReportingRequiresCrashReportsAndNonDebugBuild() {
    #expect(AppPostHog.isErrorReportingEnabled(supatermSettings: .default, isDebugBuild: false))
    #expect(
      !AppPostHog.isErrorReportingEnabled(
        supatermSettings: SupatermSettings(
          appearanceMode: .system,
          analyticsEnabled: true,
          crashReportsEnabled: false,
          updateChannel: .stable
        ),
        isDebugBuild: false
      )
    )
    #expect(!AppPostHog.isErrorReportingEnabled(supatermSettings: .default, isDebugBuild: true))
  }
}
