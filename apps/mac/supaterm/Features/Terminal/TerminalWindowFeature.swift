import ComposableArchitecture
import CoreGraphics
import Foundation
import Sharing
import SupaTheme
import SupatermCLIShared
import SupatermSupport

private nonisolated enum TerminalWindowCancelID: Hashable, Sendable {
  case events(UUID)
}

struct TerminalSpaceDeleteRequest: Equatable, Identifiable {
  let space: TerminalSpaceItem

  var id: TerminalSpaceID { space.id }
}

enum TerminalSpaceEditorMode: Equatable {
  case create
  case rename(TerminalSpaceItem)
}

struct TerminalSpaceEditorState: Equatable, Identifiable {
  let mode: TerminalSpaceEditorMode
  var draftName: String
  var draftColor: ThemeTint

  var id: String {
    switch mode {
    case .create:
      return "create"
    case .rename(let space):
      return space.id.rawValue.uuidString
    }
  }

  var excludedSpaceID: TerminalSpaceID? {
    switch mode {
    case .create:
      return nil
    case .rename(let space):
      return space.id
    }
  }

  var title: String {
    switch mode {
    case .create:
      return "Create Space"
    case .rename:
      return "Edit Space"
    }
  }

  var confirmTitle: String {
    switch mode {
    case .create:
      return "Create"
    case .rename:
      return "Save"
    }
  }
}

@MainActor
@Reducer
struct TerminalWindowFeature {
  static let closeAllWindowsWarningMessage =
    "Closing all windows terminates their terminal sessions. Reopening Supaterm starts new sessions. "
    + "zmx persistence is for Supaterm restarts."
  static let closeTabWarningMessage =
    "Closing this tab closes all its panes and terminates any running processes. Close it anyway?"
  static let closeWindowWarningMessage =
    "Closing this window terminates its terminal sessions. Reopening the window starts new sessions. "
    + "zmx persistence is for Supaterm restarts."

  struct WindowCloseConfirmation: Equatable {
    let target: WindowCloseConfirmationTarget
    let title: String
    let message: String
    let confirmTitle: String
  }

  enum WindowCloseConfirmationTarget: Equatable {
    case closeAllWindows([ObjectIdentifier])
    case closeWindow(ObjectIdentifier)
  }

  struct PendingCloseRequest: Equatable, Identifiable {
    let target: PendingCloseTarget
    let title: String
    let message: String

    var id: String {
      switch target {
      case .surface(let surfaceID):
        return "pane:\(surfaceID.uuidString)"
      case .tab(let tabID):
        return "tab:\(tabID.rawValue.uuidString)"
      case .tabs(let tabIDs):
        return "tabs:\(tabIDs.map { $0.rawValue.uuidString }.joined(separator: ","))"
      case .group(let groupID):
        return "group:\(groupID.rawValue.uuidString)"
      }
    }
  }

  enum PendingCloseTarget: Equatable {
    case surface(UUID)
    case tab(TerminalTabID)
    case tabs([TerminalTabID])
    case group(TerminalTabGroupID)
  }

  enum Destination: Equatable {
    case closeConfirmation(PendingCloseRequest)
    case commandPalette(TerminalCommandPaletteState)
    case spaceDeleteConfirmation(TerminalSpaceDeleteRequest)
    case spaceEditor(TerminalSpaceEditorState)
    case windowCloseConfirmation(WindowCloseConfirmation)
  }

  @ObservableState
  struct State: Equatable {
    var destination: Destination?
    var isSidebarCollapsed = false
    var hiddenAgentPanelSurfaceIDs: Set<UUID> = []
    var sidebarResizeState: TerminalSidebarResizeState?
    var sidebarWidth: CGFloat?
    var windowControllerID = UUID()
    var windowID: ObjectIdentifier?

    var commandPalette: TerminalCommandPaletteState? {
      guard case .commandPalette(let commandPalette) = destination else { return nil }
      return commandPalette
    }

    var pendingCloseRequest: PendingCloseRequest? {
      guard case .closeConfirmation(let request) = destination else { return nil }
      return request
    }

    var pendingSpaceDeleteRequest: TerminalSpaceDeleteRequest? {
      guard case .spaceDeleteConfirmation(let request) = destination else { return nil }
      return request
    }

    var spaceEditor: TerminalSpaceEditorState? {
      guard case .spaceEditor(let editor) = destination else { return nil }
      return editor
    }

