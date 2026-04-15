import ComposableArchitecture
import Foundation
import Sharing
import SupatermSupport
import SupatermTerminalCore
import SupatermUpdateFeature
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
    #expect(recorder.commands == [.ensureInitialTab(focusing: false, startupInput: nil)])

    continuation.yield(.newTabRequested(inheritingFromSurfaceID: surfaceID))

    await store.receive(\.clientEvent)
    await store.receive(\.newTabButtonTapped)

    #expect(
      recorder.commands == [
        .ensureInitialTab(focusing: false, startupInput: nil),
        .createTab(inheritingFromSurfaceID: surfaceID),
      ])

    continuation.finish()
    await store.finish()
  }

  @Test
  func taskConsumesInitialStartupInputOnce() async {
    let recorder = TerminalCommandRecorder()
    let store = TestStore(
      initialState: TerminalWindowFeature.State(
        startupInput: "sp onboard\n"
      )
    ) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.task) {
      $0.startupInput = nil
    }

    #expect(
      recorder.commands == [
        .ensureInitialTab(
          focusing: false,
          startupInput: "sp onboard\n",
        )
      ]
    )

    await store.send(.task)

    #expect(
      recorder.commands == [
        .ensureInitialTab(
          focusing: false,
          startupInput: "sp onboard\n"
        ),
        .ensureInitialTab(
          focusing: false,
          startupInput: nil,
        ),
      ]
    )
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
  func spaceCreateButtonTappedOpensEditorWithoutSendingCommand() async {
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

    await store.send(.spaceCreateButtonTapped) {
      $0.spaceEditor = .init(mode: .create, draftName: "")
    }

    #expect(analyticsRecorder.recorded().isEmpty)
    #expect(recorder.commands.isEmpty)
  }

  @Test
  func closeRequestedPresentsConfirmationWhenNeeded() async {
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    }

    await store.send(
      .clientEvent(.closeRequested(.init(target: .tab(tabID), needsConfirmation: true)))
    ) {
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

    await store.send(
      .clientEvent(.closeRequested(.init(target: .surface(surfaceID), needsConfirmation: true)))
    ) {
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

    await store.send(
      .clientEvent(.closeRequested(.init(target: .surface(surfaceID), needsConfirmation: false))))

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
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.commandPaletteToggleRequested) {
      $0.commandPalette = .init(
        selectedRowID: rows.first?.id
      )
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
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(in: rows, query: "switch")
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      selectedRowID: rows[1].id
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.commandPaletteQueryChanged("switch")) {
      $0.commandPalette?.query = "switch"
      $0.commandPalette?.selectedRowID = visibleRows.first?.id
    }
  }

  @Test
  func commandPaletteSelectionMovedClampsToFilteredRows() async {
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)
    let visibleRows = TerminalCommandPalettePresentation.visibleRows(in: rows, query: "switch")
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      query: "switch",
      selectedRowID: visibleRows.first?.id
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.commandPaletteSelectionMoved(99)) {
      $0.commandPalette?.selectedRowID = visibleRows.last?.id
    }
    await store.send(.commandPaletteSelectionMoved(-99)) {
      $0.commandPalette?.selectedRowID = visibleRows.first?.id
    }
  }

  @Test
  func commandPaletteActivateSelectionFocusesPaneThroughPaletteClient() async throws {
    let recorder = CommandPaletteClientRecorder()
    let snapshot = makeCommandPaletteSnapshot()
    let focusRow = try #require(
      TerminalCommandPalettePresentation.rows(from: snapshot).first {
        if case .focusPane = $0.command { return true }
        return false
      }
    )
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      selectedRowID: focusRow.id
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalCommandPaletteClient.focusPane = { target in
        recorder.recordFocus(target)
      }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }

    #expect(recorder.focusTargets == [snapshot.focusTargets[0]])
  }

  @Test
  func commandPaletteActivateSelectionPerformsUpdateThroughPaletteClient() async throws {
    let recorder = CommandPaletteClientRecorder()
    let snapshot = makeCommandPaletteSnapshot()
    let updateRow = try #require(
      TerminalCommandPalettePresentation.rows(from: snapshot).first {
        if case .update = $0.command { return true }
        return false
      }
    )
    let windowID = ObjectIdentifier(NSObject())
    var initialState = TerminalWindowFeature.State()
    initialState.windowID = windowID
    initialState.commandPalette = .init(
      selectedRowID: updateRow.id
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalCommandPaletteClient.performUpdateAction = { resolvedWindowID, action in
        recorder.recordUpdate(windowID: resolvedWindowID, action: action)
      }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }

    #expect(recorder.updateActions == [.install])
    #expect(recorder.updateWindowIDs == [windowID])
  }

  @Test
  func commandPaletteActivateSelectionExecutesGhosttyBindingActionAndClosesPalette() async {
    let recorder = TerminalCommandRecorder()
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      selectedRowID: "ghostty:new_split:right"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in makeCommandPaletteSnapshot() }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }

    #expect(recorder.commands == [.performGhosttyBindingActionOnFocusedSurface("new_split:right")])
  }

  @Test
  func commandPaletteActivateSelectionTogglesPinnedStateAndClosesPalette() async throws {
    let recorder = TerminalCommandRecorder()
    let snapshot = makeCommandPaletteSnapshot()
    let selectedTabID = try #require(snapshot.selectedTabID)
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      selectedRowID: "supaterm:toggle-pinned:\(selectedTabID.rawValue.uuidString)"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }

    #expect(recorder.commands == [.togglePinned(selectedTabID)])
  }

  @Test
  func commandPaletteActivateSelectionOpensGitHubIssueAndClosesPalette() async {
    var openedURLs: [URL] = []
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      selectedRowID: "supaterm:submit-github-issue"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in makeCommandPaletteSnapshot() }
      $0.externalNavigationClient.open = { url in
        openedURLs.append(url)
        return true
      }
    }

    await store.send(.commandPaletteActivateSelection) {
      $0.commandPalette = nil
    }

    #expect(openedURLs.map(\.absoluteString) == ["https://github.com/supabitapp/supaterm/issues/new"])
  }

  @Test
  func commandPaletteActivateSelectionKeepsPaletteOpenWhenNoVisibleRowMatches() async {
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      query: "zzzzzz",
      selectedRowID: "ghostty:new_split:right"
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in makeCommandPaletteSnapshot() }
    }

    await store.send(.commandPaletteActivateSelection)
  }

  @Test
  func commandPaletteSlotActivatedExecutesFilteredRowThroughSharedPath() async {
    let recorder = TerminalCommandRecorder()
    let snapshot = makeCommandPaletteSnapshot()
    let spaceID = snapshot.spaces[1].id
    var initialState = TerminalWindowFeature.State()
    initialState.commandPalette = .init(
      query: "switch",
      selectedRowID: nil
    )

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.commandPaletteSlotActivated(2)) {
      $0.commandPalette = nil
    }

    #expect(recorder.commands == [.selectSpace(spaceID)])
  }

  @Test
  func commandPaletteToggleFromClientEventRoutesToSameReducerPath() async {
    let snapshot = makeCommandPaletteSnapshot()
    let rows = TerminalCommandPalettePresentation.rows(from: snapshot)

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalCommandPaletteClient.snapshot = { _ in snapshot }
    }

    await store.send(.clientEvent(.commandPaletteToggleRequested))
    await store.receive(\.commandPaletteToggleRequested) {
      $0.commandPalette = .init(
        selectedRowID: rows.first?.id
      )
    }
  }

  @Test
  func toggleSidebarButtonTappedStartsHideTransitionAndCommitsAfterDelay() async {
    let clock = TestClock()
    var initialState = TerminalWindowFeature.State()
    initialState.isFloatingSidebarVisible = true

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.continuousClock = clock
    }

    await store.send(.toggleSidebarButtonTapped) {
      $0.isFloatingSidebarVisible = false
      $0.sidebarTransitionPhase = .hiding
    }

    await clock.advance(by: .milliseconds(220))

    await store.receive(\.sidebarTransitionCommit) {
      $0.isSidebarCollapsed = true
      $0.sidebarTransitionPhase = nil
    }
  }

  @Test
  func toggleSidebarButtonTappedStartsShowTransitionAndCommitsAfterDelay() async {
    let clock = TestClock()
    var initialState = TerminalWindowFeature.State()
    initialState.isSidebarCollapsed = true

    let store = TestStore(initialState: initialState) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.continuousClock = clock
    }

    await store.send(.toggleSidebarButtonTapped) {
      $0.sidebarTransitionPhase = .showing
    }

    await clock.advance(by: .milliseconds(220))

    await store.receive(\.sidebarTransitionCommit) {
      $0.isSidebarCollapsed = false
      $0.sidebarTransitionPhase = nil
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
  func spaceCreateFlowSendsCreateSpaceCommand() async {
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

    await store.send(.spaceCreateButtonTapped) {
      $0.spaceEditor = .init(mode: .create, draftName: "")
    }
    await store.send(.spaceEditorTextChanged("Build")) {
      $0.spaceEditor?.draftName = "Build"
    }
    await store.send(.spaceEditorSaveButtonTapped) {
      $0.spaceEditor = nil
    }

    #expect(analyticsRecorder.recorded() == ["space_created"])
    #expect(recorder.commands == [.createSpace("Build")])
  }

  @Test
  func spaceCreateCancelClearsEditorWithoutSendingCommand() async {
    let recorder = TerminalCommandRecorder()

    let store = TestStore(
      initialState: TerminalWindowFeature.State(
        spaceEditor: .init(mode: .create, draftName: "Build")
      )
    ) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.spaceEditorCancelButtonTapped) {
      $0.spaceEditor = nil
    }

    #expect(recorder.commands.isEmpty)
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
          initialInput: nil,
          cwd: nil,
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
          initialInput: nil,
          cwd: nil,
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
  func savePinnedTabLayoutRequestedSendsExplicitSaveCommand() async {
    let recorder = TerminalCommandRecorder()
    let tabID = TerminalTabID()

    let store = TestStore(initialState: TerminalWindowFeature.State()) {
      TerminalWindowFeature()
    } withDependencies: {
      $0.terminalClient.send = { recorder.record($0) }
    }

    await store.send(.savePinnedTabLayoutRequested(tabID))

    #expect(recorder.commands == [.savePinnedTabLayout(tabID)])
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
      $0.spaceEditor = .init(mode: .rename(space), draftName: "A")
    }
    await store.send(.spaceEditorTextChanged("Shell")) {
      $0.spaceEditor?.draftName = "Shell"
    }
    await store.send(.spaceEditorSaveButtonTapped) {
      $0.spaceEditor = nil
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
      $0.windowCloseClient.closeWindows = { windowIDs in
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

private func makeCommandPaletteSnapshot() -> TerminalCommandPaletteSnapshot {
  let selectedSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000101")!)
  let otherSpaceID = TerminalSpaceID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000102")!)
  let selectedTabID = TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000201")!)
  let otherTabID = TerminalTabID(rawValue: UUID(uuidString: "00000000-0000-0000-0000-000000000202")!)
  let focusTarget = TerminalCommandPaletteFocusTarget(
    windowControllerID: UUID(uuidString: "00000000-0000-0000-0000-000000000301")!,
    surfaceID: UUID(uuidString: "00000000-0000-0000-0000-000000000302")!,
    title: "ping 1.1.1.1",
    subtitle: "~/Projects/network"
  )

  return .init(
    ghosttyCommands: [
      .init(
        title: "Split Right",
        description: "Split the focused terminal to the right.",
        action: "new_split:right",
        actionKey: "new_split"
      ),
      .init(
        title: "Open Config",
        description: "Open the configuration file.",
        action: "open_config",
        actionKey: "open_config"
      ),
    ],
    ghosttyShortcutDisplayByAction: [
      "new_split:right": "⌘D",
      "open_config": "⌘,",
    ],
    hasFocusedSurface: true,
    updateEntries: [
      .init(
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
    selectedSpaceID: selectedSpaceID,
    spaces: [
      .init(id: selectedSpaceID, name: "Workspace Alpha"),
      .init(id: otherSpaceID, name: "Workspace Beta"),
    ],
    selectedTabID: selectedTabID,
    visibleTabs: [
      .init(id: selectedTabID, title: "Main", icon: nil),
      .init(id: otherTabID, title: "Logs", icon: "doc.plaintext"),
    ]
  )
}

@MainActor
private final class CommandPaletteClientRecorder {
  private(set) var focusTargets: [TerminalCommandPaletteFocusTarget] = []
  private(set) var updateActions: [UpdateUserAction] = []
  private(set) var updateWindowIDs: [ObjectIdentifier?] = []

  func recordFocus(_ target: TerminalCommandPaletteFocusTarget) {
    focusTargets.append(target)
  }

  func recordUpdate(windowID: ObjectIdentifier?, action: UpdateUserAction) {
    updateWindowIDs.append(windowID)
    updateActions.append(action)
  }
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
