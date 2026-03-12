import ComposableArchitecture
import Testing

@testable import supaterm

@MainActor
struct UpdateFeatureTests {
  @Test
  func checkForUpdatesButtonTappedUsesClient() async {
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
  func laterButtonTappedClosesPopoverAndSendsIntent() async {
    let recorder = IntentRecorder()
    var initialState = UpdateFeature.State()
    initialState.isPopoverPresented = true
    initialState.phase = .updateAvailable(
      .init(contentLength: nil, publishedAt: nil, releaseNotesURL: nil, version: "1.2.3")
    )

    let store = TestStore(initialState: initialState) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.sendIntent = { intent in
        await recorder.record(intent)
      }
    }

    await store.send(.laterButtonTapped) {
      $0.isPopoverPresented = false
      $0.phase = .idle
    }

    #expect(await recorder.intents() == [.later])
  }

  @Test
  func presentationContextChangedForwardsToClient() async {
    let recorder = ContextRecorder()
    let context = UpdatePresentationContext(
      isFloatingSidebarVisible: true,
      isSidebarCollapsed: true
    )

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.setPresentationContext = { context in
        await recorder.record(context)
      }
    }

    await store.send(.presentationContextChanged(context)) {
      $0.presentationContext = context
    }

    #expect(await recorder.contexts() == [context])
  }

  @Test
  func taskMirrorsUpdateClientSnapshotsIntoState() async {
    let (stream, continuation) = makeStream()
    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .checking
    )

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.updateClient.observe = { stream }
      $0.updateClient.start = {}
    }

    await store.send(.task)
    continuation.yield(snapshot)

    await store.receive(\.updateClientSnapshotReceived) {
      $0.canCheckForUpdates = true
      $0.phase = .checking
    }

    continuation.finish()
    await store.finish()
  }

  @Test
  func updateNotFoundAutoDismissesAfterFiveSeconds() async {
    let clock = TestClock()
    let recorder = IntentRecorder()
    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .notFound
    )

    let store = TestStore(initialState: UpdateFeature.State()) {
      UpdateFeature()
    } withDependencies: {
      $0.continuousClock = clock
      $0.updateClient.sendIntent = { intent in
        await recorder.record(intent)
      }
    }

    await store.send(.updateClientSnapshotReceived(snapshot)) {
      $0.canCheckForUpdates = true
      $0.phase = .notFound
    }

    await clock.advance(by: .seconds(5))

    await store.receive(\.updateNotFoundDismissTimerFinished) {
      $0.phase = .idle
    }

    #expect(await recorder.intents() == [.dismiss])
  }

  @Test
  func downloadingSnapshotClosesPopover() async {
    var initialState = UpdateFeature.State()
    initialState.isPopoverPresented = true
    initialState.phase = .checking

    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .downloading(.init(expectedLength: 1_000, receivedLength: 500))
    )

    let store = TestStore(initialState: initialState) {
      UpdateFeature()
    }

    await store.send(.updateClientSnapshotReceived(snapshot)) {
      $0.canCheckForUpdates = true
      $0.isPopoverPresented = false
      $0.phase = .downloading(.init(expectedLength: 1_000, receivedLength: 500))
    }
  }

  @Test
  func extractingSnapshotClosesPopover() async {
    var initialState = UpdateFeature.State()
    initialState.isPopoverPresented = true
    initialState.phase = .checking

    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .extracting(0.5)
    )

    let store = TestStore(initialState: initialState) {
      UpdateFeature()
    }

    await store.send(.updateClientSnapshotReceived(snapshot)) {
      $0.canCheckForUpdates = true
      $0.isPopoverPresented = false
      $0.phase = .extracting(0.5)
    }
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

private actor ContextRecorder {
  private var recordedContexts: [UpdatePresentationContext] = []

  func contexts() -> [UpdatePresentationContext] {
    recordedContexts
  }

  func record(_ context: UpdatePresentationContext) {
    recordedContexts.append(context)
  }
}

private actor IntentRecorder {
  private var recordedIntents: [UpdateClient.UserIntent] = []

  func intents() -> [UpdateClient.UserIntent] {
    recordedIntents
  }

  func record(_ intent: UpdateClient.UserIntent) {
    recordedIntents.append(intent)
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
