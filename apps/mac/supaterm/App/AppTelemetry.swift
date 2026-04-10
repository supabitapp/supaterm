import Foundation
import PostHog
import Sharing
import SupatermSupport

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
    supatermSettings: SupatermSettings,
    infoDictionary: [String: Any]
  ) {
    #if DEBUG
      return
    #else
      guard isEnabled(supatermSettings: supatermSettings, isDebugBuild: false) else { return }
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
      guard supatermSettings.analyticsEnabled else { return }
      PostHogSDK.shared.capture(event)
    #endif
  }

  static func isEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.analyticsEnabled && !isDebugBuild
  }
}
