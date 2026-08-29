import ComposableArchitecture
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct ContentView: View {
  let commandHoldObserver: CommandHoldObserver
  let ghosttyShortcuts: GhosttyShortcutManager
  let commandPaletteClient: TerminalCommandPaletteClient
  let paneDragClient: TerminalPaneDragClient
  let updateWindowShell: (TerminalWindowShellPresentation) -> Void
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  init(
    commandHoldObserver: CommandHoldObserver,
    ghosttyShortcuts: GhosttyShortcutManager,
    commandPaletteClient: TerminalCommandPaletteClient,
    paneDragClient: TerminalPaneDragClient,
    updateWindowShell: @escaping (TerminalWindowShellPresentation) -> Void,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    self.commandHoldObserver = commandHoldObserver
    self.ghosttyShortcuts = ghosttyShortcuts
    self.commandPaletteClient = commandPaletteClient
    self.paneDragClient = paneDragClient
    self.updateWindowShell = updateWindowShell
    self.store = store
    self._terminal = Bindable(terminal)
  }

  private var terminalStore: StoreOf<TerminalWindowFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    TerminalView(
      commandPaletteClient: commandPaletteClient,
      store: terminalStore,
      terminal: terminal,
      updateWindowShell: updateWindowShell
    )
    .environment(commandHoldObserver)
    .environment(ghosttyShortcuts)
    .environment(\.terminalPaneDragClient, paneDragClient)
    .task { @MainActor in
      await terminalStore.send(.task).finish()
    }
  }
}

struct TerminalSidebarContentView: View {
  let commandHoldObserver: CommandHoldObserver
  let ghosttyShortcuts: GhosttyShortcutManager
  let licenseStore: StoreOf<LicenseFeature>
  let shellState: TerminalWindowShellState
  let store: StoreOf<AppFeature>
  let terminal: TerminalHostState
  let sidebarControllerCache: TerminalSidebarControllerCache
  let spacePagingDidEnd: () -> Void
  let updateStore: StoreOf<UpdateFeature>

  private var terminalStore: StoreOf<TerminalWindowFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  var body: some View {
    TerminalWindowSidebarRoot(
      store: terminalStore,
      licenseStore: licenseStore,
      updateStore: updateStore,
      releaseAnnouncement: store.releaseAnnouncement,
      terminal: terminal,
      shellState: shellState,
      sidebarControllerCache: sidebarControllerCache,
      spacePagingDidEnd: spacePagingDidEnd
    ) {
      store.send(.releaseAnnouncementDismissed)
    }
    .environment(commandHoldObserver)
    .environment(ghosttyShortcuts)
  }
}
