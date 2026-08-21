public struct LicenseEntitlement: Equatable, Sendable {
  public enum Status: String, Codable, Sendable {
    case active
    case deactivated
    case revoked
    case transferred
  }

  public let licenseID: String
  public let deviceID: String
  public let status: Status
  public let updatesThrough: LicenseDay?
  public let revision: Int
  public let issuedAt: Int64
  public let revocationReason: String?
  let signedToken: String

  public static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.licenseID == rhs.licenseID
      && lhs.deviceID == rhs.deviceID
      && lhs.status == rhs.status
      && lhs.updatesThrough == rhs.updatesThrough
      && lhs.revision == rhs.revision
      && lhs.issuedAt == rhs.issuedAt
      && lhs.revocationReason == rhs.revocationReason
  }
}
