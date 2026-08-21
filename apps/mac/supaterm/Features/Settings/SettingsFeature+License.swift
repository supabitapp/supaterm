import SupatermSupport

extension LicenseFeature.State {
  var settingsStatus: String {
    switch mode {
    case .free:
      switch entitlement?.status {
      case .revoked:
        "This license is no longer valid."
      case .deactivated, .transferred:
        "This license is not active on this Mac."
      case .active, nil:
        "Use Supaterm free with up to five tabs, or activate a license."
      }
    case .paid:
      "Supaterm is activated on this Mac."
    case .expiredOnNewerRelease:
      "Your update entitlement ended \(entitlement?.updatesThrough?.rawValue ?? "")."
    }
  }
}