    var windowCloseConfirmation: WindowCloseConfirmation? {
      guard case .windowCloseConfirmation(let confirmation) = destination else { return nil }
      return confirmation
    }
  }

  private struct ResolvedCommandPalette {
    let matches: [TerminalCommandPaletteMatch]
    let selectedRowID: TerminalCommandPaletteRow.ID?

    var selectedRow: TerminalCommandPaletteRow? {
      guard let selectedRowID else { return nil }
      return matches.first(where: { $0.id == selectedRowID })?.row
    }
  }

  enum Action {
    case clientEvent(TerminalClient.Event)
    case commandPaletteActivateSelection
    case commandPaletteCloseRequested
    case commandPaletteQueryChanged(String)
    case commandPaletteSlotActivated(Int)
    case commandPaletteSelectionChanged(Int)
    case commandPaletteSelectionMoved(Int)
    case commandPaletteToggleRequested
    case closeConfirmationCancelButtonTapped
    case closeConfirmationConfirmButtonTapped
    case closeAllWindowsRequested([ObjectIdentifier])
    case hiddenAgentPanelsTransferred(remove: Set<UUID>, insert: Set<UUID>)
    case agentPanelCopyText(String)
    case agentPanelURLTapped(URL)
    case agentPanelVisibilityToggled(UUID)
    case sidebarResizeInput(TerminalSidebarResizeInput, totalWidth: CGFloat)
    case task
    case spaceCreateButtonTapped
    case spaceDeleteCancelButtonTapped
    case spaceDeleteConfirmButtonTapped
    case spaceDeleteRequested(TerminalSpaceItem)
    case spaceEditorCancelButtonTapped
    case spaceEditorColorSelected(ThemeTint)
    case spaceRenameRequested(TerminalSpaceItem)
    case spaceEditorSaveButtonTapped
    case spaceEditorTextChanged(String)
    case toggleSidebarButtonTapped
    case confirmationCancelButtonTapped
    case confirmationConfirmButtonTapped
    case windowIdentifierChanged(ObjectIdentifier)
    case windowCloseRequested(windowID: ObjectIdentifier)
  }

  @Dependency(AnalyticsClient.self) var analyticsClient
  @Dependency(ClipboardClient.self) var clipboardClient
  @Dependency(ExternalNavigationClient.self) var externalNavigationClient
  @Dependency(DesktopNotificationClient.self) var desktopNotificationClient
  @Dependency(TerminalCommandPaletteClient.self) var terminalCommandPaletteClient
  @Dependency(TerminalClient.self) var terminalClient
  @Dependency(WindowCloseClient.self) var windowCloseClient
  @Dependency(\.withRandomNumberGenerator) var withRandomNumberGenerator

