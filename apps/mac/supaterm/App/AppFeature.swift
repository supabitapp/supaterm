import ComposableArchitecture
import SupatermTerminalFeature
import SupatermUpdateFeature

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var terminal = TerminalWindowFeature.State()
    var update = UpdateFeature.State()
    var releaseAnnouncement: ReleaseAnnouncement?
  }

  enum Action {
    case task
    case terminal(TerminalWindowFeature.Action)
    case update(UpdateFeature.Action)
    case releaseAnnouncementLoaded(ReleaseAnnouncement?)
    case releaseAnnouncementDismissed
  }

  @Dependency(ReleaseAnnouncementClient.self) private var releaseAnnouncementClient

  var body: some Reducer<State, Action> {
    Scope(state: \.terminal, action: \.terminal) {
      TerminalWindowFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { state, action in
      switch action {
      case .task:
        guard state.releaseAnnouncement == nil else { return .none }
        return .run { [releaseAnnouncementClient] send in
          await send(.releaseAnnouncementLoaded(releaseAnnouncementClient.synchronize()))
        }

      case .terminal:
        return .none

      case .update:
        return .none

      case .releaseAnnouncementLoaded(let announcement):
        state.releaseAnnouncement = announcement
        return .none

      case .releaseAnnouncementDismissed:
        guard let announcement = state.releaseAnnouncement else { return .none }
        state.releaseAnnouncement = nil
        return .run { [releaseAnnouncementClient, version = announcement.version.rawValue] _ in
          releaseAnnouncementClient.acknowledge(version)
        }
      }
    }
  }
}
