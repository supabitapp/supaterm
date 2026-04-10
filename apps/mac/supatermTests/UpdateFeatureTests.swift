import ComposableArchitecture
import SupatermUpdateFeature
import Testing

@testable import supaterm

@MainActor
struct UpdateFeatureTests {
  @Test
  func performCheckForUpdatesUsesClientWhenEnabled() async {
    let recorder = UpdateActionRecorder()
    let analyticsRecorder = AnalyticsEventRecorder()
    var initialState = UpdateFeature.State()
    initialState.canCheckForUpdates = true

    let store = TestStore(initialState: initialState) {
      UpdateFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(.perform(.checkForUpdates))
    #expect(await recorder.actions() == [.checkForUpdates])
    #expect(analyticsRecorder.recorded() == ["update_checked"])
  }

  @Test
  func performCheckForUpdatesDoesNothingWhenDisabled() async {
    let recorder = UpdateActionRecorder()
    let analyticsRecorder = AnalyticsEventRecorder()

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(.perform(.checkForUpdates))
    #expect(await recorder.actions().isEmpty)
    #expect(analyticsRecorder.recorded().isEmpty)
  }

  @Test
  func performRoutesUpdateActionsThroughClient() async {
    let recorder = UpdateActionRecorder()

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(.perform(.install))
    await store.send(.perform(.cancel))
    await store.send(.perform(.retry))
    await store.send(.perform(.dismiss))

    #expect(await recorder.actions() == [.install, .cancel, .retry, .dismiss])
  }

  @Test
  func taskMirrorsUpdateClientSnapshotsIntoState() async {
    let (stream, continuation) = makeStream()

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    continuation.yield(
      .init(
        automaticallyChecksForUpdates: true,
        automaticallyDownloadsUpdates: true,
        canCheckForUpdates: true,
        phase: .checking
      )
    )

    await store.receive(\.updateClientSnapshotReceived) {
      $0.canCheckForUpdates = true
      $0.phase = .checking
    }

    continuation.finish()
    await store.finish()
  }
}

private actor UpdateActionRecorder {
  private var recordedActions: [UpdateUserAction] = []

  func actions() -> [UpdateUserAction] {
    recordedActions
  }

  func record(_ action: UpdateUserAction) {
    recordedActions.append(action)
  }
}

private func makeStream() -> (
  AsyncStream<UpdateClient.Snapshot>,
  AsyncStream<UpdateClient.Snapshot>.Continuation
) {
  var capturedContinuation: AsyncStream<UpdateClient.Snapshot>.Continuation?
  let stream = AsyncStream<UpdateClient.Snapshot> { continuation in
    capturedContinuation = continuation
  }
  return (stream, capturedContinuation!)
}
