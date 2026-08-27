import Foundation

public enum AppBuild {
  public nonisolated static var usesStubServices: Bool {
    #if DEBUG
      true
    #else
      false
    #endif
  }

  public nonisolated static var usesStubUpdateChecks: Bool {
    usesStubServices
  }

  public nonisolated static var isDevelopmentBuild: Bool {
    #if DEBUG
      true
    #else
      isEnabledFlag(Bundle.main.object(forInfoDictionaryKey: "SupatermDevelopmentBuild"))
    #endif
  }

  public nonisolated static var isTestMode: Bool {
    ProcessInfo.processInfo.environment["SUPATERM_TEST_MODE"] == "1"
  }

  public nonisolated static var version: String {
    infoString("CFBundleShortVersionString")
  }

  public nonisolated static var buildNumber: String {
    infoString("CFBundleVersion")
  }

  public nonisolated static var releaseDay: LicenseDay {
    if let day = parsedReleaseDay(infoString("SupatermReleaseDate")) { return day }
    #if DEBUG
      return .today()
    #else
      preconditionFailure("Release build has no valid SupatermReleaseDate")
    #endif
  }

  nonisolated static func parsedReleaseDay(_ infoValue: String?) -> LicenseDay? {
    guard
      let infoValue,
      let day = LicenseDay(infoValue.trimmingCharacters(in: .whitespacesAndNewlines))
    else { return nil }
    return day
  }

  nonisolated static func isEnabledFlag(_ value: Any?) -> Bool {
    switch value {
    case let boolValue as Bool:
      return boolValue
    case let stringValue as String:
      return ["1", "true", "yes"].contains(stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
    case let numberValue as NSNumber:
      return numberValue.boolValue
    default:
      return false
    }
  }

  public nonisolated static func infoString(_ key: String) -> String {
    let value = Bundle.main.object(forInfoDictionaryKey: key) as? String
    return value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }
}
