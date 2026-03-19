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

  @Test
  func workspaceCreateButtonTappedSendsCreateWorkspaceCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.workspaceCreateButtonTapped)

    #expect(recorder.commands == [.createWorkspace])
  }

  @Test
  func workspaceRenameFlowStoresDraftAndSendsRenameCommand() async {
    let recorder = TerminalCommandRecorder()
    let workspace = TerminalWorkspaceItem(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!),
      name: "A"
    )

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.workspaceRenameRequested(workspace)) {
      $0.workspaceRename = .init(workspace: workspace, draftName: "A")
    }
    await store.send(.workspaceRenameTextChanged("Shell")) {
      $0.workspaceRename?.draftName = "Shell"
    }
    await store.send(.workspaceRenameSaveButtonTapped) {
      $0.workspaceRename = nil
    }

    #expect(recorder.commands == [.renameWorkspace(workspace.id, "Shell")])
  }

  @Test
  func workspaceDeleteFlowStoresRequestAndSendsDeleteCommand() async {
    let recorder = TerminalCommandRecorder()
    let workspace = TerminalWorkspaceItem(
      id: TerminalWorkspaceID(rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!),
      name: "B"
    )

    let store = TestStore(initialState: TerminalSceneFeature.State()) {
      TerminalSceneFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.workspaceDeleteRequested(workspace)) {
      $0.pendingWorkspaceDeleteRequest = .init(workspace: workspace)
    }
    await store.send(.workspaceDeleteConfirmButtonTapped) {
      $0.pendingWorkspaceDeleteRequest = nil
    }

    #expect(recorder.commands == [.deleteWorkspace(workspace.id)])
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
