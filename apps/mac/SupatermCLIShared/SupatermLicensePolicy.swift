import Foundation

public enum SupatermLicensePolicy {
  public enum LicenseKeyValidation: Equatable, Sendable {
    case empty
    case tooLong
    case valid(String)
  }

  public static let freeTabLimit = 5
  public static let maximumLicenseKeyLength = 128

  public static func validateLicenseKey(_ rawValue: String) -> LicenseKeyValidation {
    let key = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !key.isEmpty else { return .empty }
    guard key.count <= maximumLicenseKeyLength else { return .tooLong }
    return .valid(key)
  }
}
