import SupatermSupport

public struct LicenseOwnership: Equatable, Sendable {
  public let licenseID: String
  public let updatesThrough: LicenseDay

  public init(licenseID: String, updatesThrough: LicenseDay) {
    self.licenseID = licenseID
    self.updatesThrough = updatesThrough
  }
}

public enum LicenseAccess: Equatable, Sendable {
  case free
  case paid(LicenseOwnership)
  case expired(LicenseOwnership)

  public init(entitlement: LicenseEntitlement?, releaseDay: LicenseDay) {
    guard
      let entitlement,
      entitlement.status == .active,
      let updatesThrough = entitlement.updatesThrough
    else {
      self = .free
      return
    }

    let ownership = LicenseOwnership(
      licenseID: entitlement.licenseID,
      updatesThrough: updatesThrough
    )
    self = releaseDay <= updatesThrough ? .paid(ownership) : .expired(ownership)
  }

  public var ownership: LicenseOwnership? {
    switch self {
    case .free:
      nil
    case .paid(let ownership), .expired(let ownership):
      ownership
    }
  }

  public var permitsPaidUse: Bool {
    if case .paid = self { return true }
    return false
  }
}
