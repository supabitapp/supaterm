import ComposableArchitecture
import SupatermTerminalFeature
import SupatermTerminalModels
import SupatermUpdateFeature

@Reducer
public struct AppFeature {
  @ObservableState
  public struct State: Equatable {
    public var terminal = TerminalWindowFeature.State()
    public var update = UpdateFeature.State()
    public var releaseAnnouncement: ReleaseAnnouncement?

    public init(
      terminal: TerminalWindowFeature.State = TerminalWindowFeature.State(),
      update: UpdateFeature.State = UpdateFeature.State(),
      releaseAnnouncement: ReleaseAnnouncement? = nil
    ) {
      self.terminal = terminal
      self.update = update
      self.releaseAnnouncement = releaseAnnouncement
    }
  }

  public enum Action {
    case task
    case terminal(TerminalWindowFeature.Action)
    case update(UpdateFeature.Action)
    case releaseAnnouncementLoaded(ReleaseAnnouncement?)
    case releaseAnnouncementDismissed
  }

  @Dependency(ReleaseAnnouncementClient.self) private var releaseAnnouncementClient

  public init() {}

  public var body: some Reducer<State, Action> {
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
