import Foundation
import PostHog
import SupatermSupport
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
  func configBootstrapsAnalyticsIdentityAndFiltersOpenBackground() throws {
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
      supatermSettings: .default,
      distinctID: "hardware-id"
    )

    #expect(config.captureApplicationLifecycleEvents)
    #expect(!config.captureScreenViews)
    #expect(!config.enableSwizzling)
    #expect(config.errorTrackingConfig.autoCapture)
    #expect(config.personProfiles == .identifiedOnly)
    #expect(config.bootstrap?.distinctId == "hardware-id")
    #expect(config.bootstrap?.isIdentifiedId == true)
    #expect(!AppPostHog.shouldSend(eventName: "Application Opened"))
    #expect(!AppPostHog.shouldSend(eventName: "Application Backgrounded"))
    #expect(AppPostHog.shouldSend(eventName: "Application Installed"))
    #expect(AppPostHog.shouldSend(eventName: "Application Updated"))
    #expect(AppPostHog.shouldSend(eventName: "terminal_tab_created"))
  }

  @Test
  func configKeepsCrashReportsFreeOfAnalyticsIdentityAndLifecycleEvents() throws {
    let configuration = try #require(
      AppPostHog.Configuration(
        infoDictionary: [
          "PostHogProjectToken": "phc_test",
          "PostHogHost": "https://us.i.posthog.com",
          "PostHogPersonProfiles": "identified_only",
        ]
      )
    )
    let settings = SupatermSettings(
      appearanceMode: .system,
      analyticsEnabled: false,
      crashReportsEnabled: true,
      updateChannel: .stable
    )
    let config = AppPostHog.makeConfig(
      configuration: configuration,
      supatermSettings: settings,
      distinctID: nil
    )

    #expect(!config.captureApplicationLifecycleEvents)
    #expect(config.errorTrackingConfig.autoCapture)
    #expect(config.bootstrap == nil)
  }

  @Test
  func activationDebouncesForFifteenMinutes() {
    let base = Date(timeIntervalSince1970: 1_000)
    var debouncer = AppPostHog.AppLifecycleEventDebouncer()
    var events: [String] = []

    if debouncer.shouldCapture(event: .activatedDebounced, now: base) {
      events.append(AppPostHog.AppLifecycleEvent.activatedDebounced.rawValue)
    }

    if debouncer.shouldCapture(event: .activatedDebounced, now: base.addingTimeInterval(899)) {
      events.append(AppPostHog.AppLifecycleEvent.activatedDebounced.rawValue)
    }

    if debouncer.shouldCapture(event: .activatedDebounced, now: base.addingTimeInterval(900)) {
      events.append(AppPostHog.AppLifecycleEvent.activatedDebounced.rawValue)
    }

    #expect(events == ["app_activated_debounced", "app_activated_debounced"])
  }

  @Test
  func deactivationDebouncesForFifteenMinutes() {
    let base = Date(timeIntervalSince1970: 2_000)
    var debouncer = AppPostHog.AppLifecycleEventDebouncer()
    var events: [String] = []

    if debouncer.shouldCapture(event: .deactivatedDebounced, now: base) {
      events.append(AppPostHog.AppLifecycleEvent.deactivatedDebounced.rawValue)
    }

    if debouncer.shouldCapture(event: .deactivatedDebounced, now: base.addingTimeInterval(899)) {
      events.append(AppPostHog.AppLifecycleEvent.deactivatedDebounced.rawValue)
    }

    if debouncer.shouldCapture(event: .deactivatedDebounced, now: base.addingTimeInterval(900)) {
      events.append(AppPostHog.AppLifecycleEvent.deactivatedDebounced.rawValue)
    }

    #expect(events == ["app_deactivated_debounced", "app_deactivated_debounced"])
  }

  @Test
  func activationAndDeactivationDebounceIndependently() {
    let base = Date(timeIntervalSince1970: 3_000)
    var debouncer = AppPostHog.AppLifecycleEventDebouncer()
    var events: [String] = []

    if debouncer.shouldCapture(event: .activatedDebounced, now: base) {
      events.append(AppPostHog.AppLifecycleEvent.activatedDebounced.rawValue)
    }

    if debouncer.shouldCapture(event: .deactivatedDebounced, now: base.addingTimeInterval(1)) {
      events.append(AppPostHog.AppLifecycleEvent.deactivatedDebounced.rawValue)
    }

    #expect(events == ["app_activated_debounced", "app_deactivated_debounced"])
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
