import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct AppFeatureTests {
  @Test
  func initialStateStartsIdle() {
    let state = AppFeature.State()

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
    var terminationReplies: [Bool] = []
    var initialState = AppFeature.State()
    initialState.update.phase = .installing(.init(canInstallNow: true))

    let store = TestStore(initialState: initialState) {
      AppFeature()
    } withDependencies: {
      $0.appTerminationClient.reply = { shouldTerminate in
        terminationReplies.append(shouldTerminate)
      }
    }

    await store.send(AppFeature.Action.quitRequested(windowID))
    await store.finish()

    #expect(terminationReplies == [true])
  }
}
