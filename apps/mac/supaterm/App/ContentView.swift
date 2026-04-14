import ComposableArchitecture
import SupatermUpdateFeature
import SwiftUI

struct ContentView: View {
  let commandHoldObserver: CommandHoldObserver
  let ghosttyShortcuts: GhosttyShortcutManager
  let commandPaletteClient: TerminalCommandPaletteClient
  let store: StoreOf<AppFeature>
  @Bindable var terminal: TerminalHostState

  init(
    commandHoldObserver: CommandHoldObserver,
    ghosttyShortcuts: GhosttyShortcutManager,
    commandPaletteClient: TerminalCommandPaletteClient,
    store: StoreOf<AppFeature>,
    terminal: TerminalHostState
  ) {
    self.commandHoldObserver = commandHoldObserver
    self.ghosttyShortcuts = ghosttyShortcuts
    self.commandPaletteClient = commandPaletteClient
    self.store = store
    self._terminal = Bindable(terminal)
  }

  private var terminalStore: StoreOf<TerminalWindowFeature> {
    store.scope(state: \.terminal, action: \.terminal)
  }

  private var updateStore: StoreOf<UpdateFeature> {
    store.scope(state: \.update, action: \.update)
  }

  var body: some View {
    TerminalView(
      commandPaletteClient: commandPaletteClient,
      store: terminalStore,
      updateStore: updateStore,
      terminal: terminal
    )
    .environment(commandHoldObserver)
    .environment(ghosttyShortcuts)
    .task {
      updateStore.send(.task)
      terminalStore.send(.task)
    }
  }
}