  var body: some Reducer<State, Action> {
    Reduce { state, action in
      switch action {
      case .clientEvent(let event):
        switch event {
        case .commandPaletteToggleRequested:
          return .send(.commandPaletteToggleRequested)

        case .closeRequested(let request):
          SupatermLog.debug(
            SupatermLog.terminal,
            "terminal.close.reducer.requestReceived",
            fields: [
              "target=\(request.target)",
              "needsConfirmation=\(request.needsConfirmation)",
              "hadPendingRequest=\(state.pendingCloseRequest != nil)",
            ]
          )
          if request.needsConfirmation {
            state.destination = .closeConfirmation(pendingCloseRequest(for: request.target))
            SupatermLog.debug(
              SupatermLog.terminal,
              "terminal.close.reducer.confirmationPresented",
              fields: ["target=\(request.target)"]
            )
            return .none
          }
          SupatermLog.debug(
            SupatermLog.terminal,
            "terminal.close.reducer.execute",
            fields: ["target=\(request.target)"]
          )
          return executeClose(for: request.target)

        case .gotoTabRequested(let target):
          switch target {
          case .index(let slot):
            return perform { $0.selectTab(slot: slot) }
          case .last:
            return perform { $0.selectLastTab() }
          case .next:
            return perform { $0.nextTab() }
          case .previous:
            return perform { $0.previousTab() }
          }

        case .newTabRequested(let inheritingFromSurfaceID):
          analyticsClient.capture("terminal_tab_created")
          return perform { _ = $0.createTab(inheritingFromSurfaceID: inheritingFromSurfaceID) }

        case .notificationReceived(let event):
          @Shared(.supatermSettings) var supatermSettings = .default
          guard supatermSettings.systemNotificationsEnabled else { return .none }
          guard event.desktopNotificationDisposition.shouldDeliver else { return .none }
          return .run { [desktopNotificationClient] _ in
            await desktopNotificationClient.deliver(
              DesktopNotificationRequest(
                body: event.body,
                subtitle: event.subtitle,
                title: event.resolvedTitle,
                sourceSurfaceID: event.sourceSurfaceID
              )
            )
          }

        case .windowCloseRequested(let needsConfirmation):
          SupatermLog.debug(
            SupatermLog.terminal,
            "terminal.close.reducer.windowRequestReceived",
            fields: [
              "needsConfirmation=\(needsConfirmation)",
              "hasWindowID=\(state.windowID != nil)",
              "hadConfirmationRequest=\(state.windowCloseConfirmation != nil)",
            ]
          )
          guard let windowID = state.windowID else { return .none }
          guard needsConfirmation else {
            SupatermLog.debug(
              SupatermLog.terminal,
              "terminal.close.reducer.windowExecute"
            )
            return .run { [windowCloseClient] _ in
              await windowCloseClient.closeWindow(windowID)
            }
          }
          state.destination = .windowCloseConfirmation(
            windowCloseConfirmation(for: .closeWindow(windowID))
          )
          SupatermLog.debug(
            SupatermLog.terminal,
            "terminal.close.reducer.windowConfirmationPresented"
          )
          return .none
        }

      case .commandPaletteActivateSelection:
        return executeSelectedCommandPaletteCommand(state: &state)

      case .commandPaletteCloseRequested:
        guard state.commandPalette != nil else { return .none }
        state.destination = nil
        return .none

      case .commandPaletteQueryChanged(let query):
        updateCommandPaletteQuery(query, state: &state)
        return .none

      case .commandPaletteSlotActivated(let slot):
        return executeCommandPaletteSlot(slot, state: &state)

      case .commandPaletteSelectionChanged(let index):
        updateCommandPaletteSelection(index: index, state: &state)
        return .none

      case .commandPaletteSelectionMoved(let offset):
        moveCommandPaletteSelection(offset: offset, state: &state)
        return .none

      case .commandPaletteToggleRequested:
        switch state.destination {
        case nil:
          state.destination = .commandPalette(openCommandPaletteState(windowID: state.windowID))
        case .commandPalette:
          state.destination = nil
        default:
          return .none
        }
        return .none

      case .closeConfirmationCancelButtonTapped:
        SupatermLog.debug(
          SupatermLog.terminal,
          "terminal.close.reducer.confirmationCancelled",
          fields: [
            "target=\(state.pendingCloseRequest.map { "\($0.target)" } ?? "nil")"
          ]
        )
        guard state.pendingCloseRequest != nil else { return .none }
        state.destination = nil
        return .none

      case .closeConfirmationConfirmButtonTapped:
        guard let pendingCloseRequest = state.pendingCloseRequest else {
          SupatermLog.debug(
            SupatermLog.terminal,
            "terminal.close.reducer.confirmationConfirmDropped",
            fields: ["reason=missingRequest"]
          )
          return .none
        }
        SupatermLog.debug(
          SupatermLog.terminal,
          "terminal.close.reducer.confirmationConfirmed",
          fields: ["target=\(pendingCloseRequest.target)"]
        )
        state.destination = nil
        return executeClose(for: closeTarget(for: pendingCloseRequest.target))

      case .spaceDeleteCancelButtonTapped:
        guard state.pendingSpaceDeleteRequest != nil else { return .none }
        state.destination = nil
        return .none

      case .spaceDeleteConfirmButtonTapped:
        guard let request = state.pendingSpaceDeleteRequest else { return .none }
        state.destination = nil
        return perform { $0.onSpaceAction(.delete(request.space.id)) }

      case .closeAllWindowsRequested(let windowIDs):
        guard !windowIDs.isEmpty else { return .none }
        state.destination = .windowCloseConfirmation(
          windowCloseConfirmation(for: .closeAllWindows(windowIDs))
        )
        return .none

      case .hiddenAgentPanelsTransferred(let removedSurfaceIDs, let insertedSurfaceIDs):
        state.hiddenAgentPanelSurfaceIDs.subtract(removedSurfaceIDs)
        state.hiddenAgentPanelSurfaceIDs.formUnion(insertedSurfaceIDs)
        return .none

      case .agentPanelCopyText(let value):
        return .run { [clipboardClient] _ in
          await clipboardClient.copyString(value)
        }

      case .agentPanelURLTapped(let url):
        return .run { [externalNavigationClient] _ in
          _ = await externalNavigationClient.open(url)
        }

      case .agentPanelVisibilityToggled(let surfaceID):
        if state.hiddenAgentPanelSurfaceIDs.contains(surfaceID) {
          state.hiddenAgentPanelSurfaceIDs.remove(surfaceID)
        } else {
          state.hiddenAgentPanelSurfaceIDs.insert(surfaceID)
        }
        return .none

      case .sidebarResizeInput(let input, let totalWidth):
        switch input {
        case .began:
          state.sidebarResizeState = TerminalSidebarWidthPolicy.resizeState(
            preferredWidth: state.sidebarWidth,
            totalWidth: totalWidth
          )
          return .none
        case .changed(let delta):
          state.sidebarResizeState?.delta = delta
          return .none
        case .ended:
          guard let resizeState = state.sidebarResizeState else { return .none }
          state.sidebarResizeState = nil
          guard
            !TerminalSidebarWidthPolicy.shouldCollapse(
              resizeState: resizeState,
              totalWidth: totalWidth
            )
          else {
            state.isSidebarCollapsed = true
            return .none
          }
          state.sidebarWidth = TerminalSidebarWidthPolicy.settledWidth(
            for: resizeState,
            totalWidth: totalWidth
          )
        case .failed:
          state.sidebarResizeState = nil
          return .none
        case .reset:
          state.sidebarResizeState = nil
          state.sidebarWidth = nil
        }
        return .run { [terminalClient] _ in
          await terminalClient.host().sessionDidChange()
        }

      case .task:
        let windowControllerID = state.windowControllerID
        return .run { [terminalClient] send in
          let events = await terminalClient.events()
          for await event in events {
            await send(.clientEvent(event))
          }
        }
        .cancellable(
          id: TerminalWindowCancelID.events(windowControllerID),
          cancelInFlight: true
        )

      case .spaceCreateButtonTapped:
        state.destination = .spaceEditor(
          TerminalSpaceEditorState(
            mode: .create,
            draftName: "",
            draftColor: withRandomNumberGenerator { generator in
              ThemeTint.chromatic.randomElement(using: &generator) ?? .blue
            }
          )
        )
        return .none

      case .spaceDeleteRequested(let space):
        state.destination = .spaceDeleteConfirmation(TerminalSpaceDeleteRequest(space: space))
        return .none

      case .spaceEditorCancelButtonTapped:
        guard state.spaceEditor != nil else { return .none }
        state.destination = nil
        return .none

      case .spaceEditorColorSelected(let color):
        guard var spaceEditor = state.spaceEditor else { return .none }
        spaceEditor.draftColor = color
        state.destination = .spaceEditor(spaceEditor)
        return .none

      case .spaceRenameRequested(let space):
        state.destination = .spaceEditor(
          TerminalSpaceEditorState(
            mode: .rename(space),
            draftName: space.name,
            draftColor: space.color
          )
        )
        return .none

      case .spaceEditorSaveButtonTapped:
        guard let spaceEditor = state.spaceEditor else { return .none }
        state.destination = nil
        switch spaceEditor.mode {
        case .create:
          analyticsClient.capture("space_created")
          return perform { $0.onSpaceAction(.create(spaceEditor.draftName, spaceEditor.draftColor)) }
        case .rename(let space):
          return perform {
            $0.onSpaceAction(.rename(space.id, spaceEditor.draftName))
            guard spaceEditor.draftColor != space.color else { return }
            $0.onSpaceAction(.setColor(space.id, spaceEditor.draftColor))
          }
        }

      case .spaceEditorTextChanged(let text):
        guard var spaceEditor = state.spaceEditor else { return .none }
        spaceEditor.draftName = text
        state.destination = .spaceEditor(spaceEditor)
        return .none

      case .toggleSidebarButtonTapped:
        toggleSidebar(state: &state)
        return .none

      case .confirmationCancelButtonTapped:
        guard let confirmation = state.windowCloseConfirmation else { return .none }
        SupatermLog.debug(
          SupatermLog.terminal,
          "terminal.close.reducer.windowConfirmationCancelled",
          fields: ["target=\(windowCloseConfirmationTargetLabel(confirmation.target))"]
        )
        state.destination = nil
        return .none

      case .confirmationConfirmButtonTapped:
        guard let confirmation = state.windowCloseConfirmation else { return .none }
        SupatermLog.debug(
          SupatermLog.terminal,
          "terminal.close.reducer.windowConfirmationConfirmed",
          fields: ["target=\(windowCloseConfirmationTargetLabel(confirmation.target))"]
        )
        state.destination = nil
        switch confirmation.target {
        case .closeWindow(let windowID):
          return .run { [windowCloseClient] _ in
            await windowCloseClient.closeWindow(windowID)
          }
        case .closeAllWindows(let windowIDs):
          return .run { [windowCloseClient] _ in
            await windowCloseClient.closeWindows(windowIDs)
          }
        }

      case .windowIdentifierChanged(let windowID):
        state.windowID = windowID
        return .none

      case .windowCloseRequested(let windowID):
        if let currentWindowID = state.windowID, currentWindowID != windowID {
          return .none
        }
        state.destination = .windowCloseConfirmation(
          windowCloseConfirmation(for: .closeWindow(windowID))
        )
        return .none
      }
    }
  }

