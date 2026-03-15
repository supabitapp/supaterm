import ComposableArchitecture
import Foundation
import Testing

@testable import supaterm

@MainActor
struct TerminalSceneFeatureTests {
  @Test
  func taskBootstrapsTerminalAndRoutesClientEvents() async {
    let recorder = TerminalCommandRecorder()
    let surfaceID = UUID()
    let (stream, continuation) = makeEventStream()

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.events = { stream }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.task)
    #expect(recorder.commands == [.ensureInitialTab(focusing: false)])

    continuation.yield(.newTabRequested(inheritingFromSurfaceID: surfaceID))

    await store.receive(\.clientEvent)
    await store.receive(\.newTabButtonTapped)

    #expect(
      recorder.commands == [
        .ensureInitialTab(focusing: false),
        .createTab(inheritingFromSurfaceID: surfaceID),
      ])

    continuation.finish()
    await store.finish()
  }

  @Test
  func closeTabRequestedPresentsConfirmationWhenNeeded() async {
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.tabNeedsCloseConfirmation = { $0 == tabID }
    }

    await store.send(.closeTabRequested(tabID)) {
      $0.pendingCloseRequest = .init(
        target: .tab(tabID),
        title: "Close Tab?",
        message: "A process is still running in this tab. Close it anyway?"
      )
    }
  }

  @Test
  func closeConfirmationConfirmClosesPendingTab() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()
    var initialState = TerminalSceneFeature.State()
    initialState.pendingCloseRequest = .init(
      target: .tab(tabID),
      title: "Close Tab?",
      message: "A process is still running in this tab. Close it anyway?"
    )

    let store = TestStore(initialState: initialState) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeConfirmationConfirmButtonTapped) {
      $0.pendingCloseRequest = nil
    }

    #expect(recorder.commands == [.closeTab(tabID)])
  }

  @Test
  func closeSurfaceRequestedPresentsConfirmationForLiveProcess() async {
    let surfaceID = UUID()

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    }

    await store.send(.clientEvent(.closeSurfaceRequested(surfaceID: surfaceID, processAlive: true))) {
      $0.pendingCloseRequest = .init(
        target: .pane(surfaceID),
        title: "Close Pane?",
        message: "A process is still running in this pane. Close it anyway?"
      )
    }
  }

  @Test
  func closeSurfaceRequestedClosesImmediatelyWhenProcessIsNotAlive() async {
    let recorder = TerminalCommandRecorder()
    let surfaceID = UUID()

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.clientEvent(.closeSurfaceRequested(surfaceID: surfaceID, processAlive: false)))

    #expect(recorder.commands == [.closeSurface(surfaceID)])
  }

  @Test
  func toggleSidebarButtonTappedTogglesCollapsedStateAndHidesFloatingSidebar() async {
    var initialState = TerminalSceneFeature.State()
    initialState.isFloatingSidebarVisible = true

    let store = TestStore(initialState: initialState) {
      TerminalSceneFeature()
    }

    await store.send(.toggleSidebarButtonTapped) {
      $0.isFloatingSidebarVisible = false
      $0.isSidebarCollapsed = true
    }
  }
}

@MainActor
private final class TerminalCommandRecorder {
  var commands: [TerminalClient.Command] = []

  func record(_ command: TerminalClient.Command) {
    commands.append(command)
  }
}

private func makeEventStream() -> (
  AsyncStream<TerminalClient.Event>,
  AsyncStream<TerminalClient.Event>.Continuation
) {
  var capturedContinuation: AsyncStream<TerminalClient.Event>.Continuation?
  let stream = AsyncStream<TerminalClient.Event> { continuation in
    capturedContinuation = continuation
  }
  return (stream, capturedContinuation!)
}
