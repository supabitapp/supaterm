import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct UpdateFeatureTests {
  @Test
  func checkForUpdatesButtonTappedUsesClientWhenEnabled() async {
    let recorder = CheckRecorder()
    var initialState = UpdateFeature.State()
    initialState.canCheckForUpdates = true

    let store = TestStore(initialState: initialState) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.checkForUpdates = {
        await recorder.markChecked()
      }
    }

    await store.send(.checkForUpdatesButtonTapped)
    #expect(await recorder.wasChecked())
  }

  @Test
  func checkForUpdatesButtonTappedDoesNothingWhenDisabled() async {
    let recorder = CheckRecorder()

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.checkForUpdates = {
        await recorder.markChecked()
      }
    }

    await store.send(.checkForUpdatesButtonTapped)
    #expect(!(await recorder.wasChecked()))
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
    continuation.yield(.init(canCheckForUpdates: true))

    await store.receive(\.updateClientSnapshotReceived) {
      $0.canCheckForUpdates = true
    }

    continuation.finish()
    await store.finish()
  }
}

private actor CheckRecorder {
  private var checked = false

  func markChecked() {
    checked = true
  }

  func wasChecked() -> Bool {
    checked
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
