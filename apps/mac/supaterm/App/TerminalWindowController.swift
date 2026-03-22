import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
final class TerminalWindowController: NSWindowController {
  let ghostty: GhosttyRuntime
  let ghosttyShortcuts: GhosttyShortcutManager
  let terminal: TerminalHostState
  let store: StoreOf<AppFeature>
  let windowControllerID: UUID
  var onWindowWillClose: ((TerminalWindowController) -> Void)?

  private let registry: TerminalWindowRegistry
  private var isPerformingConfirmedClose = false

  init(registry: TerminalWindowRegistry) {
    self.registry = registry
    let windowControllerID = UUID()
    self.windowControllerID = windowControllerID

    let ghostty = GhosttyRuntime()
    let terminal = TerminalHostState(runtime: ghostty)
    let store = Store(initialState: AppFeature.State()) {
      AppFeature()
        ._printChanges(.actionLabels)
    } withDependencies: {
      $0.terminalClient = .live(host: terminal)
      $0.terminalWindowsClient = .live(registry: registry)
    }

    self.ghostty = ghostty
    self.ghosttyShortcuts = GhosttyShortcutManager(runtime: ghostty)
    self.terminal = terminal
    self.store = store

    let hostingController = NSHostingController(
      rootView: GhosttyColorSchemeSyncView(ghostty: ghostty) {
        ContentView(
          store: store,
          terminal: terminal
        )
      }
    )

    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = hostingController
    window.contentMinSize = NSSize(width: 1_080, height: 720)
    window.identifier = NSUserInterfaceItemIdentifier(
      "app.supabit.supaterm.window.\(windowControllerID.uuidString)")
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Supaterm"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true

    super.init(window: window)

    window.delegate = self
    registry.register(
      keyboardShortcutForAction: { [ghosttyShortcuts] action in
        ghosttyShortcuts.keyboardShortcut(forAction: action)
      },
      windowControllerID: windowControllerID,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: { [weak self] in
        self?.performConfirmedWindowClose()
      }
    )
    registry.updateWindow(window, for: windowControllerID)
    _ = store.send(.terminal(.windowIdentifierChanged(ObjectIdentifier(window))))
  }

  deinit {
    let windowControllerID = self.windowControllerID
    let registry = self.registry
    Task { @MainActor in
      registry.unregister(windowControllerID: windowControllerID)
    }
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  private func performConfirmedWindowClose() {
    guard let window else { return }
    isPerformingConfirmedClose = true
    window.close()
  }
}

extension TerminalWindowController: NSWindowDelegate {
  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if isPerformingConfirmedClose {
      isPerformingConfirmedClose = false
      return true
    }
    guard terminal.windowNeedsCloseConfirmation() else { return true }
    _ = store.send(.terminal(.windowCloseRequested(windowID: ObjectIdentifier(sender))))
    return false
  }

  func windowWillClose(_ notification: Notification) {
    registry.updateWindow(nil, for: windowControllerID)
    onWindowWillClose?(self)
  }
}
