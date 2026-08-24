import ComposableArchitecture
import Foundation

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

@Reducer
public struct LicenseFeature {
  @ObservableState
  public struct State: Equatable {
    public var entitlement: LicenseEntitlement?
    public var error: LicenseFeatureError?
    public var hasLicenseKey: Bool
    public var key = ""
    public var phase = LicenseFeaturePhase.idle

    public init(
      snapshot: LicenseClient.Snapshot = LicenseClient.Snapshot(
        entitlement: nil,
        hasLicenseKey: false
      )
    ) {
      entitlement = snapshot.entitlement
      hasLicenseKey = snapshot.hasLicenseKey
    }

    public var mode: LicenseMode {
      LicenseMode(entitlement: entitlement, releaseDay: AppBuild.releaseDay)
    }

    public var errorMessage: String? {
      error?.message
    }
  }

  public enum Action {
    case activationButtonTapped
    case activationRequested(String)
    case activationResponse(Result<LicenseEntitlement, LicenseClientError>)
    case applicationBecameActive
    case buyButtonTapped
    case deactivationButtonTapped
    case deactivationResponse(Result<Void, LicenseClientError>)
    case keyChanged(String)
    case ownedReleaseButtonTapped
    case prefillKey(String)
    case refreshRequested(LicenseRefreshSource)
    case refreshResponse(LicenseRefreshSource, Result<LicenseEntitlement, LicenseClientError>)
    case renewButtonTapped
    case shutdown
    case tabLimitHit(LicenseTabLimitOrigin)
    case task
  }

  @Dependency(\.continuousClock) private var clock
  @Dependency(\.analyticsClient) private var analyticsClient
  @Dependency(\.externalNavigationClient) private var externalNavigationClient
  @Dependency(\.licenseClient) private var licenseClient

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .activationButtonTapped:
        return activate(&state, key: state.key)

      case .activationRequested(let key):
        return activate(&state, key: key)

      case .activationResponse(.success(let entitlement)):
        guard state.phase == .activating else { return .none }
        state.entitlement = entitlement
        state.hasLicenseKey = true
        state.key = ""
        state.phase = .idle
        if entitlement.status == .active {
          analyticsClient.capture("license_activated")
          return periodicRefreshEffect()
        }
        analyticsClient.capture("license_activation_failed")
        return .none

      case .activationResponse(.failure(let error)):
        guard state.phase == .activating else { return .none }
        state.error = LicenseFeatureError(operation: .activation, cause: error)
        state.phase = .idle
        analyticsClient.capture("license_activation_failed")
        return .none

      case .applicationBecameActive:
        guard state.mode == .expiredOnNewerRelease else { return .none }
        return .send(.refreshRequested(.automatic))

      case .buyButtonTapped:
        analyticsClient.capture("license_buy_opened")
        return .run { @MainActor [externalNavigationClient] _ in
          _ = externalNavigationClient.open(LicensePortalURL.buy)
        }

      case .deactivationButtonTapped:
        guard state.phase == .idle, state.hasLicenseKey else { return .none }
        state.error = nil
        state.phase = .deactivating
        return .run { [licenseClient] send in
          do {
            try await licenseClient.deactivate()
            await send(.deactivationResponse(.success(())))
          } catch {
            await send(.deactivationResponse(.failure(LicenseClientError(error))))
          }
        }
        .cancellable(id: LicenseFeatureCancelID.deactivation, cancelInFlight: true)

      case .deactivationResponse(.success):
        guard state.phase == .deactivating else { return .none }
        state.entitlement = nil
        state.hasLicenseKey = false
        state.phase = .idle
        analyticsClient.capture("license_deactivated")
        return .none

      case .deactivationResponse(.failure(let error)):
        guard state.phase == .deactivating else { return .none }
        state.error = LicenseFeatureError(operation: .deactivation, cause: error)
        state.phase = .idle
        return .none

      case .keyChanged(let key):
        state.key = key
        state.error = nil
        return .none

      case .ownedReleaseButtonTapped:
        guard
          state.mode == .expiredOnNewerRelease,
          let licenseID = state.entitlement?.licenseID
        else { return .none }
        analyticsClient.capture("license_owned_release_download_opened")
        return .run { @MainActor [externalNavigationClient] _ in
          _ = externalNavigationClient.open(LicensePortalURL.license(licenseID))
        }

      case .prefillKey(let key):
        state.key = key
        state.error = nil
        return .none

      case .refreshRequested(let source):
        guard state.hasLicenseKey, state.phase == .idle else { return .none }
        if source == .command {
          state.error = nil
        }
        state.phase = .refreshing
        return .run { [licenseClient] send in
          do {
            await send(.refreshResponse(source, .success(try await licenseClient.refresh())))
          } catch {
            await send(
              .refreshResponse(source, .failure(LicenseClientError(error)))
            )
          }
        }
        .cancellable(id: LicenseFeatureCancelID.refresh, cancelInFlight: true)

      case .refreshResponse(_, .success(let entitlement)):
        guard state.phase == .refreshing else { return .none }
        let wasActive = state.entitlement?.status == .active
        state.entitlement = entitlement
        state.phase = .idle
        if wasActive && entitlement.status != .active {
          analyticsClient.capture("license_refresh_revoked")
        }
        return .none

      case .refreshResponse(let source, .failure(let error)):
        guard state.phase == .refreshing else { return .none }
        if source == .command {
          state.error = LicenseFeatureError(operation: .refresh, cause: error)
        }
        state.phase = .idle
        return .none

      case .renewButtonTapped:
        guard let licenseID = state.entitlement?.licenseID else { return .none }
        analyticsClient.capture("license_renew_opened")
        return .run { @MainActor [externalNavigationClient] _ in
          _ = externalNavigationClient.open(LicensePortalURL.license(licenseID))
        }

      case .shutdown:
        state.phase = .idle
        return .merge(
          .cancel(id: LicenseFeatureCancelID.activation),
          .cancel(id: LicenseFeatureCancelID.deactivation),
          .cancel(id: LicenseFeatureCancelID.periodicRefresh),
          .cancel(id: LicenseFeatureCancelID.refresh)
        )

      case .tabLimitHit(let origin):
        analyticsClient.captureProperties("tab_limit_hit", ["origin": origin.rawValue])
        if state.mode == .expiredOnNewerRelease {
          analyticsClient.capture("license_expired_release_blocked")
        }
        return .none

      case .task:
        return .merge(
          .send(.refreshRequested(.automatic)),
          state.hasLicenseKey ? periodicRefreshEffect() : .none
        )
      }
    }
  }

  private func activate(_ state: inout State, key: String) -> Effect<Action> {
    guard state.phase == .idle, !key.isEmpty else { return .none }
    state.error = nil
    state.phase = .activating
    return .run { [key, licenseClient] send in
      do {
        await send(.activationResponse(.success(try await licenseClient.activate(key))))
      } catch {
        await send(.activationResponse(.failure(LicenseClientError(error))))
      }
    }
    .cancellable(id: LicenseFeatureCancelID.activation, cancelInFlight: true)
  }

  private func periodicRefreshEffect() -> Effect<Action> {
    .run { [clock, licenseClient] send in
      while true {
        try await clock.sleep(for: licenseClient.refreshInterval())
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
    guard values.count == 1, !values[0].isEmpty, values[0].count <= 128 else { return nil }
    return values[0]
  }
}
