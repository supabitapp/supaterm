import Foundation
import PostHog
import Sharing
import SupatermSupport

enum AppPostHog {
  struct Configuration: Equatable {
    let projectToken: String
    let host: String
    let personProfiles: PostHogPersonProfiles

    init?(infoDictionary: [String: Any]) {
      guard
        let projectToken = Self.string(infoDictionary["PostHogProjectToken"]),
        let host = Self.string(infoDictionary["PostHogHost"]),
        let personProfiles = Self.personProfiles(infoDictionary["PostHogPersonProfiles"])
      else {
        return nil
      }

      self.projectToken = projectToken
      self.host = host
      self.personProfiles = personProfiles
    }

    private static func personProfiles(_ value: Any?) -> PostHogPersonProfiles? {
      guard let value = string(value) else { return nil }

      switch value.lowercased() {
      case "always":
        return .always
      case "identified_only":
        return .identifiedOnly
      case "never":
        return .never
      default:
        return nil
      }
    }

    private static func string(_ value: Any?) -> String? {
      guard let value = value as? String else { return nil }
      let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
      return trimmed.isEmpty ? nil : trimmed
    }
  }

  #if !DEBUG
    private static let state = AppPostHogState()
  #endif

  @MainActor
  static func setup(
    supatermSettings: SupatermSettings,
    infoDictionary: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard isSetupEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else {
        state.setErrorReportingEnabled(false)
        return
      }
      guard let configuration = Configuration(infoDictionary: infoDictionary) else {
        state.setErrorReportingEnabled(false)
        return
      }

      let config = makeConfig(
        configuration: configuration,
        supatermSettings: supatermSettings
      )
      PostHogSDK.shared.setup(config)
      state.setErrorReportingEnabled(supatermSettings.crashReportsEnabled)
      if supatermSettings.analyticsEnabled {
        if let hardwareUUID = hardwareUUID() {
          PostHogSDK.shared.identify(hardwareUUID)
        }
        PostHogSDK.shared.capture("app_launched")
      }
    #endif
  }

  @MainActor
  static func setup() {
    @Shared(.supatermSettings) var supatermSettings = .default
    setup(
      supatermSettings: supatermSettings,
      infoDictionary: Bundle.main.infoDictionary ?? [:]
    )
  }

  @MainActor
  static func capture(_ event: String) {
    #if DEBUG
      return
    #else
      @Shared(.supatermSettings) var supatermSettings = .default
      guard isAnalyticsEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else { return }
      PostHogSDK.shared.capture(event)
    #endif
  }

  nonisolated static func addExceptionStep(
    _ message: String,
    category: AppLogCategory
  ) {
    #if DEBUG
      return
    #else
      guard state.isErrorReportingEnabled else { return }
      PostHogSDK.shared.addExceptionStep(
        message,
        properties: ["category": category.rawValue]
      )
    #endif
  }

  nonisolated static func captureException(
    _ error: Error,
    properties: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard state.isErrorReportingEnabled else { return }
      PostHogSDK.shared.captureException(error, properties: properties)
    #endif
  }

  static func makeConfig(
    configuration: Configuration,
    supatermSettings: SupatermSettings
  ) -> PostHogConfig {
    let config = PostHogConfig(
      projectToken: configuration.projectToken,
      host: configuration.host
    )
    config.captureApplicationLifecycleEvents = true
    config.captureScreenViews = false
    config.enableSwizzling = false
    config.errorTrackingConfig.autoCapture = supatermSettings.crashReportsEnabled
    config.personProfiles = configuration.personProfiles
    return config
  }

  static func isSetupEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    (supatermSettings.analyticsEnabled || supatermSettings.crashReportsEnabled) && !isDebugBuild
  }

  static func isAnalyticsEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.analyticsEnabled && !isDebugBuild
  }

  static func isErrorReportingEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.crashReportsEnabled && !isDebugBuild
  }
}

#if !DEBUG
  nonisolated private final class AppPostHogState: @unchecked Sendable {
    private let lock = NSLock()
    private var errorReportingEnabled = false

    var isErrorReportingEnabled: Bool {
      lock.lock()
      let value = errorReportingEnabled
      lock.unlock()
      return value
    }

    func setErrorReportingEnabled(_ isEnabled: Bool) {
      lock.lock()
      errorReportingEnabled = isEnabled
      lock.unlock()
    }
  }
#endif
