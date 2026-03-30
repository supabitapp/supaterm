import Foundation
import PostHog
import Sharing

enum AppTelemetry {
  struct Configuration: Equatable {
    let apiKey: String
    let host: String
    let personProfiles: PostHogPersonProfiles

    init?(infoDictionary: [String: Any]) {
      guard
        let apiKey = Self.string(infoDictionary["PostHogAPIKey"]),
        let host = Self.string(infoDictionary["PostHogHost"]),
        let personProfiles = Self.personProfiles(infoDictionary["PostHogPersonProfiles"])
      else {
        return nil
      }

      self.apiKey = apiKey
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

  @MainActor
  static func setup(
    appPrefs: AppPrefs,
    infoDictionary: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard isEnabled(appPrefs: appPrefs, isDebugBuild: false) else { return }
      guard let configuration = Configuration(infoDictionary: infoDictionary) else { return }

      let config = PostHogConfig(
        apiKey: configuration.apiKey,
        host: configuration.host
      )
      config.captureApplicationLifecycleEvents = false
      config.captureScreenViews = false
      config.enableSwizzling = false
      config.personProfiles = configuration.personProfiles
      PostHogSDK.shared.setup(config)
      if let hardwareUUID = HardwareInfo.uuid {
        PostHogSDK.shared.identify(hardwareUUID)
      }
      PostHogSDK.shared.capture("app_launched")
    #endif
  }

  @MainActor
  static func setup() {
    @Shared(.appPrefs) var appPrefs = .default
    setup(
      appPrefs: appPrefs,
      infoDictionary: Bundle.main.infoDictionary ?? [:]
    )
  }

  @MainActor
  static func capture(_ event: String) {
    #if DEBUG
      return
    #else
      @Shared(.appPrefs) var appPrefs = .default
      guard appPrefs.analyticsEnabled else { return }
      PostHogSDK.shared.capture(event)
    #endif
  }

  static func isEnabled(
    appPrefs: AppPrefs,
    isDebugBuild: Bool
  ) -> Bool {
    appPrefs.analyticsEnabled && !isDebugBuild
  }
}
