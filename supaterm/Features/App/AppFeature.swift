import ComposableArchitecture

@Reducer
struct AppFeature {
  @ObservableState
  struct State: Equatable {
    var share = ShareServerFeature.State()
    var terminal = TerminalSceneFeature.State()
    var update = UpdateFeature.State()
  }

  enum Action {
    case quitRequested(ObjectIdentifier)
    case share(ShareServerFeature.Action)
    case terminal(TerminalSceneFeature.Action)
    case update(UpdateFeature.Action)
  }

  @Dependency(AppTerminationClient.self) var appTerminationClient
  @Dependency(ShareServerClient.self) var shareServerClient
  @Dependency(TerminalWindowsClient.self) var terminalWindowsClient

  var body: some Reducer<State, Action> {
    Scope(state: \.share, action: \.share) {
      ShareServerFeature()
    }

    Scope(state: \.terminal, action: \.terminal) {
      TerminalSceneFeature()
    }

    Scope(state: \.update, action: \.update) {
      UpdateFeature()
    }

    Reduce { state, action in
      switch action {
      case .quitRequested(let windowID):
        if state.update.phase.bypassesQuitConfirmation {
          return terminateApp()
        }
        return .send(.terminal(.quitRequested(windowID: windowID)))

      case .terminal(.quitConfirmationConfirmButtonTapped):
        return terminateApp()

      case .share:
        return .none

      case .terminal:
        return .none

      case .update:
        return .none
      }
    }
  }

  private func terminateApp() -> Effect<Action> {
    .run { [appTerminationClient, shareServerClient, terminalWindowsClient] _ in
      await shareServerClient.stop()
      await terminalWindowsClient.prepareForTermination(true)
      await appTerminationClient.reply(true)
    }
  }
}
