import ComposableArchitecture
import SupatermSocketFeature
import SupatermUpdateFeature

@Reducer
struct AppFeature {
  enum ReleaseAnnouncementStatus: Equatable {
    case loaded(ReleaseAnnouncement?)
    case loading
    case notLoaded
  }

  struct ProcessState: Equatable {
    var license = LicenseFeature.State()
    var releaseAnnouncementStatus = ReleaseAnnouncementStatus.notLoaded
    var update = UpdateFeature.State()
  }

  @ObservableState
  struct State: Equatable {
    @Shared var license: LicenseFeature.State
    @Shared var releaseAnnouncementStatus: ReleaseAnnouncementStatus
    var socket = SocketControlFeature.State()
    var terminal: TerminalWindowFeature.State
    @Shared var update: UpdateFeature.State

    init(
      process: Shared<ProcessState> = Shared(value: ProcessState()),
      terminal: TerminalWindowFeature.State = TerminalWindowFeature.State()
    ) {
      self._license = process[dynamicMember: \.license]
      self._releaseAnnouncementStatus = process[dynamicMember: \.releaseAnnouncementStatus]
      self.terminal = terminal
      self._update = process[dynamicMember: \.update]
    }

    var releaseAnnouncement: ReleaseAnnouncement? {
      guard case .loaded(let announcement) = releaseAnnouncementStatus else { return nil }
      return announcement
    }
  }

  enum Action {
    case license(LicenseFeature.Action)
    case releaseAnnouncementDismissed
    case task
    case terminal(TerminalWindowFeature.Action)
    case shutdown
    case socket(SocketControlFeature.Action)
    case update(UpdateFeature.Action)
    case releaseAnnouncementLoaded(ReleaseAnnouncement?)
  }

  @Dependency(ReleaseAnnouncementClient.self) private var releaseAnnouncementClient
  @Dependency(\.externalNavigationClient) private var externalNavigationClient
  @Dependency(UpdateClient.self) private var updateClient

  var body: some Reducer<State, Action> {
    Scope(state: \.terminal, action: \.terminal) {
      TerminalWindowFeature()
    }

    Scope(state: \.socket, action: \.socket) {
      SocketControlFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Scope(state: \.license, action: \.license) {
      LicenseFeature()
    }

    Reduce { state, action in
      switch action {
      case .task:
        let releaseAnnouncementEffect: Effect<Action>
        if state.releaseAnnouncementStatus == .notLoaded {
          state.$releaseAnnouncementStatus.withLock { $0 = .loading }
          releaseAnnouncementEffect = .run { [releaseAnnouncementClient] send in
            await send(.releaseAnnouncementLoaded(await releaseAnnouncementClient.synchronize()))
          }
        } else {
          releaseAnnouncementEffect = .none
        }
        return .concatenate(
          .send(.license(.task)),
          .send(.socket(.task)),
          .send(.update(.task)),
          releaseAnnouncementEffect
        )

      case .terminal:
        return .none

      case .license(.ownedReleaseButtonTapped):
        guard
          state.license.mode == .expiredOnNewerRelease,
          let updatesThrough = state.license.entitlement?.updatesThrough
        else { return .none }
        return .run { @MainActor [externalNavigationClient, updateClient] _ in
          guard let url = await updateClient.newestOwnedReleaseURL(updatesThrough) else {
            return
          }
          _ = externalNavigationClient.open(url)
        }

      case .license:
        return .none

      case .shutdown:
        return .merge(
          .send(.license(.shutdown)),
          .send(.socket(.shutdown)),
          .send(.update(.shutdown))
        )

      case .socket:
        return .none

      case .update:
        return .none

      case .releaseAnnouncementLoaded(let announcement):
        guard state.releaseAnnouncementStatus == .loading else { return .none }
        state.$releaseAnnouncementStatus.withLock { $0 = .loaded(announcement) }
        return .none

      case .releaseAnnouncementDismissed:
        guard case .loaded(let announcement?) = state.releaseAnnouncementStatus else { return .none }
        state.$releaseAnnouncementStatus.withLock { $0 = .loaded(nil) }
        return .run { [releaseAnnouncementClient, version = announcement.version.rawValue] _ in
          releaseAnnouncementClient.acknowledge(version)
        }
      }
    }
  }
}
