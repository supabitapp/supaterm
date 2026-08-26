import SupatermLicenseFeature
import SupatermSupport

extension LicenseFeature.State {
  var settingsStatus: String {
    switch access {
    case .free:
      switch entitlement?.status {
      case .revoked:
        "This license is no longer valid."
      case .deactivated, .transferred:
        "This license is not active on this Mac."
      case .active, nil:
        if AppBuild.licenseSalesEnabled {
          "Use Supaterm free with up to five tabs, or activate a license."
        } else {
          "Use Supaterm free, or activate an existing license."
        }
      }
    case .paid:
      "Supaterm is activated on this Mac."
    case .expired(let ownership):
      "Your update entitlement ended \(ownership.updatesThrough.rawValue)."
    }
  }
}
