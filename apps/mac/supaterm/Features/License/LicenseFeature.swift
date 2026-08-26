import ComposableArchitecture
import Foundation
import Sharing
import SupatermCLIShared
import SupatermSupport

private nonisolated enum LicenseFeatureCancelID: Hashable, Sendable {
  case activation
  case deactivation
  case periodicRefresh
  case refresh
}

public enum LicenseFeaturePhase: Equatable, Sendable {
  case activating
  case deactivating
  case idle
  case refreshing
}

public enum LicenseRefreshSource: Equatable, Sendable {
  case automatic
  case command
}

public struct LicenseOperationCompletion: Sendable {
  private let complete: @Sendable (Result<Void, LicenseClientError>) -> Void

  public init(
    _ complete: @escaping @Sendable (Result<Void, LicenseClientError>) -> Void
  ) {
    self.complete = complete
  }

  func callAsFunction(_ result: Result<Void, LicenseClientError>) {
    complete(result)
  }
}

public struct LicenseFeatureError: Equatable, Sendable {
  public enum Operation: Equatable, Sendable {
    case activation
    case deactivation
    case refresh
  }

  public let operation: Operation
  public let cause: LicenseClientError

  public init(operation: Operation, cause: LicenseClientError) {
    self.operation = operation
    self.cause = cause
  }

  public var code: String {
    switch cause {
    case .connectionRequired:
      "connection_required"
    case .inactiveLicense:
      "license_inactive"
    case .invalidEntitlement:
      "invalid_entitlement"
    case .invalidLicenseKey:
      "invalid_license_key"
    case .missingLicenseKey:
      "missing_license_key"
    case .server(let code, _, _):
      code
    }
  }

  public var message: String {
    switch cause {
    case .connectionRequired where operation == .deactivation:
      "Deactivation needs a connection. If you cannot reconnect, email license@supaterm.com."
    case .connectionRequired:
      "Check your connection and try again."
    case .inactiveLicense:
      "This license is not active."
    case .invalidEntitlement:
      "The license server returned an invalid response."
    case .invalidLicenseKey:
      "Enter a valid Supaterm license key."
    case .missingLicenseKey:
      "Enter your Supaterm license key."
    case .server(_, let message, _):
      message
    }
  }
}

public struct LicenseNotice: Equatable, Sendable {
  public enum Kind: Equatable, Sendable {
    case chargeback
    case deactivated
    case refunded
    case revoked
    case transferred
  }

  public let kind: Kind
  public let day: LicenseDay

  public init?(entitlement: LicenseEntitlement) {
    switch entitlement.status {
    case .active:
      return nil
    case .deactivated:
      kind = .deactivated
    case .transferred:
      kind = .transferred
    case .revoked:
      switch entitlement.revocationReason {
      case "chargeback":
        kind = .chargeback
      case "refund":
        kind = .refunded
      default:
        kind = .revoked
      }
    }
    day = LicenseDay.today(at: Date(timeIntervalSince1970: TimeInterval(entitlement.issuedAt)))
  }

  public var message: String {
    switch kind {
    case .chargeback:
      "This license was revoked after a payment dispute on \(day.rawValue)."
    case .deactivated:
      "This license was deactivated on \(day.rawValue)."
    case .refunded:
      "This license was refunded on \(day.rawValue)."
    case .revoked:
      "This license was revoked on \(day.rawValue)."
    case .transferred:
      "This license moved to another Mac on \(day.rawValue)."
    }
  }

  init?(entitlement: LicenseEntitlement, acknowledgement: LicenseNoticeAcknowledgement?) {
    let current = LicenseNoticeAcknowledgement(
      licenseID: entitlement.licenseID,
      revision: entitlement.revision
    )
    guard acknowledgement != current else { return nil }
    self.init(entitlement: entitlement)
  }
}

@Reducer
public struct LicenseFeature {
  @ObservableState
  public struct State: Equatable {
    public var error: LicenseFeatureError?
    public var key = ""
    @Shared var session: LicenseSession

    public init(runtime: LicenseRuntime) {
      _session = runtime.session
    }

    public var entitlement: LicenseEntitlement? {
      session.entitlement
    }

    public var hasLicenseKey: Bool {
      session.hasLicenseKey
    }

