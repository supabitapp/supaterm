import ComposableArchitecture
import SupatermSocketFeature

@Reducer
struct AppFeature {
  enum ReleaseAnnouncementStatus: Equatable {
    case loaded(ReleaseAnnouncement?)
    case loading
    case notLoaded
  }

  struct ProcessState: Equatable {
    var releaseAnnouncementStatus = ReleaseAnnouncementStatus.notLoaded
  }

  @ObservableState
  struct State: Equatable {
    @Shared var releaseAnnouncementStatus: ReleaseAnnouncementStatus
    var socket = SocketControlFeature.State()
    var terminal: TerminalWindowFeature.State

    init(
      process: Shared<ProcessState> = Shared(value: ProcessState()),
      terminal: TerminalWindowFeature.State = TerminalWindowFeature.State()
    ) {
      self._releaseAnnouncementStatus = process[dynamicMember: \.releaseAnnouncementStatus]
      self.terminal = terminal
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
          releaseAnnouncementEffect
        )

      case .terminal:
        return .none

      case .shutdown:
        return .send(.socket(.shutdown))

      case .socket:
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
