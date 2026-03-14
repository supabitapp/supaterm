import ComposableArchitecture

private enum UpdateFeatureCancelID {
  static let debugStubCheck = "UpdateFeature.debugStubCheck"
  static let observation = "UpdateFeature.observation"
}

@Reducer
struct UpdateFeature {
  @ObservableState
  struct State: Equatable {
    var canCheckForUpdates = false
    var isDevelopmentBuild = false
    var isDevelopmentIndicatorHovering = false
    var isPopoverPresented = false
    var phase: UpdatePhase = .idle
    var presentationContext = UpdatePresentationContext()

    var pillContent: UpdatePillContent? {
      UpdatePillContent(
        phase: phase,
        isDevelopmentBuild: isDevelopmentBuild,
        isDevelopmentIndicatorHovering: isDevelopmentIndicatorHovering
      )
    }
  }

  enum Action {
    case allowAutomaticUpdatesButtonTapped
    case checkForUpdatesButtonTapped
    case debugStubCheckFinished
    case developmentBuildHoverChanged(Bool)
    case dismissButtonTapped
    case installAndRelaunchButtonTapped
    case laterButtonTapped
    case pillButtonTapped
    case popoverPresentedChanged(Bool)
    case presentationContextChanged(UpdatePresentationContext)
    case restartNowButtonTapped
    case retryButtonTapped
    case skipButtonTapped
    case task
    case updateClientSnapshotReceived(UpdateClient.Snapshot)
  }

  @Dependency(\.continuousClock) var clock
  @Dependency(AppBuildClient.self) var appBuildClient
  @Dependency(UpdateClient.self) var updateClient

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .allowAutomaticUpdatesButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .idle
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.allowAutomaticUpdates)
        }

      case .checkForUpdatesButtonTapped:
        guard state.canCheckForUpdates else { return .none }
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .checking
        if appBuildClient.usesStubUpdateChecks() {
          return .run { [clock] send in
            try? await clock.sleep(for: .seconds(1))
            await send(.debugStubCheckFinished)
          }
          .cancellable(id: UpdateFeatureCancelID.debugStubCheck, cancelInFlight: true)
        }
        return .run { [updateClient] _ in
          await updateClient.checkForUpdates()
        }

      case .debugStubCheckFinished:
        guard case .checking = state.phase else { return .none }
        state.phase = .idle
        return .none

      case .developmentBuildHoverChanged(let isHovering):
        guard state.isDevelopmentBuild else { return .none }
        guard state.phase.isIdle else { return .none }
        guard state.isDevelopmentIndicatorHovering != isHovering else { return .none }
        state.isDevelopmentIndicatorHovering = isHovering
        return .none

      case .dismissButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .idle
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.dismiss)
        }

      case .installAndRelaunchButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.install)
        }

      case .laterButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .idle
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.later)
        }

      case .pillButtonTapped:
        guard !state.phase.isIdle else { return .none }
        guard state.phase.allowsPopover else { return .none }
        state.isPopoverPresented.toggle()
        return .none

      case .popoverPresentedChanged(let isPresented):
        state.isPopoverPresented = state.phase.allowsPopover && isPresented
        return .none

      case .presentationContextChanged(let presentationContext):
        guard state.presentationContext != presentationContext else { return .none }
        state.presentationContext = presentationContext
        return .run { [updateClient] _ in
          await updateClient.setPresentationContext(presentationContext)
        }

      case .restartNowButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.restartNow)
        }

      case .retryButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .idle
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.retry)
        }

      case .skipButtonTapped:
        state.isDevelopmentIndicatorHovering = false
        state.isPopoverPresented = false
        state.phase = .idle
        return .run { [updateClient] _ in
          await updateClient.sendIntent(.skip)
        }

      case .task:
        state.isDevelopmentBuild = appBuildClient.isDevelopmentBuild()
        state.canCheckForUpdates = appBuildClient.usesStubUpdateChecks()
        if !state.isDevelopmentBuild {
          state.isDevelopmentIndicatorHovering = false
        }
        return .run { [updateClient] send in
          await updateClient.start()
          let stream = await updateClient.observe()
          for await snapshot in stream {
            await send(.updateClientSnapshotReceived(snapshot))
          }
        }
        .cancellable(id: UpdateFeatureCancelID.observation, cancelInFlight: true)

      case .updateClientSnapshotReceived(let snapshot):
        state.canCheckForUpdates = snapshot.canCheckForUpdates || appBuildClient.usesStubUpdateChecks()
        if case .notFound = snapshot.phase {
          state.isDevelopmentIndicatorHovering = false
          state.isPopoverPresented = false
          state.phase = .idle
          return .run { [updateClient] _ in
            await updateClient.sendIntent(.dismiss)
          }
        }

        state.phase = snapshot.phase
        if !state.isDevelopmentBuild || !snapshot.phase.isIdle {
          state.isDevelopmentIndicatorHovering = false
        }
        if !snapshot.phase.allowsPopover {
          state.isPopoverPresented = false
        }
        return .none
      }
    }
  }
}
