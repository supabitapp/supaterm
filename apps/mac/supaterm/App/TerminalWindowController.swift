import AppKit
import ComposableArchitecture
import SwiftUI

@MainActor
private final class TerminalGestureWindow: NSWindow {
  var onModifierFlagsChanged: ((NSEvent.ModifierFlags) -> Void)?
  var onSwipeLeft: (() -> Void)?
  var onSwipeRight: (() -> Void)?

  override func sendEvent(_ event: NSEvent) {
    if event.type == .flagsChanged {
      onModifierFlagsChanged?(event.modifierFlags)
    }
    if event.type == .swipe, handleSwipe(event) {
      return
    }
    super.sendEvent(event)
  }

  private func handleSwipe(_ event: NSEvent) -> Bool {
    let deltaX = resolvedDeltaX(for: event)
    guard abs(deltaX) > abs(event.deltaY) else { return false }
    if deltaX > 0, let onSwipeLeft {
      onSwipeLeft()
      return true
    }
    if deltaX < 0, let onSwipeRight {
      onSwipeRight()
      return true
    }
    return false
  }

  private func resolvedDeltaX(for event: NSEvent) -> CGFloat {
    let deltaX = event.deltaX
    return event.isDirectionInvertedFromDevice ? -deltaX : deltaX
  }
}

@MainActor
final class TerminalWindowController: NSWindowController {
  let ghostty: GhosttyRuntime
  let ghosttyShortcuts: GhosttyShortcutManager
  let terminal: TerminalHostState
  let store: StoreOf<AppFeature>
  let windowControllerID: UUID
  var onWindowWillClose: ((TerminalWindowController) -> Void)?

  private let registry: TerminalWindowRegistry
  private let commandHoldObserver: CommandHoldObserver
  private var isPerformingConfirmedClose = false

  init(
    registry: TerminalWindowRegistry,
    session: TerminalWindowSession? = nil,
    startupInput: String? = nil,
    onSessionChange: @escaping @MainActor () -> Void = {}
  ) {
    self.registry = registry
    let windowControllerID = UUID()
    self.windowControllerID = windowControllerID

    let ghostty = GhosttyRuntime()
    let terminal = TerminalHostState(runtime: ghostty)
    terminal.onSessionChange = onSessionChange
    if let session {
      _ = terminal.restore(from: session)
    }
    let store = Store(
      initialState: AppFeature.State(
        terminal: TerminalWindowFeature.State(
          initialStartupInput: startupInput
        )
      )
    ) {
      AppFeature()
        .logActions()
    } withDependencies: {
      $0.terminalClient = .live(host: terminal)
      $0.terminalWindowsClient = .live(registry: registry)
    }
    let ghosttyShortcuts = GhosttyShortcutManager(runtime: ghostty)
    let commandHoldObserver = CommandHoldObserver()

    self.ghostty = ghostty
    self.ghosttyShortcuts = ghosttyShortcuts
    self.commandHoldObserver = commandHoldObserver
    self.terminal = terminal
    self.store = store

    let hostingController = NSHostingController(
      rootView: AppAppearanceView {
        GhosttyColorSchemeSyncView(ghostty: ghostty) {
          ContentView(
            commandHoldObserver: commandHoldObserver,
            ghosttyShortcuts: ghosttyShortcuts,
            store: store,
            terminal: terminal
          )
        }
      }
    )

    let window = TerminalGestureWindow(
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
    window.onModifierFlagsChanged = { [commandHoldObserver] modifierFlags in
      commandHoldObserver.update(modifierFlags: modifierFlags)
    }
    window.onSwipeLeft = { [store] in
      _ = store.send(.terminal(.nextSpaceRequested))
    }
    window.onSwipeRight = { [store] in
      _ = store.send(.terminal(.previousSpaceRequested))
    }

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
  func windowDidBecomeKey(_ notification: Notification) {
    commandHoldObserver.update(modifierFlags: NSEvent.modifierFlags)
  }

  func windowDidResignKey(_ notification: Notification) {
    commandHoldObserver.reset()
  }

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
