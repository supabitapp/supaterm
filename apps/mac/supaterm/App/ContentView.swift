import ComposableArchitecture
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

struct ContentView: View {
  let commandHoldObserver: CommandHoldObserver
  let ghosttyShortcuts: GhosttyShortcutManager
  let commandPaletteClient: TerminalCommandPaletteClient
  let updateWindowShell: (TerminalWindowShellPresentation) -> Void
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  init(
    commandHoldObserver: CommandHoldObserver,
    ghosttyShortcuts: GhosttyShortcutManager,
    commandPaletteClient: TerminalCommandPaletteClient,
    updateWindowShell: @escaping (TerminalWindowShellPresentation) -> Void,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    self.commandHoldObserver = commandHoldObserver
    self.ghosttyShortcuts = ghosttyShortcuts
    self.commandPaletteClient = commandPaletteClient
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
    .task { @MainActor in
      await terminalStore.send(.task).finish()
    }
  }
}

struct TerminalSidebarContentView: View {
  let commandHoldObserver: CommandHoldObserver
  let ghosttyShortcuts: GhosttyShortcutManager
  let shellState: TerminalWindowShellState
  let store: StoreOf<AppFeature>
  let terminal: TerminalHostState
  let sidebarControllerCache: TerminalSidebarControllerCache
  let spacePagingDidEnd: () -> Void

  private var terminalStore: StoreOf<TerminalWindowFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  private var licenseStore: StoreOf<LicenseFeature> {
    store.scope(state: \.license, action: \.license)
  }

  private var updateStore: StoreOf<UpdateFeature> {
    store.scope(state: \.update, action: \.update)
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
