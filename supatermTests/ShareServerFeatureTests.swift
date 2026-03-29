import ComposableArchitecture
import Testing

@testable import supaterm

private actor IntRecorder {
  private var values: [Int] = []

  func append(_ value: Int) {
    values.append(value)
  }

  func snapshot() -> [Int] {
    values
  }
}

private actor CountRecorder {
  private var count = 0

  func increment() {
    count += 1
  }

  func snapshot() -> Int {
    count
  }
}

@MainActor
struct ShareServerFeatureTests {
  @Test
  func startButtonStartsServerOnValidatedPort() async {
    let startedPorts = IntRecorder()

    let store = TestStore(initialState: ShareServerFeature.State()) {
      ShareServerFeature()
    } withDependencies: {
      $0.shareServerClient.start = { port, _ in
        await startedPorts.append(port)
      }
    }

    await store.send(.startButtonTapped(9000))
    await store.finish()

    #expect(await startedPorts.snapshot() == [9000])
  }

  @Test
  func stopButtonStopsWhenRequested() async {
    let stoppedCount = CountRecorder()
    var initialState = ShareServerFeature.State()
    initialState.snapshot = ShareServerSnapshot(
      phase: .running(
        .init(
          listenAddress: "0.0.0.0",
          port: 7681,
          accessURLs: []
        )
      )
    )

    let store = TestStore(initialState: initialState) {
      ShareServerFeature()
    } withDependencies: {
      $0.shareServerClient.stop = {
        await stoppedCount.increment()
      }
    }

    await store.send(.stopButtonTapped)
    await store.finish()

    #expect(await stoppedCount.snapshot() == 1)
  }

  @Test
  func failedSnapshotStoresFailurePhase() async {
    let store = TestStore(initialState: ShareServerFeature.State()) {
      ShareServerFeature()
    }

    await store.send(.snapshotReceived(.init(phase: .failed(message: "boom")))) {
      $0.snapshot = .init(phase: .failed(message: "boom"))
    }
  }
}
