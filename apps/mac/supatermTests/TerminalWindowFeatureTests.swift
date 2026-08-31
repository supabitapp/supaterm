import ComposableArchitecture
import Foundation
import Sharing
import SupaTheme
import SupatermSupport
import SupatermUpdateFeature
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalWindowFeatureTests {
  @Test
  func desktopNotificationRequestEncodesSourceSurfaceIDInUserInfo() {
    let surfaceID = UUID()
    let request = DesktopNotificationRequest(
      body: "Build finished",
      subtitle: "CI",
      title: "Deploy complete",
      sourceSurfaceID: surfaceID
    )

    #expect(DesktopNotificationRequest.sourceSurfaceID(from: request.userInfo) == surfaceID)
    #expect(DesktopNotificationRequest.sourceSurfaceID(from: [:]) == nil)
  }

  @Test
  func taskRoutesClientEventsToTheWindowHost() async {
    let (events, continuation) = makeEventStream()
    initializeGhosttyForTests()
    let host = TerminalHostState.test(runtime: GhosttyRuntime())
    defer { Array(host.surfaces.values).forEach { $0.closeSurface() } }
    let analyticsRecorder = AnalyticsEventRecorder()
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { analyticsRecorder.record($0) }
      $0.terminalClient.events = { events }
      $0.terminalClient.host = { host }
    }

    await store.send(.task)
    continuation.yield(.newTabRequested(inheritingFromSurfaceID: nil))
    await store.receive(\.clientEvent)

    #expect(host.tabs.count == 1)
    #expect(analyticsRecorder.recorded() == ["terminal_tab_created"])

    continuation.finish()
    await store.finish()
  }

  @Test
  func agentPanelVisibilityToggleScopesToSurface() async {
    let firstSurfaceID = UUID()
    let secondSurfaceID = UUID()
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(.agentPanelVisibilityToggled(firstSurfaceID)) {
      $0.hiddenAgentPanelSurfaceIDs = [firstSurfaceID]
    }
    await store.send(.agentPanelVisibilityToggled(secondSurfaceID)) {
      $0.hiddenAgentPanelSurfaceIDs = [firstSurfaceID, secondSurfaceID]
    }
    await store.send(.agentPanelVisibilityToggled(firstSurfaceID)) {
      $0.hiddenAgentPanelSurfaceIDs = [secondSurfaceID]
    }
  }

  @Test
  func spaceCreateButtonTappedOpensEditor() async {
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.withRandomNumberGenerator = WithRandomNumberGenerator(CountingRandomNumberGenerator())
    }

    await store.send(.spaceCreateButtonTapped) {
      $0.destination = .spaceEditor(
        TerminalSpaceEditorState(
          mode: .create,
          draftName: "",
          draftColor: .red
        )
      )
    }
  }

  @Test
  func destinationAllowsOnePresentationFlow() async {
    let tabID = TerminalTabID()
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.withRandomNumberGenerator = WithRandomNumberGenerator(CountingRandomNumberGenerator())
    }

    await store.send(.spaceCreateButtonTapped) {
      $0.destination = .spaceEditor(
        TerminalSpaceEditorState(mode: .create, draftName: "", draftColor: .red)
      )
    }
    await store.send(.commandPaletteToggleRequested)
    await store.send(
      .clientEvent(
        .closeRequested(
          TerminalCloseRequest(target: .tab(tabID), needsConfirmation: true)
        )
      )
    ) {
      $0.destination = .closeConfirmation(
        TerminalWindowFeature.PendingCloseRequest(
          target: .tab(tabID),
          title: "Close Tab?",
          message: TerminalWindowFeature.closeTabWarningMessage
        )
      )
    }
  }

  @Test
  func closeConfirmationClosesPendingTab() async throws {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabCollection = host.spaceManager.tabCollection
    let tabID = tabCollection.createTab(title: "Close")
    _ = tabCollection.createTab(title: "Keep")
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .closeConfirmation(
      TerminalWindowFeature.PendingCloseRequest(
        target: .tab(tabID),
        title: "Close Tab?",
        message: TerminalWindowFeature.closeTabWarningMessage
      )
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { host }
    }

    await store.send(.closeConfirmationConfirmButtonTapped) {
      $0.destination = nil
    }

    #expect(!host.tabs.contains { $0.id == tabID })
  }

  @Test
  func closeConfirmationCancelKeepsPendingTab() async {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let tabID = host.spaceManager.tabCollection.createTab(title: "Keep")
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .closeConfirmation(
      TerminalWindowFeature.PendingCloseRequest(
        target: .tab(tabID),
        title: "Close Tab?",
        message: TerminalWindowFeature.closeTabWarningMessage
      )
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.closeConfirmationCancelButtonTapped) {
      $0.destination = nil
    }

    #expect(host.tabs.contains { $0.id == tabID })
  }

  @Test
  func windowCloseRequestClosesImmediatelyWithoutConfirmation() async {
    let window = NSString()
    let windowID = ObjectIdentifier(window)
    var closedWindowIDs: [ObjectIdentifier] = []
    let store = TestStore(
      initialState: TerminalWindowFeature.State(windowID: windowID)
    ) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.windowCloseClient.closeWindow = { closedWindowIDs.append($0) }
    }

    await store.send(.clientEvent(.windowCloseRequested(needsConfirmation: false)))

    #expect(closedWindowIDs == [windowID])
  }

  @Test
  func notificationReceivedDeliversDesktopNotification() async throws {
    let recorder = TerminalDesktopNotificationRecorder()
    let sourceSurfaceID = UUID()
    let event = TerminalNotificationEvent(
      attentionState: .unread,
      body: "Build finished",
      desktopNotificationDisposition: .deliver,
      resolvedTitle: "Deploy complete",
      sourceSurfaceID: sourceSurfaceID,
      subtitle: "CI"
    )

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock { $0.systemNotificationsEnabled = true }
      let store = TestStore(initialState: TerminalWindowFeature.State()) {
        TerminalWindowFeature()
      } withDependencies: {
        $0.desktopNotificationClient.deliver = { await recorder.record($0) }
      }

      await store.send(.clientEvent(.notificationReceived(event)))

      #expect(
        await recorder.snapshot()
          == [
            DesktopNotificationRequest(
              body: "Build finished",
              subtitle: "CI",
              title: "Deploy complete",
              sourceSurfaceID: sourceSurfaceID
            )
          ]
      )
    }
  }

  @Test
  func commandPaletteTogglePresentsAndDismissesPalette() async {
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.commandPaletteToggleRequested) {
      $0.destination = .commandPalette(
        TerminalCommandPaletteState(selectedRowID: rows.first?.id)
      )
    }
    await store.send(.commandPaletteToggleRequested) {
      $0.destination = nil
    }
  }

  @Test
  func commandPaletteQueryChangedResetsSelection() async {
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let matches = TerminalCommandPalettePresentation.matches(in: rows, query: "switch")
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .commandPalette(
      TerminalCommandPaletteState(selectedRowID: rows[1].id)
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.commandPaletteQueryChanged("switch")) {
      $0.destination = .commandPalette(
        TerminalCommandPaletteState(query: "switch", selectedRowID: matches.first?.id)
      )
    }
  }

  @Test
  func commandPaletteFocusesPaneThroughPaletteClient() async throws {
    let recorder = CommandPaletteClientRecorder()
    let snapshot = makeCommandPaletteSnapshot()
    let focusRow = try #require(
      TerminalCommandPalettePresentation.rows(from: snapshot).first {
        if case .focusPane = $0.command { return true }
        return false
      }
    )
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .commandPalette(
      TerminalCommandPaletteState(selectedRowID: focusRow.id)
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalCommandPaletteClient.focusPane = { recorder.focusTargets.append($0) }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.destination = nil
    }

    #expect(recorder.focusTargets == [snapshot.focusTargets[0]])
  }

  @Test
  func commandPaletteRoutesClearScreenThroughTerminalHost() async {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    let snapshot = makeCommandPaletteSnapshot()
    var hostRequestCount = 0
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .commandPalette(
      TerminalCommandPaletteState(selectedRowID: "terminal:clear-screen")
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalClient.host = {
        hostRequestCount += 1
        return host
      }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.destination = nil
    }

    #expect(hostRequestCount == 1)
  }

  @Test
  func commandPaletteTogglesSidebarAndRequestsSessionSave() async {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let sessionChangeCount = LockIsolated(0)
    terminal.onSessionChange = {
      sessionChangeCount.withValue { $0 += 1 }
    }
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .commandPalette(
      TerminalCommandPaletteState(selectedRowID: "supaterm:toggle-sidebar")
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in makeCommandPaletteSnapshot() }
      $0.terminalClient.host = { terminal }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.destination = nil
      $0.isSidebarCollapsed = true
    }
    await store.finish()
    #expect(sessionChangeCount.value == 1)
  }

  @Test
  func toggleSidebarClearsResizeStateAndRequestsSessionSave() async {
    let terminal = TerminalHostState.test(managesTerminalSurfaces: false)
    let sessionChangeCount = LockIsolated(0)
    terminal.onSessionChange = {
      sessionChangeCount.withValue { $0 += 1 }
    }
    var initialState = TerminalWindowFeature.State()
    initialState.sidebarResizeState = TerminalSidebarResizeState(startingWidth: 240, delta: 40)
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { terminal }
    }

    await store.send(.toggleSidebarButtonTapped) {
      $0.isSidebarCollapsed = true
      $0.sidebarResizeState = nil
    }
    await store.finish()
    #expect(sessionChangeCount.value == 1)
  }

  @Test
  func windowIdentifierChangedStoresWindowID() async {
    let windowID = ObjectIdentifier(NSObject())
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(.windowIdentifierChanged(windowID)) {
      $0.windowID = windowID
    }
  }

  @Test
  func spaceCreateFlowPerformsHostAction() async {
    let analyticsRecorder = AnalyticsEventRecorder()
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    var actions: [TerminalHostState.SpaceAction] = []
    host.onSpaceAction = { actions.append($0) }
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { analyticsRecorder.record($0) }
      $0.terminalClient.host = { host }
      $0.withRandomNumberGenerator = WithRandomNumberGenerator(CountingRandomNumberGenerator())
    }

    await store.send(.spaceCreateButtonTapped) {
      $0.destination = .spaceEditor(
        TerminalSpaceEditorState(mode: .create, draftName: "", draftColor: .red)
      )
    }
    await store.send(.spaceEditorTextChanged("Build")) {
      $0.destination = .spaceEditor(
        TerminalSpaceEditorState(mode: .create, draftName: "Build", draftColor: .red)
      )
    }
    await store.send(.spaceEditorColorSelected(.green)) {
      $0.destination = .spaceEditor(
        TerminalSpaceEditorState(mode: .create, draftName: "Build", draftColor: .green)
      )
    }
    await store.send(.spaceEditorSaveButtonTapped) {
      $0.destination = nil
    }

    #expect(actions == [.create("Build", .green)])
    #expect(analyticsRecorder.recorded() == ["space_created"])
  }

  @Test
  func spaceRenameAppliesNameBeforeColor() async {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    var actions: [TerminalHostState.SpaceAction] = []
    host.onSpaceAction = { actions.append($0) }
    let space = TerminalSpaceItem(name: "Before", color: .neutral)
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .spaceEditor(
      TerminalSpaceEditorState(mode: .rename(space), draftName: "After", draftColor: .blue)
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { host }
    }

    await store.send(.spaceEditorSaveButtonTapped) {
      $0.destination = nil
    }

    #expect(actions == [.rename(space.id, "After"), .setColor(space.id, .blue)])
  }

  @Test
  func spaceDeleteFlowPerformsHostAction() async {
    let host = TerminalHostState.test(managesTerminalSurfaces: false)
    var actions: [TerminalHostState.SpaceAction] = []
    host.onSpaceAction = { actions.append($0) }
    let space = TerminalSpaceItem(name: "Delete")
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.host = { host }
    }

    await store.send(.spaceDeleteRequested(space)) {
      $0.destination = .spaceDeleteConfirmation(TerminalSpaceDeleteRequest(space: space))
    }
    await store.send(.spaceDeleteConfirmButtonTapped) {
      $0.destination = nil
    }

    #expect(actions == [.delete(space.id)])
  }

  @Test
  func closeAllWindowsConfirmationClosesProvidedWindows() async {
    let firstWindowID = ObjectIdentifier(NSObject())
    let secondWindowID = ObjectIdentifier(NSObject())
    var closedWindowIDs: [[ObjectIdentifier]] = []
    var initialState = TerminalWindowFeature.State()
    initialState.destination = .windowCloseConfirmation(
      TerminalWindowFeature.WindowCloseConfirmation(
        target: .closeAllWindows([firstWindowID, secondWindowID]),
        title: "Close All Windows?",
        message: TerminalWindowFeature.closeAllWindowsWarningMessage,
        confirmTitle: "Close All Windows"
      )
    )
    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.windowCloseClient.closeWindows = { closedWindowIDs.append($0) }
    }

    await store.send(.confirmationConfirmButtonTapped) {
      $0.destination = nil
    }

    #expect(closedWindowIDs == [[firstWindowID, secondWindowID]])
  }
}

