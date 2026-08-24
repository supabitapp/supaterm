import Foundation

public enum SupatermLicenseTiming {
  public static let networkRequestTimeout: TimeInterval = 55
  public static let serverReplyTimeout = networkRequestTimeout * 2 + 5
  public static let clientResponseTimeout = serverReplyTimeout + 5
}

public struct SupatermLicenseActivationRequest: Codable, Equatable, Sendable {
  public let key: String

  public init(key: String) {
    self.key = key
  }
}

public enum SupatermLicenseMode: String, Codable, Equatable, Sendable {
  case expired
  case free
  case paid
}

public struct SupatermLicenseStatusResult: Codable, Equatable, Sendable {
  public let mode: SupatermLicenseMode
  public let updatesThrough: String?
  public let deviceName: String
  public let openTabCount: Int

  public init(
    mode: SupatermLicenseMode,
    updatesThrough: String?,
    deviceName: String,
    openTabCount: Int
  ) {
    self.mode = mode
    self.updatesThrough = updatesThrough
    self.deviceName = deviceName
    self.openTabCount = openTabCount
  }
}

public struct SupatermLicenseURLResult: Codable, Equatable, Sendable {
  public let url: String

  public init(url: String) {
    self.url = url
  }
}

public enum LicenseControlRequest: Equatable, Sendable {
  case activate(String)
  case buy
  case deactivate
  case refresh
  case renew
  case status
}

public enum LicenseControlResult: Equatable, Sendable {
  case status(SupatermLicenseStatusResult)
  case url(SupatermLicenseURLResult)
}

public struct LicenseControlError: Error, Equatable, Sendable {
  public let code: String
  public let message: String

  public init(code: String, message: String) {
    self.code = code
    self.message = message
  }
}
