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
  public let freeTabLimit: Int

  public init(
    mode: SupatermLicenseMode,
    updatesThrough: String?,
    deviceName: String,
    openTabCount: Int,
    freeTabLimit: Int
  ) {
    self.mode = mode
    self.updatesThrough = updatesThrough
    self.deviceName = deviceName
    self.openTabCount = openTabCount
    self.freeTabLimit = freeTabLimit
  }
}

public struct SupatermLicenseURLResult: Codable, Equatable, Sendable {
  public let url: String

  public init(url: String) {
    self.url = url
  }
}
