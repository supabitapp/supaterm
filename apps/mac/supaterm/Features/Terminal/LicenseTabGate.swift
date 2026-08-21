import Foundation
import Sharing
import SupatermSupport

enum LicenseTabLimitAction: CaseIterable, Hashable {
  case activate
  case buy
}

@MainActor
final class LicenseTabGate {
  enum CreationReason: Equatable {
    case restore
    case user
  }

  struct Refusal: Equatable {
    let limit: Int
    let openTabs: Int
  }

  static let tabLimit = 5
  private static let productionEnforcementEnabled = false

  private weak var registry: TerminalWindowRegistry?
  private let licenseMode: @MainActor () -> LicenseMode
  private let enforcementEnabled: Bool

  init(
    registry: TerminalWindowRegistry? = nil,
    licenseMode: @escaping @MainActor () -> LicenseMode = { .paid },
    enforcementEnabled: Bool = false
  ) {
    self.registry = registry
    self.licenseMode = licenseMode
    self.enforcementEnabled = enforcementEnabled
  }

  convenience init(
    registry: TerminalWindowRegistry,
    entitlement: Shared<LicenseEntitlement?> = Shared(value: nil),
    releaseDay: @escaping @MainActor () -> LicenseDay = { AppBuild.releaseDay }
  ) {
    #if DEBUG
      let mode = Self.debugLicenseMode(environment: ProcessInfo.processInfo.environment)
      self.init(
        registry: registry,
        licenseMode: { mode },
        enforcementEnabled: mode == .free || Self.productionEnforcementEnabled
      )
    #else
      self.init(
        registry: registry,
        licenseMode: {
          LicenseMode(entitlement: entitlement.wrappedValue, releaseDay: releaseDay())
        },
        enforcementEnabled: Self.productionEnforcementEnabled
      )
    #endif
  }

  #if DEBUG
    static func debugLicenseMode(environment: [String: String]) -> LicenseMode {
      environment["SUPATERM_LICENSE_MODE"] == "free" ? .free : .paid
    }
  #endif

  func refusal(for reason: CreationReason) -> Refusal? {
    guard
      reason == .user,
      enforcementEnabled,
      licenseMode() != .paid
    else { return nil }
    let openTabs = registry?.licenseTabCount ?? 0
    guard openTabs >= Self.tabLimit else { return nil }
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
