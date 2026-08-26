import Sparkle
import SupatermLicenseFeature
import SupatermSupport

struct UpdateRelease<Value> {
  let value: Value
  let version: String
  let displayVersion: String
  let releaseDay: LicenseDay?
  let channel: String?

  init(
    value: Value,
    version: String,
    displayVersion: String? = nil,
    releaseDay: LicenseDay?,
    channel: String?
  ) {
    self.value = value
    self.version = version
    self.displayVersion = displayVersion ?? version
    self.releaseDay = releaseDay
    self.channel = channel
  }
}

enum UpdateOwnershipDecision<Value> {
  case install(Value)
  case none
  case renew(UpdatePhase.OwnershipEnded)
  case unfiltered
}

extension UpdateOwnershipDecision: Equatable where Value: Equatable {}

struct UpdateOwnershipPolicy {
  let currentVersion: String
  let licenseAccess: LicenseAccess
  let updateChannel: UpdateChannel

  func decision<Value>(
    in releases: [UpdateRelease<Value>]
  ) -> UpdateOwnershipDecision<Value> {
    guard let ownership = licenseAccess.ownership else { return .unfiltered }
    let eligible = releases.filter { release in
      isAllowed(channel: release.channel) && isNewerThanCurrent(release.version)
    }
    guard let newest = newestRelease(in: eligible), let releaseDay = newest.releaseDay else {
      return .none
    }
    guard releaseDay > ownership.updatesThrough else {
      return .install(newest.value)
    }
    return .renew(
      UpdatePhase.OwnershipEnded(
        licenseID: ownership.licenseID,
        updatesThrough: ownership.updatesThrough,
        version: newest.displayVersion
      )
    )
  }

  func newestOwnedRelease<Value>(
    in releases: [UpdateRelease<Value>],
    through updatesThrough: LicenseDay
  ) -> UpdateRelease<Value>? {
    releases
      .filter { release in
        guard release.channel == nil, let releaseDay = release.releaseDay else { return false }
        return releaseDay <= updatesThrough
      }
      .max { lhs, rhs in
        compare(lhs.version, rhs.version) == .orderedAscending
      }
  }

  private func newestRelease<Value>(
    in releases: [UpdateRelease<Value>]
  ) -> UpdateRelease<Value>? {
    releases.max { lhs, rhs in
      compare(lhs.version, rhs.version) == .orderedAscending
    }
  }

  private func isAllowed(channel: String?) -> Bool {
    guard let channel else { return true }
    return updateChannel.sparkleChannels.contains(channel)
  }

  private func isNewerThanCurrent(_ version: String) -> Bool {
    compare(version, currentVersion) == .orderedDescending
  }

  private func compare(_ lhs: String, _ rhs: String) -> ComparisonResult {
    SUStandardVersionComparator.default.compareVersion(lhs, toVersion: rhs)
  }
}
