import ComposableArchitecture
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

  private var updateStore: StoreOf<UpdateFeature> {
    store.scope(state: \.update, action: \.update)
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
      let appTask = store.send(.task)
      let terminalTask = terminalStore.send(.task)
      let updateTask = updateStore.send(.task)
      await withTaskGroup(of: Void.self) { group in
        group.addTask {
          await appTask.finish()
        }
        group.addTask {
          await terminalTask.finish()
        }
        group.addTask {
          await updateTask.finish()
        }
      }
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

  private var updateStore: StoreOf<UpdateFeature> {
    store.scope(state: \.update, action: \.update)
  }

  var body: some View {
    TerminalWindowSidebarRoot(
      store: terminalStore,
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
