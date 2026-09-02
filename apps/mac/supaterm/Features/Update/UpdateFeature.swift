import ComposableArchitecture
import SupatermSupport

private nonisolated enum UpdateFeatureCancelID: Hashable, Sendable {
  case notFoundDismissal
  case observation
  case restartPromptMinimization
}

@Reducer
public struct UpdateFeature {
  @ObservableState
  public struct State: Equatable {
    public var canCheckForUpdates: Bool
    public var phase: UpdatePhase

    public init(
      canCheckForUpdates: Bool = false,
      phase: UpdatePhase = .idle
    ) {
      self.canCheckForUpdates = canCheckForUpdates
      self.phase = phase
    }
  }

  public enum Action {
    case notFoundDismissalElapsed
    case perform(UpdateUserAction)
    case restartPromptDisplayElapsed
    case setUpdateChannel(UpdateChannel)
    case shutdown
    case task
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
  }

  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(\.continuousClock) var clock
  @Dependency(UpdateClient.self) var updateClient

  public init() {}

  public var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .notFoundDismissalElapsed:
        guard state.phase == .notFound else {
          return .none
        }
        return .run { [updateClient] _ in
          await updateClient.perform(.dismiss)
        }

      case .perform(let action):
        if action == .checkForUpdates && !state.canCheckForUpdates {
          return .none
        }
        if action == .checkForUpdates {
          analyticsClient.capture("update_checked")
        }
        let effect = Effect<Action>.run { [updateClient] _ in
          await updateClient.perform(action)
        }
        guard action == .restartLater else { return effect }
        return .merge(
          .cancel(id: UpdateFeatureCancelID.restartPromptMinimization),
          effect
        )

      case .restartPromptDisplayElapsed:
        guard state.phase.showsAutomaticRestartPrompt else { return .none }
        return .run { [updateClient] _ in
          await updateClient.perform(.restartLater)
        }

      case .setUpdateChannel(let updateChannel):
        return .run { [updateClient] _ in
          await updateClient.setUpdateChannel(updateChannel)
        }

      case .shutdown:
        return .merge(
          .cancel(id: UpdateFeatureCancelID.notFoundDismissal),
          .cancel(id: UpdateFeatureCancelID.observation),
          .cancel(id: UpdateFeatureCancelID.restartPromptMinimization)
        )

      case .task:
        return .run { [updateClient] send in
          await updateClient.start()
          let stream = await updateClient.observe()
          for await snapshot in stream {
            await send(.updateClientSnapshotReceived(snapshot))
          }
        }
        .cancellable(id: UpdateFeatureCancelID.observation, cancelInFlight: true)

      case .updateClientSnapshotReceived(let snapshot):
        let wasNotFound = state.phase == .notFound
        let wasShowingAutomaticRestartPrompt = state.phase.showsAutomaticRestartPrompt
        state.canCheckForUpdates = snapshot.canCheckForUpdates
        state.phase = snapshot.phase
        return .merge(
          notFoundDismissalEffect(
            wasNotFound: wasNotFound,
            isNotFound: snapshot.phase == .notFound
          ),
          restartPromptMinimizationEffect(
            wasShowing: wasShowingAutomaticRestartPrompt,
            isShowing: snapshot.phase.showsAutomaticRestartPrompt
          )
        )
      }
    }
  }

  private func notFoundDismissalEffect(
    wasNotFound: Bool,
    isNotFound: Bool
  ) -> Effect<Action> {
    guard isNotFound else {
      return .cancel(id: UpdateFeatureCancelID.notFoundDismissal)
    }
    guard !wasNotFound else { return .none }
    return .run { [clock] send in
      try await clock.sleep(for: .seconds(5))
      await send(.notFoundDismissalElapsed)
    }
    .cancellable(id: UpdateFeatureCancelID.notFoundDismissal, cancelInFlight: true)
  }

  private func restartPromptMinimizationEffect(
    wasShowing: Bool,
    isShowing: Bool
  ) -> Effect<Action> {
    guard isShowing else {
      return .cancel(id: UpdateFeatureCancelID.restartPromptMinimization)
    }
    guard !wasShowing else { return .none }
    return .run { [clock] send in
      try await clock.sleep(for: .seconds(60))
      await send(.restartPromptDisplayElapsed)
    }
    .cancellable(id: UpdateFeatureCancelID.restartPromptMinimization, cancelInFlight: true)
  }
}