private func makeEventStream() -> (
  AsyncStream<TerminalClient.Event>,
  AsyncStream<TerminalClient.Event>.Continuation
) {
  AsyncStream.makeStream(of: TerminalClient.Event.self)
}

private func makeCommandPaletteSnapshot() -> TerminalCommandPaletteSnapshot {
  let selectedSpaceID = TerminalSpaceID()
  let otherSpaceID = TerminalSpaceID()
  let selectedTabID = TerminalTabID()
  let otherTabID = TerminalTabID()
  let focusTarget = TerminalCommandPaletteFocusTarget(
    windowControllerID: UUID(),
    surfaceID: UUID(),
    title: "ping 1.1.1.1",
    subtitle: "~/Projects/network"
  )

  return TerminalCommandPaletteSnapshot(
    availableAppActions: [.openSettings],
    ghosttyShortcutDisplayByAction: ["new_split:right": "⌘D"],
    updateEntries: [
      TerminalCommandPaletteUpdateEntry(
        id: "update-available:install",
        title: "Install and Relaunch",
        subtitle: "Update Available",
        description: "Supaterm 1.2.3 is ready to download and install.",
        leadingIcon: "shippingbox.fill",
        badge: "1.2.3",
        emphasis: true,
        action: .install
      )
    ],
    focusTargets: [focusTarget],
    selectedSurfaceID: UUID(),
    selectedTabPaneCount: 2,
    selectedPaneIsZoomed: false,
    selectedSpaceID: selectedSpaceID,
    spaces: [
      TerminalSpaceItem(id: selectedSpaceID, name: "Workspace Alpha"),
      TerminalSpaceItem(id: otherSpaceID, name: "Workspace Beta"),
    ],
    selectedTabID: selectedTabID,
    rootItems: [
      .tab(
        TerminalUngroupedTabItem(
          tab: TerminalTabItem(id: selectedTabID, title: "Main"),
          isPinned: false
        )
      ),
      .tab(
        TerminalUngroupedTabItem(
          tab: TerminalTabItem(id: otherTabID, title: "Logs"),
          isPinned: false
        )
      ),
    ]
  )
}

@MainActor
private final class CommandPaletteClientRecorder {
  var focusTargets: [TerminalCommandPaletteFocusTarget] = []
}

private actor TerminalDesktopNotificationRecorder {
  private var requests: [DesktopNotificationRequest] = []

  func record(_ request: DesktopNotificationRequest) {
    requests.append(request)
  }

  func snapshot() -> [DesktopNotificationRequest] {
    requests
  }
}

private nonisolated struct CountingRandomNumberGenerator: RandomNumberGenerator {
  var state: UInt64 = 0

  mutating func next() -> UInt64 {
    state &+= 1
    return state
  }
}
