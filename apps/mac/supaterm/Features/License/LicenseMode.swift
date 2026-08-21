public enum LicenseMode: Equatable, Sendable {
  case free
  case paid
  case expiredOnNewerRelease

  public init(entitlement: LicenseEntitlement?, releaseDay: LicenseDay) {
    guard
      let entitlement,
      entitlement.status == .active,
      let updatesThrough = entitlement.updatesThrough
    else {
      self = .free
      return
    }

    self = releaseDay <= updatesThrough ? .paid : .expiredOnNewerRelease
  }
}
