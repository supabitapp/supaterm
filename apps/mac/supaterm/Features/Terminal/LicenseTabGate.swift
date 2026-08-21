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
  private static let productionEnforcementEnabled = true

  private weak var registry: TerminalWindowRegistry?
  private let licenseMode: @MainActor () -> LicenseMode
  private let enforcementEnabled: Bool
  private let onRefusal: @MainActor (LicenseTabLimitOrigin) -> Void

  init(
    registry: TerminalWindowRegistry? = nil,
    licenseMode: @escaping @MainActor () -> LicenseMode = { .paid },
    enforcementEnabled: Bool = false,
    onRefusal: @escaping @MainActor (LicenseTabLimitOrigin) -> Void = { _ in }
  ) {
    self.registry = registry
    self.licenseMode = licenseMode
    self.enforcementEnabled = enforcementEnabled
    self.onRefusal = onRefusal
  }

  convenience init(
    registry: TerminalWindowRegistry,
    entitlement: Shared<LicenseEntitlement?> = Shared(value: nil),
    releaseDay: @escaping @MainActor () -> LicenseDay = { AppBuild.releaseDay },
    onRefusal: @escaping @MainActor (LicenseTabLimitOrigin) -> Void = { _ in }
  ) {
    #if DEBUG
      let mode = Self.debugLicenseMode(environment: ProcessInfo.processInfo.environment)
      self.init(
        registry: registry,
        licenseMode: { mode },
        enforcementEnabled: mode == .free || Self.productionEnforcementEnabled,
        onRefusal: onRefusal
      )
    #else
      self.init(
        registry: registry,
        licenseMode: {
          LicenseMode(entitlement: entitlement.wrappedValue, releaseDay: releaseDay())
        },
        enforcementEnabled: Self.productionEnforcementEnabled,
        onRefusal: onRefusal
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
      let origin = reason.origin,
      enforcementEnabled,
      licenseMode() != .paid
    else { return nil }
    let openTabs = registry?.licenseTabCount ?? 0
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
