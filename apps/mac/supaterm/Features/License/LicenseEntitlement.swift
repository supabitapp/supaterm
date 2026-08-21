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
  let signedToken: String?

  public init(
    licenseID: String,
    deviceID: String,
    status: Status,
    updatesThrough: LicenseDay?,
    revision: Int,
    issuedAt: Int64,
    revocationReason: String? = nil
  ) {
    self.init(
      licenseID: licenseID,
      deviceID: deviceID,
      status: status,
      updatesThrough: updatesThrough,
      revision: revision,
      issuedAt: issuedAt,
      revocationReason: revocationReason,
      signedToken: nil
    )
  }

  init(
    licenseID: String,
    deviceID: String,
    status: Status,
    updatesThrough: LicenseDay?,
    revision: Int,
    issuedAt: Int64,
    revocationReason: String?,
    signedToken: String?
  ) {
    self.licenseID = licenseID
    self.deviceID = deviceID
    self.status = status
    self.updatesThrough = updatesThrough
    self.revision = revision
    self.issuedAt = issuedAt
    self.revocationReason = revocationReason
    self.signedToken = signedToken
  }

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
