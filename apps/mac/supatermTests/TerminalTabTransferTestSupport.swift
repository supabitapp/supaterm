import AppKit
import ComposableArchitecture
import GhosttyKit

@testable import supaterm

@MainActor
func registerTerminalWindow(
  _ terminal: TerminalHostState,
  id: UUID,
  in registry: TerminalWindowRegistry,
  onClose: @escaping @MainActor () -> Void = {}
) -> NSWindow {
  let store = Store(initialState: AppFeature.State()) {
    AppFeature()
  }
  registry.register(
    keyboardShortcutForAction: { _ in nil },
    windowControllerID: id,
    store: store,
    terminal: terminal,
    requestConfirmedWindowClose: onClose
  )
  let window = NSWindow()
  registry.updateWindow(window, for: id)
  return window
}

@MainActor
func unbackedTerminalSurface(
  runtime: GhosttyRuntime,
  tabID: TerminalTabID
) -> GhosttySurfaceView {
  GhosttySurfaceView(
    runtime: runtime,
    tabID: tabID.rawValue,
    workingDirectory: nil,
    context: GHOSTTY_SURFACE_CONTEXT_TAB,
    surfaceFactory: { _, _ in nil }
  )
}
