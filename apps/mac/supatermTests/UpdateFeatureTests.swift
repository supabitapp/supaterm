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
    await store.send(.perform(.installAfterNextRestart))
    await store.send(.perform(.cancel))
    await store.send(.perform(.retry))
    await store.send(.perform(.dismiss))

    #expect(await recorder.actions() == [.install, .installAfterNextRestart, .cancel, .retry, .dismiss])
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
      UpdateClient.Snapshot(
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

  @Test
  func shutdownCancelsUpdateObservation() async {
    let observationStarted = LockIsolated(false)
    let observationTerminated = LockIsolated(false)
    let stream = AsyncStream<UpdateClient.Snapshot> { continuation in
      continuation.onTermination = { _ in
        observationTerminated.withValue { $0 = true }
      }
    }
    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.observe = {
        observationStarted.withValue { $0 = true }
        return stream
      }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    #expect(await waitUntil { observationStarted.value })

    await store.send(.shutdown)

    #expect(await waitUntil { observationTerminated.value })
    await store.finish()
  }

  @Test
  func notFoundDismissesAfterFiveSeconds() async {
    let clock = TestClock()
    let recorder = UpdateActionRecorder()
    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.continuousClock = clock
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(
      .updateClientSnapshotReceived(
        UpdateClient.Snapshot(
          automaticallyChecksForUpdates: true,
          automaticallyDownloadsUpdates: false,
          canCheckForUpdates: true,
          phase: .notFound
        )
      )
    ) {
      $0.canCheckForUpdates = true
      $0.phase = .notFound
    }

    await clock.advance(by: .seconds(4))
    #expect(await recorder.actions().isEmpty)

    await clock.advance(by: .seconds(1))
    await store.receive(\.notFoundDismissalElapsed)
    #expect(await recorder.actions() == [.dismiss])
  }

  @Test
  func leavingNotFoundCancelsDismissal() async {
    let clock = TestClock()
    let recorder = UpdateActionRecorder()
    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.continuousClock = clock
      $0.updateClient.perform = { action in
        await recorder.record(action)
      }
    }

    await store.send(
      .updateClientSnapshotReceived(
        UpdateClient.Snapshot(
          automaticallyChecksForUpdates: true,
          automaticallyDownloadsUpdates: false,
          canCheckForUpdates: true,
          phase: .notFound
        )
      )
    ) {
      $0.canCheckForUpdates = true
      $0.phase = .notFound
    }
    await store.send(
      .updateClientSnapshotReceived(
        UpdateClient.Snapshot(
          automaticallyChecksForUpdates: true,
          automaticallyDownloadsUpdates: false,
          canCheckForUpdates: true,
          phase: .idle
        )
      )
    ) {
      $0.phase = .idle
    }

    await clock.advance(by: .seconds(5))
    #expect(await recorder.actions().isEmpty)
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
