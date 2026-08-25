import AppKit
import ComposableArchitecture
import Foundation

@testable import supaterm

@MainActor
func registerWindow(
  in registry: TerminalWindowRegistry,
  spaceID: TerminalSpaceID,
  createsInitialTab: Bool = false,
  onClose: @escaping (UUID) -> Void = { _ in }
) -> RegisteredWindow {
  let id = UUID()
  let host = TerminalHostState(managesTerminalSurfaces: createsInitialTab, spaceID: spaceID)
  if createsInitialTab {
    host.ensureInitialTab(focusing: false, startupCommand: nil)
  }
  let store = Store(initialState: AppFeature.State()) {
    AppFeature()
  }
  registry.register(
    keyboardShortcutForAction: { _ in nil },
    windowControllerID: id,
    store: store,
    terminal: host,
    requestConfirmedWindowClose: { onClose(id) }
  )
  let window = makeWindow()
  registry.updateWindow(window, for: id)
  return RegisteredWindow(terminal: host, window: window)
}

struct RegisteredWindow {
  let terminal: TerminalHostState
  let window: NSWindow
}
