import Foundation

enum AppBuild {
  static var isDevelopment: Bool {
    #if DEBUG
      true
    #else
      isDevelopmentFlag(Bundle.main.object(forInfoDictionaryKey: "SupatermDevelopmentBuild"))
    #endif
  }

  static var allowsBackgroundUpdateCheckOnLaunch: Bool {
    allowsBackgroundUpdateCheckOnLaunch(isDevelopment: isDevelopment)
  }

  static func isDevelopmentFlag(_ rawValue: Any?) -> Bool {
    switch rawValue {
    case let value as Bool:
      value
    case let value as String:
      ["1", "true", "yes"].contains(value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    default:
      false
    }
  }

  static func allowsBackgroundUpdateCheckOnLaunch(isDevelopment: Bool) -> Bool {
    true
  }
}
