import ComposableArchitecture
import SupatermLicenseFeature
import SupatermUpdateFeature

@Reducer
struct AppLicenseFeature {
  @ObservableState
  struct State: Equatable {
    var license: LicenseFeature.State

    init(runtime: LicenseRuntime) {
      license = LicenseFeature.State(runtime: runtime)
    }
  }

  enum Action {
    case license(LicenseFeature.Action)
  }

  @Dependency(\.externalNavigationClient) private var externalNavigationClient
  @Dependency(UpdateClient.self) private var updateClient
  private let runtime: LicenseRuntime

  init(runtime: LicenseRuntime) {
    self.runtime = runtime
  }

  var body: some Reducer<State, Action> {
    Scope(state: \.license, action: \.license) {
      LicenseFeature(runtime: runtime)
    }

    Reduce { state, action in
      switch action {
      case .license(.ownedReleaseButtonTapped):
        guard case .expired(let ownership) = state.license.access else { return .none }
        return .run { @MainActor [externalNavigationClient, updateClient] _ in
          guard
            let url = await updateClient.newestOwnedReleaseURL(ownership.updatesThrough)
          else {
            return
          }
          _ = externalNavigationClient.open(url)
        }

      case .license:
        return .none
      }
    }
  }
}