    public var notice: LicenseNotice? {
      entitlement.flatMap {
        LicenseNotice(entitlement: $0, acknowledgement: session.noticeAcknowledgement)
      }
    }

    public var phase: LicenseFeaturePhase {
      session.phase
    }

    public var access: LicenseAccess {
      LicenseAccess(entitlement: entitlement, releaseDay: AppBuild.releaseDay)
    }

    public var errorMessage: String? {
      error?.message
    }

  }

  public enum Action {
    case activationButtonTapped
    case activationRequested(String, LicenseOperationCompletion)
    case activationResponse(Result<Void, LicenseClientError>)
    case applicationBecameActive
    case buyButtonTapped
    case deactivationButtonTapped
    case deactivationRequested(LicenseOperationCompletion)
    case deactivationResponse(Result<Void, LicenseClientError>)
    case keyChanged(String)
    case noticeBuyButtonTapped
    case noticeDifferentKeyButtonTapped
    case ownedReleaseButtonTapped
    case prefillKey(String)
    case refreshRequested(LicenseRefreshSource)
    case refreshCommandRequested(LicenseOperationCompletion)
    case refreshResponse(LicenseRefreshSource, Result<Void, LicenseClientError>)
    case renewButtonTapped
    case shutdown
    case tabLimitHit(LicenseTabLimitOrigin)
    case task
  }

  @Dependency(\.continuousClock) private var clock
  @Dependency(\.analyticsClient) private var analyticsClient
  @Dependency(\.externalNavigationClient) private var externalNavigationClient
  private let runtime: LicenseRuntime

  public init(runtime: LicenseRuntime) {
    self.runtime = runtime
  }

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .activationButtonTapped:
        return activate(&state, key: state.key, completion: nil)

      case .activationRequested(let key, let completion):
        return activate(&state, key: key, completion: completion)

      case .activationResponse(.success):
        state.key = ""
        analyticsClient.capture("license_activated")
        return .none

      case .activationResponse(.failure(let error)):
        state.error = LicenseFeatureError(operation: .activation, cause: error)
        analyticsClient.capture("license_activation_failed")
        return .none

      case .applicationBecameActive:
        guard case .expired = state.access else { return .none }
        return refresh(&state, source: .automatic, completion: nil)

      case .buyButtonTapped:
        guard AppBuild.licenseSalesEnabled else { return .none }
        analyticsClient.capture("license_buy_opened")
        return .run { @MainActor [externalNavigationClient] _ in
          _ = externalNavigationClient.open(LicensePortalURL.buy)
        }

      case .deactivationButtonTapped:
        return deactivate(&state, completion: nil)

      case .deactivationRequested(let completion):
        return deactivate(&state, completion: completion)

      case .deactivationResponse(.success):
        analyticsClient.capture("license_deactivated")
        return .none

      case .deactivationResponse(.failure(let error)):
        state.error = LicenseFeatureError(operation: .deactivation, cause: error)
        return .none

      case .keyChanged(let key):
        state.key = key
        state.error = nil
        return .none

      case .noticeBuyButtonTapped:
        runtime.acknowledgeNotice()
        return .send(.buyButtonTapped)

      case .noticeDifferentKeyButtonTapped:
        runtime.acknowledgeNotice()
        return .none

      case .ownedReleaseButtonTapped:
        guard case .expired = state.access else { return .none }
        analyticsClient.capture("license_owned_release_download_opened")
        return .none

      case .prefillKey(let key):
        state.key = key
        state.error = nil
        return .none

      case .refreshRequested(let source):
        return refresh(&state, source: source, completion: nil)

      case .refreshCommandRequested(let completion):
        return refresh(&state, source: .command, completion: completion)

      case .refreshResponse(_, .success):
        return .none

      case .refreshResponse(let source, .failure(let error)):
        if source == .command {
          state.error = LicenseFeatureError(operation: .refresh, cause: error)
        }
        return .none

      case .renewButtonTapped:
        guard AppBuild.licenseSalesEnabled else { return .none }
        guard let licenseID = state.access.ownership?.licenseID else { return .none }
        analyticsClient.capture("license_renew_opened")
        return .run { @MainActor [externalNavigationClient] _ in
          _ = externalNavigationClient.open(LicensePortalURL.license(licenseID))
        }

