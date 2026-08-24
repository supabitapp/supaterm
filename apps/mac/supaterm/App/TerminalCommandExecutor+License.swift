import Combine
import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSupport
import SupatermTerminalCore

extension TerminalCommandExecutor {
  func execute(_ request: LicenseControlRequest) async throws -> LicenseControlResult {
    guard let store = registry.applicationStore else {
      throw LicenseControlError(
        code: "unavailable",
        message: "Supaterm license state is unavailable."
      )
    }

    switch request {
    case .activate(let key):
      guard
        !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        key.count <= 128
      else {
        throw LicenseControlError(
          code: "invalid_license_key",
          message: "Enter a valid Supaterm license key."
        )
      }
      try requireIdle(store)
      store.send(.license(.activationRequested(key)))
      await waitForLicenseOperation(store)
      try requireSuccessfulLicenseOperation(store)
      return .status(licenseStatus(store))

    case .buy:
      try requireIdle(store)
      await store.send(.license(.buyButtonTapped)).finish()
      return .url(SupatermLicenseURLResult(url: LicensePortalURL.buy.absoluteString))

    case .deactivate:
      try requireLicenseKey(store)
      try requireIdle(store)
      store.send(.license(.deactivationButtonTapped))
      await waitForLicenseOperation(store)
      try requireSuccessfulLicenseOperation(store)
      return .status(licenseStatus(store))

    case .refresh:
      try requireLicenseKey(store)
      try requireIdle(store)
      store.send(.license(.refreshRequested(.command)))
      await waitForLicenseOperation(store)
      try requireSuccessfulLicenseOperation(store)
      return .status(licenseStatus(store))

    case .renew:
      try requireIdle(store)
      guard let licenseID = store.license.entitlement?.licenseID else {
        throw LicenseControlError(
          code: "missing_license_key",
          message: "Activate a license before renewing updates."
        )
      }
      await store.send(.license(.renewButtonTapped)).finish()
      return .url(
        SupatermLicenseURLResult(url: LicensePortalURL.license(licenseID).absoluteString)
      )

    case .status:
      return .status(licenseStatus(store))
    }
  }

  private func licenseStatus(
    _ store: StoreOf<AppFeature>
  ) -> SupatermLicenseStatusResult {
    let mode =
      switch store.license.mode {
      case .free:
        SupatermLicenseMode.free
      case .paid:
        SupatermLicenseMode.paid
      case .expiredOnNewerRelease:
        SupatermLicenseMode.expired
      }
    return SupatermLicenseStatusResult(
      mode: mode,
      updatesThrough: store.license.entitlement?.updatesThrough?.rawValue,
      deviceName: licenseDeviceName(),
      openTabCount: registry.licenseTabCount,
      freeTabLimit: LicenseTabGate.tabLimit
    )
  }

  private func requireIdle(_ store: StoreOf<AppFeature>) throws {
    guard store.license.phase == .idle else {
      throw LicenseControlError(
        code: "license_busy",
        message: "Another license action is in progress."
      )
    }
  }

  private func requireLicenseKey(_ store: StoreOf<AppFeature>) throws {
    guard store.license.hasLicenseKey else {
      throw LicenseControlError(
        code: "missing_license_key",
        message: "Activate a license first."
      )
    }
  }

  private func requireSuccessfulLicenseOperation(_ store: StoreOf<AppFeature>) throws {
    if let error = store.license.error {
      throw LicenseControlError(code: error.code, message: error.message)
    }
  }

  private func waitForLicenseOperation(_ store: StoreOf<AppFeature>) async {
    for await phase in store.publisher.license.phase.values where phase == .idle {
      return
    }
  }
}
