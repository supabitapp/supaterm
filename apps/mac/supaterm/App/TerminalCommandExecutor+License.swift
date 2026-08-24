import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermLicenseFeature
import SupatermSupport

extension TerminalCommandExecutor {
  func execute(_ request: LicenseControlRequest) async throws -> LicenseControlResult {
    let store = registry.licenseStore

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
      try await performLicenseOperation(store, operation: .activation) {
        .activationRequested(key, $0)
      }
      return .status(licenseStatus(store))

    case .buy:
      try requireLicenseSales()
      try requireIdle(store)
      await store.send(.buyButtonTapped).finish()
      return .url(SupatermLicenseURLResult(url: LicensePortalURL.buy.absoluteString))

    case .deactivate:
      try requireLicenseKey(store)
      try requireIdle(store)
      try await performLicenseOperation(store, operation: .deactivation) {
        .deactivationRequested($0)
      }
      return .status(licenseStatus(store))

    case .refresh:
      try requireLicenseKey(store)
      try requireIdle(store)
      try await performLicenseOperation(store, operation: .refresh) {
        .refreshCommandRequested($0)
      }
      return .status(licenseStatus(store))

    case .renew:
      try requireLicenseSales()
      try requireIdle(store)
      guard let licenseID = store.access.ownership?.licenseID else {
        throw LicenseControlError(
          code: "missing_license_key",
          message: "Activate a license before renewing updates."
        )
      }
      await store.send(.renewButtonTapped).finish()
      return .url(
        SupatermLicenseURLResult(url: LicensePortalURL.license(licenseID).absoluteString)
      )

    case .status:
      return .status(licenseStatus(store))
    }
  }

  private func licenseStatus(
    _ store: StoreOf<LicenseFeature>
  ) -> SupatermLicenseStatusResult {
    let access = store.access
    let mode =
      switch access {
      case .free:
        SupatermLicenseMode.free
      case .paid:
        SupatermLicenseMode.paid
      case .expired:
        SupatermLicenseMode.expired
      }
    return SupatermLicenseStatusResult(
      mode: mode,
      updatesThrough: access.ownership?.updatesThrough.rawValue,
      deviceName: licenseDeviceName(),
      openTabCount: registry.licenseTabCount
    )
  }

  private func requireIdle(_ store: StoreOf<LicenseFeature>) throws {
    guard store.phase == .idle else {
      throw LicenseControlError(
        code: "license_busy",
        message: "Another license action is in progress."
      )
    }
  }

  private func requireLicenseSales() throws {
    guard AppBuild.licenseSalesEnabled else {
      throw LicenseControlError(
        code: "license_sales_unavailable",
        message: "License sales are not open yet."
      )
    }
  }

  private func requireLicenseKey(_ store: StoreOf<LicenseFeature>) throws {
    guard store.hasLicenseKey else {
      throw LicenseControlError(
        code: "missing_license_key",
        message: "Activate a license first."
      )
    }
  }

  private func performLicenseOperation(
    _ store: StoreOf<LicenseFeature>,
    operation: LicenseFeatureError.Operation,
    action: (LicenseOperationCompletion) -> LicenseFeature.Action
  ) async throws {
    let result = LockIsolated<Result<Void, LicenseClientError>?>(nil)
    let completion = LicenseOperationCompletion { value in
      result.withValue { $0 = value }
    }
    await store.send(action(completion)).finish()
    guard let result = result.value else {
      throw LicenseControlError(
        code: "license_cancelled",
        message: "The license action was cancelled."
      )
    }
    if case .failure(let cause) = result {
      let error = LicenseFeatureError(operation: operation, cause: cause)
      throw LicenseControlError(code: error.code, message: error.message)
    }
  }
}
