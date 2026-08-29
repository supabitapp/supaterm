import Foundation
import SupatermCLIShared
import SupatermLicenseFeature

enum LicenseTabLimitAction: CaseIterable, Hashable {
  case activate
  case buy
}

@MainActor
final class LicenseTabGate {
  enum CreationReason: Equatable {
    case restore
    case socket
    case user

    var origin: LicenseTabLimitOrigin? {
      switch self {
      case .restore:
        nil
      case .socket:
        .socket
      case .user:
        .app
      }
    }
  }

  struct Refusal: Equatable {
    let limit: Int
    let openTabs: Int
  }

  static let tabLimit = SupatermLicensePolicy.freeTabLimit
  #if DEBUG || SUPATERM_SNAPSHOT_CATALOG
    static let unrestricted = LicenseTabGate(
      licenseAccess: { .free },
      enforcementEnabled: false
    )
  #endif
  private let licenseAccess: @MainActor () -> LicenseAccess
  private let enforcementEnabled: Bool
  private let onRefusal: @MainActor (LicenseTabLimitOrigin) -> Void

  init(
    licenseAccess: @escaping @MainActor () -> LicenseAccess,
    enforcementEnabled: Bool,
    onRefusal: @escaping @MainActor (LicenseTabLimitOrigin) -> Void = { _ in }
  ) {
    self.licenseAccess = licenseAccess
    self.enforcementEnabled = enforcementEnabled
    self.onRefusal = onRefusal
  }

  convenience init(
    licenseAccess: @escaping @MainActor () -> LicenseAccess,
    onRefusal: @escaping @MainActor (LicenseTabLimitOrigin) -> Void = { _ in }
  ) {
    #if DEBUG
      let enforcementEnabled = Self.enforcementEnabled(
        environment: ProcessInfo.processInfo.environment
      )
    #else
      let enforcementEnabled = true
    #endif
    self.init(
      licenseAccess: licenseAccess,
      enforcementEnabled: enforcementEnabled,
      onRefusal: onRefusal
    )
  }

  #if DEBUG
    static func enforcementEnabled(environment: [String: String]) -> Bool {
      environment["SUPATERM_TEST_MODE"] != "1"
        || environment["SUPATERM_LICENSE_MODE"] == "free"
    }
  #endif

  func refusal(
    for reason: CreationReason,
    openTabs: Int,
    addingTabs: Int = 1
  ) -> Refusal? {
    guard
      let origin = reason.origin,
      enforcementEnabled,
      !licenseAccess().permitsPaidUse
    else { return nil }
    guard openTabs + addingTabs > Self.tabLimit else { return nil }
    onRefusal(origin)
    return Refusal(limit: Self.tabLimit, openTabs: openTabs)
  }
}

extension TerminalHostState {
  var licenseTabCount: Int {
    spaceManager.instances.reduce(0) { count, instance in
      count + instance.tabs.count + (instance.pendingSession?.tabs.count ?? 0)
    }
  }
}
