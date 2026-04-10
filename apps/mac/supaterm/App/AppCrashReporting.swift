import Foundation
import Sentry
import Sharing
import SupatermSupport

enum AppCrashReporting {
  struct Configuration: Equatable {
    let dsn: String

    init?(infoDictionary: [String: Any]) {
      guard let dsn = Self.string(infoDictionary["SentryDSN"]) else {
        return nil
      }
      self.dsn = dsn
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
      SentrySDK.start { options in
        options.dsn = configuration.dsn
        options.tracesSampleRate = 1.0
        options.enableAppHangTracking = false
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

  static func isEnabled(
    supatermSettings: SupatermSettings,
    isDebugBuild: Bool
  ) -> Bool {
    supatermSettings.crashReportsEnabled && !isDebugBuild
  }
}
