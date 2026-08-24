import Foundation
import Sharing
import SupatermLicenseFeature
import SupatermSupport

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

  static let tabLimit = 5
  static let unrestricted = LicenseTabGate(
    licenseAccess: { .free },
    enforcementEnabled: false
  )
  private static let productionEnforcementEnabled = true

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
    entitlement: Shared<LicenseEntitlement?> = Shared(value: nil),
    releaseDay: @escaping @MainActor () -> LicenseDay = { AppBuild.releaseDay },
    onRefusal: @escaping @MainActor (LicenseTabLimitOrigin) -> Void = { _ in }
  ) {
    #if DEBUG
      let freeMode = Self.debugFreeMode(environment: ProcessInfo.processInfo.environment)
      self.init(
        licenseAccess: { .free },
        enforcementEnabled: freeMode,
        onRefusal: onRefusal
      )
    #else
      self.init(
        licenseAccess: {
          LicenseAccess(entitlement: entitlement.wrappedValue, releaseDay: releaseDay())
        },
        enforcementEnabled: Self.productionEnforcementEnabled,
        onRefusal: onRefusal
      )
    #endif
  }

  #if DEBUG
    static func debugFreeMode(environment: [String: String]) -> Bool {
      environment["SUPATERM_LICENSE_MODE"] == "free"
    }
  #endif

  func refusal(for reason: CreationReason, openTabs: Int) -> Refusal? {
    guard
      let origin = reason.origin,
      enforcementEnabled,
      !licenseAccess().permitsPaidUse
    else { return nil }
    guard openTabs >= Self.tabLimit else { return nil }
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
