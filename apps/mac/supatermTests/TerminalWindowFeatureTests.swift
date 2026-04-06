import ComposableArchitecture
import Foundation
import Sharing
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct TerminalWindowFeatureTests {
  @Test
  func taskBootstrapsTerminalAndRoutesClientEvents() async {
    let recorder = TerminalCommandRecorder()
    let surfaceID = UUID()
    let (stream, continuation) = makeEventStream()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
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
  func closeTabRequestedAsksHostToResolveClose() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeTabRequested(tabID))

    #expect(recorder.commands == [.requestCloseTab(tabID)])
  }

  @Test
  func closeTabsBelowRequestedAsksHostToResolveClose() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeTabsBelowRequested(tabID))

    #expect(recorder.commands == [.requestCloseTabsBelow(tabID)])
  }

  @Test
  func closeOtherTabsRequestedAsksHostToResolveClose() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeOtherTabsRequested(tabID))

    #expect(recorder.commands == [.requestCloseOtherTabs(tabID)])
  }

  @Test
  func newTabCaptureRecordsAnalyticsAndSendsCommand() async {
    let analyticsRecorder = AnalyticsEventRecorder()
    let recorder = TerminalCommandRecorder()
    let surfaceID = UUID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.newTabButtonTapped(inheritingFromSurfaceID: surfaceID))

    #expect(analyticsRecorder.recorded() == ["terminal_tab_created"])
    #expect(recorder.commands == [.createTab(inheritingFromSurfaceID: surfaceID)])
  }

  @Test
  func splitOperationCaptureRecordsAnalyticsAndSendsCommand() async {
    let analyticsRecorder = AnalyticsEventRecorder()
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.splitOperationRequested(tabID: tabID, operation: .equalize))

    #expect(analyticsRecorder.recorded() == ["terminal_pane_created"])
    #expect(recorder.commands == [.performSplitOperation(tabID: tabID, operation: .equalize)])
  }

  @Test
  func spaceCreateCaptureRecordsAnalyticsAndSendsCommand() async {
    let analyticsRecorder = AnalyticsEventRecorder()
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        analyticsRecorder.record(event)
      }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.spaceCreateButtonTapped)

    #expect(analyticsRecorder.recorded() == ["space_created"])
    #expect(recorder.commands == [.createSpace])
  }

  @Test
  func closeRequestedPresentsConfirmationWhenNeeded() async {
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(.clientEvent(.closeRequested(.init(target: .tab(tabID), needsConfirmation: true)))) {
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
    var initialState = TerminalWindowFeature.State()
    initialState.pendingCloseRequest = .init(
      target: .tab(tabID),
      title: "Close Tab?",
      message: "A process is still running in this tab. Close it anyway?"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeConfirmationConfirmButtonTapped) {
      $0.pendingCloseRequest = nil
    }

    #expect(recorder.commands == [.closeTab(tabID)])
  }

  @Test
  func closeConfirmationConfirmClosesPendingTabs() async {
    let recorder = TerminalCommandRecorder()
    let firstTabID = TerminalTabID()
    let secondTabID = TerminalTabID()
    var initialState = TerminalWindowFeature.State()
    initialState.pendingCloseRequest = .init(
      target: .tabs([firstTabID, secondTabID]),
      title: "Close Tabs?",
      message: "A process is still running in one or more of these tabs. Close them anyway?"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.closeConfirmationConfirmButtonTapped) {
      $0.pendingCloseRequest = nil
    }

    #expect(recorder.commands == [.closeTabs([firstTabID, secondTabID])])
  }

  @Test
  func closeSurfaceRequestedPresentsConfirmationForLiveProcess() async {
    let surfaceID = UUID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(.clientEvent(.closeRequested(.init(target: .surface(surfaceID), needsConfirmation: true)))) {
      $0.pendingCloseRequest = .init(
        target: .surface(surfaceID),
        title: "Close Pane?",
        message: "A process is still running in this pane. Close it anyway?"
      )
    }
  }

  @Test
  func closeSurfaceRequestedClosesImmediatelyWhenProcessIsNotAlive() async {
    let recorder = TerminalCommandRecorder()
    let surfaceID = UUID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.clientEvent(.closeRequested(.init(target: .surface(surfaceID), needsConfirmation: false))))

    #expect(recorder.commands == [.closeSurface(surfaceID)])
  }

  @Test
  func notificationReceivedDeliversDesktopNotificationWhenRequested() async throws {
    let recorder = TerminalDesktopNotificationRecorder()
    let event = TerminalNotificationEvent(
      attentionState: .unread,
      body: "Build finished",
      desktopNotificationDisposition: .deliver,
      resolvedTitle: "Deploy complete",
      sourceSurfaceID: UUID(),
      subtitle: "CI"
    )

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.systemNotificationsEnabled = true
      }

      let store = TestStore(initialState: TerminalWindowFeature.State()) {
        TerminalWindowFeature()
      } withDependencies: {
        $0.desktopNotificationClient.deliver = { request in
          await recorder.record(request)
        }
      }

      await store.send(.clientEvent(.notificationReceived(event)))

      #expect(
        await recorder.snapshot()
          == [.init(body: "Build finished", subtitle: "CI", title: "Deploy complete")]
      )
    }
  }

  @Test
  func notificationReceivedSkipsDesktopNotificationWhenNotRequested() async throws {
    let recorder = TerminalDesktopNotificationRecorder()
    let event = TerminalNotificationEvent(
      attentionState: .unread,
      body: "Build finished",
      desktopNotificationDisposition: .suppressFocused,
      resolvedTitle: "Deploy complete",
      sourceSurfaceID: UUID(),
      subtitle: ""
    )

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      @Shared(.supatermSettings) var supatermSettings = .default
      $supatermSettings.withLock {
        $0.systemNotificationsEnabled = true
      }

      let store = TestStore(initialState: TerminalWindowFeature.State()) {
        TerminalWindowFeature()
      } withDependencies: {
        $0.desktopNotificationClient.deliver = { request in
          await recorder.record(request)
        }
      }

      await store.send(.clientEvent(.notificationReceived(event)))

      #expect(await recorder.snapshot().isEmpty)
    }
  }

  @Test
  func notificationReceivedSkipsDesktopNotificationWhenDisabledInPrefs() async throws {
    let recorder = TerminalDesktopNotificationRecorder()
    let event = TerminalNotificationEvent(
      attentionState: .unread,
      body: "Build finished",
      desktopNotificationDisposition: .deliver,
      resolvedTitle: "Deploy complete",
      sourceSurfaceID: UUID(),
      subtitle: "CI"
    )

    await withDependencies {
      $0.defaultFileStorage = .inMemory
    } operation: {
      let store = TestStore(initialState: TerminalWindowFeature.State()) {
        TerminalWindowFeature()
      } withDependencies: {
        $0.desktopNotificationClient.deliver = { request in
          await recorder.record(request)
        }
      }

      await store.send(.clientEvent(.notificationReceived(event)))

      #expect(await recorder.snapshot().isEmpty)
    }
  }

  @Test
  func bindingMenuItemSelectedSplitRightSendsFocusedSurfaceBindingCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.bindingMenuItemSelected(.newSplit(.right)))

    #expect(recorder.commands == [.performBindingActionOnFocusedSurface(.newSplit(.right))])
  }

  @Test
  func bindingMenuItemSelectedSplitDownSendsFocusedSurfaceBindingCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.bindingMenuItemSelected(.newSplit(.down)))

    #expect(recorder.commands == [.performBindingActionOnFocusedSurface(.newSplit(.down))])
  }

  @Test
  func bindingMenuItemSelectedEqualizeSendsFocusedSurfaceBindingCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.bindingMenuItemSelected(.equalizeSplits))

    #expect(recorder.commands == [.performBindingActionOnFocusedSurface(.equalizeSplits)])
  }

  @Test
  func bindingMenuItemSelectedToggleSplitZoomSendsFocusedSurfaceBindingCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.bindingMenuItemSelected(.toggleSplitZoom))

    #expect(recorder.commands == [.performBindingActionOnFocusedSurface(.toggleSplitZoom)])
  }

  @Test
  func commandPaletteTogglePresentsPalette() async {
    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(.commandPaletteToggleRequested) {
      $0.commandPalette = .init()
    }
  }

  @Test
  func commandPaletteToggleDismissesPalette() async {
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init()

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.commandPaletteToggleRequested) {
      $0.commandPalette = nil
    }
  }

  @Test
  func commandPaletteQueryChangedUpdatesDraftAndResetsSelection() async {
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(query: "", selectedIndex: 3)

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.commandPaletteQueryChanged("split")) {
      $0.commandPalette?.query = "split"
      $0.commandPalette?.selectedIndex = 0
    }
  }

  @Test
  func commandPaletteSelectionMovedClampsToAvailableRows() async {
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(query: "", selectedIndex: 0)

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.commandPaletteSelectionMoved(2)) {
      $0.commandPalette?.selectedIndex = 2
    }
    await store.send(.commandPaletteSelectionMoved(99)) {
      $0.commandPalette?.selectedIndex = TerminalCommandPaletteRow.samples.count - 1
    }
    await store.send(.commandPaletteSelectionMoved(-99)) {
      $0.commandPalette?.selectedIndex = 0
    }
  }

  @Test
  func commandPaletteActivateSelectionClosesPalette() async {
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init()

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }
  }

  @Test
  func toggleSidebarButtonTappedTogglesCollapsedStateAndHidesFloatingSidebar() async {
    var initialState = TerminalWindowFeature.State()
    initialState.isFloatingSidebarVisible = true

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.toggleSidebarButtonTapped) {
      $0.isFloatingSidebarVisible = false
      $0.isSidebarCollapsed = true
    }
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
  func spaceCreateButtonTappedSendsCreateSpaceCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.spaceCreateButtonTapped)

    #expect(recorder.commands == [.createSpace])
  }

  @Test
  func nextSpaceRequestedSendsNextSpaceCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.nextSpaceRequested)

    #expect(recorder.commands == [.nextSpace])
  }

  @Test
  func previousSpaceRequestedSendsPreviousSpaceCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.previousSpaceRequested)

    #expect(recorder.commands == [.previousSpace])
  }

  @Test
  func sidebarTabSplitRequestedCreatesRightPaneInContextSurface() async {
    let surfaceID = UUID()
    let spaceID = UUID()
    let tabID = UUID()
    let paneID = UUID()
    var requests: [TerminalCreatePaneRequest] = []

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.createPane = { request in
        requests.append(request)
        return .init(
          direction: request.direction,
          isFocused: false,
          isSelectedTab: true,
          windowIndex: 1,
          spaceIndex: 1,
          spaceID: spaceID,
          tabIndex: 1,
          tabID: tabID,
          paneIndex: 2,
          paneID: paneID
        )
      }
    }

    await store.send(
      TerminalWindowFeature.Action.sidebarTabSplitRequested(
        surfaceID: surfaceID,
        direction: SupatermPaneDirection.right
      )
    )

    #expect(requests.count == 1)
    #expect(
      requests.first
        == .init(
          command: nil,
          direction: SupatermPaneDirection.right,
          focus: false,
          equalize: false,
          target: .contextPane(surfaceID)
        )
    )
  }

  @Test
  func sidebarTabSplitRequestedCreatesDownPaneInContextSurface() async {
    let surfaceID = UUID()
    let spaceID = UUID()
    let tabID = UUID()
    let paneID = UUID()
    var requests: [TerminalCreatePaneRequest] = []

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.createPane = { request in
        requests.append(request)
        return .init(
          direction: request.direction,
          isFocused: false,
          isSelectedTab: true,
          windowIndex: 1,
          spaceIndex: 1,
          spaceID: spaceID,
          tabIndex: 1,
          tabID: tabID,
          paneIndex: 2,
          paneID: paneID
        )
      }
    }

    await store.send(
      TerminalWindowFeature.Action.sidebarTabSplitRequested(
        surfaceID: surfaceID,
        direction: SupatermPaneDirection.down
      )
    )

    #expect(requests.count == 1)
    #expect(
      requests.first
        == .init(
          command: nil,
          direction: SupatermPaneDirection.down,
          focus: false,
          equalize: false,
          target: .contextPane(surfaceID)
        )
    )
  }

  @Test
  func sidebarTabMoveCommittedSendsAtomicMoveCommand() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()
    let pinnedID = TerminalTabID()
    let regularID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(
      .sidebarTabMoveCommitted(
        tabID: tabID,
        pinnedOrder: [tabID, pinnedID],
        regularOrder: [regularID]
      )
    )

    let expected = TerminalClient.Command.moveSidebarTab(
      tabID: tabID,
      pinnedOrder: [tabID, pinnedID],
      regularOrder: [regularID]
    )

    #expect(recorder.commands == [expected])
  }

  @Test
  func spaceRenameFlowStoresDraftAndSendsRenameCommand() async {
    let recorder = TerminalCommandRecorder()
    let space = TerminalSpaceItem(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!),
      name: "A"
    )

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.spaceRenameRequested(space)) {
      $0.spaceRename = .init(space: space, draftName: "A")
    }
    await store.send(.spaceRenameTextChanged("Shell")) {
      $0.spaceRename?.draftName = "Shell"
    }
    await store.send(.spaceRenameSaveButtonTapped) {
      $0.spaceRename = nil
    }

    #expect(recorder.commands == [.renameSpace(space.id, "Shell")])
  }

  @Test
  func spaceDeleteFlowStoresRequestAndSendsDeleteCommand() async {
    let recorder = TerminalCommandRecorder()
    let space = TerminalSpaceItem(
      id: TerminalSpaceID(rawValue: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!),
      name: "B"
    )

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.spaceDeleteRequested(space)) {
      $0.pendingSpaceDeleteRequest = .init(space: space)
    }
    await store.send(.spaceDeleteConfirmButtonTapped) {
      $0.pendingSpaceDeleteRequest = nil
    }

    #expect(recorder.commands == [.deleteSpace(space.id)])
  }

  @Test
  func windowCloseRequestedPresentsStyledConfirmation() async {
    let windowID = ObjectIdentifier(NSObject())
    var initialState = TerminalWindowFeature.State()
    initialState.windowID = windowID

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    }

    await store.send(.windowCloseRequested(windowID: windowID)) {
      $0.confirmationRequest = .init(
        target: .closeWindow(windowID),
        title: "Close Window?",
        message: "A process is still running in this window. Close it anyway?",
        confirmTitle: "Close"
      )
    }
  }

  @Test
  func closeAllWindowsConfirmationClosesProvidedWindowIDs() async {
    let firstWindowID = ObjectIdentifier(NSObject())
    let secondWindowID = ObjectIdentifier(NSObject())
    var closedWindowIDs: [[ObjectIdentifier]] = []
    var initialState = TerminalWindowFeature.State()
    initialState.confirmationRequest = .init(
      target: .closeAllWindows([firstWindowID, secondWindowID]),
      title: "Close All Windows?",
      message: "All terminal sessions will be terminated.",
      confirmTitle: "Close All Windows"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalWindowsClient.closeWindows = { windowIDs in
        closedWindowIDs.append(windowIDs)
      }
    }

    await store.send(.confirmationConfirmButtonTapped) {
      $0.confirmationRequest = nil
    }

    #expect(closedWindowIDs == [[firstWindowID, secondWindowID]])
  }

  @Test
  func selectSpaceMenuItemSelectedSendsSelectSpaceSlotCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.selectSpaceMenuItemSelected(4))

    #expect(recorder.commands == [.selectSpaceSlot(4)])
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

private actor TerminalDesktopNotificationRecorder {
  private var requests: [DesktopNotificationRequest] = []

  func record(_ request: DesktopNotificationRequest) {
    requests.append(request)
  }

  func snapshot() -> [DesktopNotificationRequest] {
    requests
  }
}
