import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
private final class BoolRecorder {
  private var values: [Bool] = []

  func append(_ value: Bool) {
    values.append(value)
  }

  func snapshot() -> [Bool] {
    values
  }
}

@MainActor
private final class CountRecorder {
  private var count = 0

  func increment() {
    count += 1
  }

  func snapshot() -> Int {
    count
  }
}

@MainActor
struct AppFeatureTests {
  @Test
  func initialStateStartsIdle() {
    let state = AppFeature.State()

    #expect(state.share.snapshot.phase == .stopped)
    #expect(state.update.canCheckForUpdates == false)
    #expect(state.update.phase == .idle)
  }

  @Test
  func updateActionsRouteToChildFeature() async {
    let snapshot = UpdateClient.Snapshot(
      canCheckForUpdates: true,
      phase: .checking
    )

    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    await store.send(.update(.updateClientSnapshotReceived(snapshot))) {
      $0.update.canCheckForUpdates = true
      $0.update.phase = .checking
    }
  }

  @Test
  func quitRequestedRoutesToTerminalSceneWhenUpdateDoesNotBypassConfirmation() async {
    let window = NSObject()
    let windowID = ObjectIdentifier(window)

    let store = TestStore(initialState: AppFeature.State()) {
      AppFeature()
    }

    await store.send(.quitRequested(windowID))
    await store.receive(\.terminal) {
      $0.terminal.isQuitConfirmationPresented = true
    }
  }

  @Test
  func quitRequestedBypassesTerminalSceneWhenUpdateIsInstalling() async {
    let windowID = ObjectIdentifier(NSObject())
    let shareServerStopCount = CountRecorder()
    let terminationReplies = BoolRecorder()
    let terminationPreparations = BoolRecorder()
    var initialState = AppFeature.State()
    initialState.update.phase = .installing(.init(canInstallNow: true))

    let store = TestStore(initialState: initialState) {
      AppFeature()
    } withDependencies: {
      $0.appTerminationClient.reply = { shouldTerminate in
        terminationReplies.append(shouldTerminate)
      }
      $0.shareServerClient.stop = {
        await shareServerStopCount.increment()
      }
      $0.terminalWindowsClient.prepareForTermination = { killSessions in
        terminationPreparations.append(killSessions)
      }
    }

    await store.send(AppFeature.Action.quitRequested(windowID))
    await store.finish()

    #expect(shareServerStopCount.snapshot() == 1)
    #expect(terminationReplies.snapshot() == [true])
    #expect(terminationPreparations.snapshot() == [true])
  }

  @Test
  func quitConfirmationConfirmPreparesTerminationBeforeReplyingTrue() async {
    let shareServerStopCount = CountRecorder()
    let terminationReplies = BoolRecorder()
    let terminationPreparations = BoolRecorder()
    var initialState = AppFeature.State()
    initialState.terminal.isQuitConfirmationPresented = true

    let store = TestStore(initialState: initialState) {
      AppFeature()
    } withDependencies: {
      $0.appTerminationClient.reply = { shouldTerminate in
        terminationReplies.append(shouldTerminate)
      }
      $0.shareServerClient.stop = {
        await shareServerStopCount.increment()
      }
      $0.terminalWindowsClient.prepareForTermination = { killSessions in
        terminationPreparations.append(killSessions)
      }
    }

    await store.send(
      AppFeature.Action.terminal(TerminalSceneFeature.Action.quitConfirmationConfirmButtonTapped)
    ) {
      $0.terminal.isQuitConfirmationPresented = false
    }
    await store.finish()

    #expect(shareServerStopCount.snapshot() == 1)
    #expect(terminationPreparations.snapshot() == [true])
    #expect(terminationReplies.snapshot() == [true])
  }
}