  private func perform(_ operation: (TerminalHostState) -> Void) -> Effect<Action> {
    operation(terminalClient.host())
    return .none
  }

  private func openCommandPaletteState(windowID: ObjectIdentifier?) -> TerminalCommandPaletteState {
    let matches = TerminalCommandPalettePresentation.matches(
      from: commandPaletteSnapshot(windowID: windowID),
      query: ""
    )
    return TerminalCommandPaletteState(
      selectedRowID: TerminalCommandPalettePresentation.normalizedSelection(nil, in: matches)
    )
  }

  private func commandPaletteSnapshot(windowID: ObjectIdentifier?) -> TerminalCommandPaletteSnapshot {
    terminalCommandPaletteClient.snapshot(windowID)
  }

  private func resolvedCommandPalette(for state: State) -> ResolvedCommandPalette? {
    guard let commandPalette = state.commandPalette else { return nil }
    let matches = TerminalCommandPalettePresentation.matches(
      from: commandPaletteSnapshot(windowID: state.windowID),
      query: commandPalette.query
    )
    let selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      commandPalette.selectedRowID,
      in: matches
    )
    return ResolvedCommandPalette(
      matches: matches,
      selectedRowID: selectedRowID
    )
  }

  private func updateCommandPaletteQuery(
    _ query: String,
    state: inout State
  ) {
    guard var commandPalette = state.commandPalette else { return }
    commandPalette.query = query
    let matches = TerminalCommandPalettePresentation.matches(
      from: commandPaletteSnapshot(windowID: state.windowID),
      query: query
    )
    commandPalette.selectedRowID = TerminalCommandPalettePresentation.normalizedSelection(
      nil,
      in: matches
    )
    state.destination = .commandPalette(commandPalette)
  }

  private func updateCommandPaletteSelection(
    index: Int,
    state: inout State
  ) {
    guard let resolved = resolvedCommandPalette(for: state) else { return }
    guard let row = TerminalCommandPalettePresentation.row(atVisibleIndex: index, in: resolved.matches)
    else { return }
    guard var commandPalette = state.commandPalette else { return }
    commandPalette.selectedRowID = row.id
    state.destination = .commandPalette(commandPalette)
  }

  private func moveCommandPaletteSelection(
    offset: Int,
    state: inout State
  ) {
    guard let resolved = resolvedCommandPalette(for: state) else { return }
    guard var commandPalette = state.commandPalette else { return }
    commandPalette.selectedRowID = TerminalCommandPalettePresentation.movedSelection(
      resolved.selectedRowID,
      by: offset,
      in: resolved.matches
    )
    state.destination = .commandPalette(commandPalette)
  }

  private func executeSelectedCommandPaletteCommand(
    state: inout State
  ) -> Effect<Action> {
    guard let resolved = resolvedCommandPalette(for: state) else { return .none }
    guard let row = resolved.selectedRow else { return .none }
    return executeCommandPaletteCommand(row.command, state: &state)
  }

  private func executeCommandPaletteSlot(
    _ slot: Int,
    state: inout State
  ) -> Effect<Action> {
    guard let resolved = resolvedCommandPalette(for: state) else { return .none }
    guard let row = TerminalCommandPalettePresentation.rowForSlot(slot, in: resolved.matches)
    else { return .none }
    return executeCommandPaletteCommand(row.command, state: &state)
  }

  private func executeCommandPaletteCommand(
    _ command: TerminalCommandPaletteCommand,
    state: inout State
  ) -> Effect<Action> {
    let windowID = state.windowID
    state.destination = nil

    switch command {
    case .app(let action):
      return .run { [terminalCommandPaletteClient, windowID] _ in
        await terminalCommandPaletteClient.performAppAction(windowID, action)
      }
    case .closeOtherTabs(let tabIDs):
      return perform { $0.requestCloseOtherTabs(keeping: tabIDs) }
    case .closePane(let surfaceID):
      return perform { $0.requestCloseSurface(surfaceID) }
    case .closeTab(let tabID):
      return perform { $0.requestCloseTab(tabID) }
    case .ghosttyBindingAction(let action):
      return perform { _ = $0.performGhosttyBindingActionOnFocusedSurface(action) }
    case .focusPane(let target):
      return .run { [terminalCommandPaletteClient] _ in
        await terminalCommandPaletteClient.focusPane(target)
      }
    case .movePaneToNewTab(let surfaceID):
      return perform { $0.movePaneToNewTab(surfaceID) }
    case .update(let action):
      return .run { [terminalCommandPaletteClient, windowID] _ in
        await terminalCommandPaletteClient.performUpdateAction(windowID, action)
      }
    case .toggleSidebar:
      toggleSidebar(state: &state)
      return .none
    case .createSpace:
      return .send(.spaceCreateButtonTapped)
    case .renameSpace(let space):
      return .send(.spaceRenameRequested(space))
    case .togglePinned(let tabID):
      return perform { $0.togglePinned(tabID) }
    case .selectSpace(let spaceID):
      return perform { $0.onSpaceAction(.select(spaceID)) }
    case .selectTab(let tabID):
      return perform { $0.selectTab(tabID) }
    }
  }

  private func toggleSidebar(state: inout State) {
    state.isSidebarCollapsed.toggle()
    state.sidebarResizeState = nil
  }

  private func executeClose(for target: TerminalCloseTarget) -> Effect<Action> {
    switch target {
    case .surface(let surfaceID):
      return perform { $0.closeSurface(surfaceID) }
    case .tab(let tabID):
      return perform { $0.closeTab(tabID) }
    case .tabs(let tabIDs):
      return perform { $0.closeTabs(tabIDs) }
    case .group(let groupID):
      return perform { $0.closeGroup(groupID) }
    }
  }

  private func windowCloseConfirmationTargetLabel(
    _ target: WindowCloseConfirmationTarget
  ) -> String {
    switch target {
    case .closeWindow:
      return "closeWindow"
    case .closeAllWindows:
      return "closeAllWindows"
    }
  }

  private func closeTarget(for target: PendingCloseTarget) -> TerminalCloseTarget {
    switch target {
    case .surface(let surfaceID):
      return .surface(surfaceID)
    case .tab(let tabID):
      return .tab(tabID)
    case .tabs(let tabIDs):
      return .tabs(tabIDs)
    case .group(let groupID):
      return .group(groupID)
    }
  }

  private func pendingCloseRequest(for target: TerminalCloseTarget) -> PendingCloseRequest {
    switch target {
    case .surface(let surfaceID):
      return PendingCloseRequest(
        target: .surface(surfaceID),
        title: "Close Pane?",
        message: "A process is still running in this pane. Close it anyway?"
      )
    case .tab(let tabID):
      return PendingCloseRequest(
        target: .tab(tabID),
        title: "Close Tab?",
        message: Self.closeTabWarningMessage
      )
    case .tabs(let tabIDs):
      return PendingCloseRequest(
        target: .tabs(tabIDs),
        title: "Close Tabs?",
        message: "A process is still running in one or more of these tabs. Close them anyway?"
      )
    case .group(let groupID):
      return PendingCloseRequest(
        target: .group(groupID),
        title: "Close Group?",
        message: "Closing this group closes all its tabs and terminates any running processes. Close it anyway?"
      )
    }
  }

  private func windowCloseConfirmation(
    for target: WindowCloseConfirmationTarget
  ) -> WindowCloseConfirmation {
    switch target {
    case .closeWindow(let windowID):
      return WindowCloseConfirmation(
        target: .closeWindow(windowID),
        title: "Close Window?",
        message: Self.closeWindowWarningMessage,
        confirmTitle: "Close Window"
      )
    case .closeAllWindows(let windowIDs):
      return WindowCloseConfirmation(
        target: .closeAllWindows(windowIDs),
        title: "Close All Windows?",
        message: Self.closeAllWindowsWarningMessage,
        confirmTitle: "Close All Windows"
      )
    }
  }
}
