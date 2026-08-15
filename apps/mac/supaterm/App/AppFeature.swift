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
    var releaseAnnouncementStatus = ReleaseAnnouncementStatus.notLoaded
    var socket = SocketControlFeature.State()
    var update = UpdateFeature.State()
  }

  @ObservableState
  struct State: Equatable {
    @Shared var releaseAnnouncementStatus: ReleaseAnnouncementStatus
    @Shared var socket: SocketControlFeature.State
    var terminal: TerminalWindowFeature.State
    @Shared var update: UpdateFeature.State

    init(
      process: Shared<ProcessState> = Shared(value: ProcessState()),
      terminal: TerminalWindowFeature.State = TerminalWindowFeature.State()
    ) {
      self._releaseAnnouncementStatus = process[dynamicMember: \.releaseAnnouncementStatus]
      self._socket = process[dynamicMember: \.socket]
      self.terminal = terminal
      self._update = process[dynamicMember: \.update]
    }

    var releaseAnnouncement: ReleaseAnnouncement? {
      guard case .loaded(let announcement) = releaseAnnouncementStatus else { return nil }
      return announcement
    }
  }

  enum Action {
    case releaseAnnouncementDismissed
    case task
    case terminal(TerminalWindowFeature.Action)
    case shutdown
    case socket(SocketControlFeature.Action)
    case update(UpdateFeature.Action)
    case releaseAnnouncementLoaded(ReleaseAnnouncement?)
  }

  @Dependency(ReleaseAnnouncementClient.self) private var releaseAnnouncementClient

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
          .send(.socket(.task)),
          .send(.update(.task)),
          releaseAnnouncementEffect
        )

      case .terminal:
        return .none

      case .shutdown:
        return .merge(
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