      case .shutdown:
        runtime.cancelOperations()
        return .merge(
          .cancel(id: LicenseFeatureCancelID.activation),
          .cancel(id: LicenseFeatureCancelID.deactivation),
          .cancel(id: LicenseFeatureCancelID.periodicRefresh),
          .cancel(id: LicenseFeatureCancelID.refresh)
        )

      case .tabLimitHit(let origin):
        analyticsClient.captureProperties("tab_limit_hit", ["origin": origin.rawValue])
        if case .expired = state.access {
          analyticsClient.capture("license_expired_release_blocked")
        }
        return .none

      case .task:
        return .merge(
          refresh(&state, source: .automatic, completion: nil),
          periodicRefreshEffect()
        )

      }
    }
  }

  private func activate(
    _ state: inout State,
    key: String,
    completion: LicenseOperationCompletion?
  ) -> Effect<Action> {
    guard !key.isEmpty, runtime.beginActivation() else { return .none }
    state.error = nil
    return .run { [key, runtime] send in
      defer { runtime.finishActivation() }
      do {
        try await runtime.activateAndApply(key)
        let result = Result<Void, LicenseClientError>.success(())
        await send(.activationResponse(result))
        completion?(result)
      } catch is CancellationError {
        return
      } catch {
        let result = Result<Void, LicenseClientError>.failure(LicenseClientError(error))
        await send(.activationResponse(result))
        completion?(result)
      }
    }
    .cancellable(id: LicenseFeatureCancelID.activation, cancelInFlight: true)
  }

  private func deactivate(
    _ state: inout State,
    completion: LicenseOperationCompletion?
  ) -> Effect<Action> {
    guard state.hasLicenseKey, runtime.beginDeactivation() else { return .none }
    state.error = nil
    return .run { [runtime] send in
      defer { runtime.finishDeactivation() }
      do {
        try await runtime.deactivateAndApply()
        let result = Result<Void, LicenseClientError>.success(())
        await send(.deactivationResponse(result))
        completion?(result)
      } catch is CancellationError {
        return
      } catch {
        let result = Result<Void, LicenseClientError>.failure(LicenseClientError(error))
        await send(.deactivationResponse(result))
        completion?(result)
      }
    }
    .cancellable(id: LicenseFeatureCancelID.deactivation, cancelInFlight: true)
  }

  private func refresh(
    _ state: inout State,
    source: LicenseRefreshSource,
    completion: LicenseOperationCompletion?
  ) -> Effect<Action> {
    guard runtime.beginRefresh() else { return .none }
    if source == .command {
      state.error = nil
    }
    return .run { [runtime] send in
      defer { runtime.finishRefresh() }
      do {
        try await runtime.refreshStartedAndApply()
        let result = Result<Void, LicenseClientError>.success(())
        await send(.refreshResponse(source, result))
        completion?(result)
      } catch is CancellationError {
        return
      } catch {
        let result = Result<Void, LicenseClientError>.failure(LicenseClientError(error))
        await send(.refreshResponse(source, result))
        completion?(result)
      }
    }
    .cancellable(id: LicenseFeatureCancelID.refresh, cancelInFlight: true)
  }

  private func periodicRefreshEffect() -> Effect<Action> {
    .run { [clock, runtime] send in
      while true {
        try await clock.sleep(for: runtime.refreshInterval())
        await send(.refreshRequested(.automatic))
      }
    }
    .cancellable(id: LicenseFeatureCancelID.periodicRefresh, cancelInFlight: true)
  }

}

public enum LicenseTabLimitOrigin: String, Equatable, Sendable {
  case app
  case socket
}

public enum LicensePortalURL {
  public static let buy = URL(string: "https://license.supaterm.com/buy")!

  public static func license(_ licenseID: String) -> URL {
    URL(string: "https://license.supaterm.com/licenses/\(licenseID)")!
  }
}

public enum LicenseActivationURL {
  public static func key(from url: URL) -> String? {
    guard
      url.scheme?.lowercased() == "supaterm",
      url.host?.lowercased() == "activate",
      url.path.isEmpty || url.path == "/",
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
    else { return nil }
    let values = components.queryItems?.filter { $0.name == "key" }.compactMap(\.value) ?? []
    guard
      values.count == 1,
      case .valid(let key) = SupatermLicensePolicy.validateLicenseKey(values[0])
    else { return nil }
    return key
  }
}
