import AppKit
import ComposableArchitecture
import GhosttyKit
import SupatermSupport
import SwiftUI

@MainActor
private final class TerminalGestureWindow: NSWindow {
  var onModifierFlagsChanged: ((NSEvent.ModifierFlags) -> Void)?
  var onPaletteShortcut: ((Int) -> Bool)?
  var onSwipeLeft: (() -> Void)?
  var onSwipeRight: (() -> Void)?

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if let slot = paletteShortcutSlot(for: event), onPaletteShortcut?(slot) == true {
      return true
    }
    return super.performKeyEquivalent(with: event)
  }

  override func sendEvent(_ event: NSEvent) {
    if event.type == .flagsChanged {
      onModifierFlagsChanged?(event.modifierFlags)
    }
    if event.type == .swipe, handleSwipe(event) {
      return
    }
    super.sendEvent(event)
  }

  private func paletteShortcutSlot(for event: NSEvent) -> Int? {
    guard event.type == .keyDown else { return nil }
    guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command else {
      return nil
    }
    guard let characters = event.charactersIgnoringModifiers else { return nil }
    guard let slot = Int(characters), (1...9).contains(slot) else { return nil }
    return slot
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
  let terminal: TerminalHostState
  let store: StoreOf<AppFeature>
  let windowControllerID: UUID
  var onWindowWillClose: ((TerminalWindowController) -> Void)?

  private let runtime: GhosttyRuntime
  private let registry: TerminalWindowRegistry
  private let commandHoldObserver: CommandHoldObserver
  private var runtimeObservers: [NSObjectProtocol] = []
  private var isPerformingConfirmedClose = false
  private var terminatesTerminalSessionsOnClose = true

  init(
    runtime: GhosttyRuntime,
    registry: TerminalWindowRegistry,
    session: TerminalWindowSession? = nil,
    spaceID: TerminalSpaceID? = nil,
    startupCommand: String? = nil,
    zmxClient: ZmxClient = .live,
    zmxSessionsEnabled: Bool = true,
    onSessionChange: @escaping @MainActor () -> Void = {}
  ) {
    self.runtime = runtime
    self.registry = registry
    let windowControllerID = UUID()
    self.windowControllerID = windowControllerID

    let terminal = TerminalHostState(
      runtime: runtime,
      spaceID: session?.displayedSpaceID ?? spaceID,
      zmxClient: zmxClient,
      zmxSessionsEnabled: zmxSessionsEnabled
    )
    terminal.onSessionChange = onSessionChange
    Self.prepareTerminal(terminal, session: session, startupCommand: startupCommand)
    let commandPaletteClient = TerminalCommandPaletteClient.live(registry: registry)
    let store = Store(
      initialState: AppFeature.State(
        terminal: TerminalWindowFeature.State(
          startupCommand: startupCommand
        )
      )
    ) {
      AppFeature()
        .logActions()
    } withDependencies: {
      $0.analyticsClient.capture = { event in
        Task { @MainActor in
          AppPostHog.capture(event)
        }
      }
      $0.terminalCommandPaletteClient = commandPaletteClient
      $0.terminalClient = .live(host: terminal)
      $0.windowCloseClient = .live(registry: registry)
    }
    let ghosttyShortcuts = GhosttyShortcutManager(runtime: runtime)
    let commandHoldObserver = CommandHoldObserver()

    self.commandHoldObserver = commandHoldObserver
    self.terminal = terminal
    self.store = store

    let hostingController = NSHostingController(
      rootView: AppAppearanceView {
        GhosttyColorSchemeSyncView(ghostty: runtime) {
          ContentView(
            commandHoldObserver: commandHoldObserver,
            ghosttyShortcuts: ghosttyShortcuts,
            commandPaletteClient: commandPaletteClient,
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
      "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").window.\(windowControllerID.uuidString)")
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.titleVisibility = .hidden
    Self.applyRestoredFrame(session?.frame, to: window)
    window.onModifierFlagsChanged = { [commandHoldObserver] modifierFlags in
      commandHoldObserver.update(modifierFlags: modifierFlags)
    }
    window.onPaletteShortcut = { [store] slot in
      guard store.terminal.commandPalette != nil else { return false }
      _ = store.send(.terminal(.commandPaletteSlotActivated(slot)))
      return true
    }
    Self.configureSpaceSwipes(window, store: store)

    super.init(window: window)

    window.delegate = self
    observeRuntimeAppearance()
    applyWindowBackgroundAppearance()
    registry.register(
      keyboardShortcutForAction: { [ghosttyShortcuts] action in
        ghosttyShortcuts.keyboardShortcut(forAction: action)
      },
      windowControllerID: windowControllerID,
      store: store,
      terminal: terminal,
      requestConfirmedWindowClose: { [weak self] in
        self?.performConfirmedWindowClose()
      },
      setTerminatesTerminalSessionsOnClose: { [weak self] terminates in
        self?.terminatesTerminalSessionsOnClose = terminates
      }
    )
    registry.updateWindow(window, for: windowControllerID)
    _ = store.send(.terminal(.windowIdentifierChanged(ObjectIdentifier(window))))
  }

  private static func configureSpaceSwipes(
    _ window: TerminalGestureWindow,
    store: StoreOf<AppFeature>
  ) {
    window.onSwipeLeft = {
      _ = store.send(.terminal(.nextSpaceRequested))
    }
    window.onSwipeRight = {
      _ = store.send(.terminal(.previousSpaceRequested))
    }
  }

  private static func prepareTerminal(
    _ terminal: TerminalHostState,
    session: TerminalWindowSession?,
    startupCommand: String?
  ) {
    if let session, terminal.restore(from: session) {
      return
    }
    terminal.ensureInitialTab(focusing: false, startupCommand: startupCommand)
  }

  isolated deinit {
    runtimeObservers.forEach { NotificationCenter.default.removeObserver($0) }
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

  private static func applyRestoredFrame(_ frame: TerminalWindowFrame?, to window: NSWindow) {
    guard let frame else { return }
    let rect = frame.rect
    let visibleFrame =
      NSScreen.screens.first(where: { $0.visibleFrame.intersects(rect) })?.visibleFrame
      ?? NSScreen.main?.visibleFrame
      ?? rect
    window.setFrame(rect.constrained(to: visibleFrame), display: false)
  }

  private func performConfirmedWindowClose() {
    guard let window else { return }
    SupatermLog.notice(
      SupatermLog.terminal,
      "terminal.window.closeConfirmed",
      fields: [
        "terminatesSessions=\(terminatesTerminalSessionsOnClose)",
        "surfaceIDs=\(TerminalHostState.logSurfaceIDs(terminal.sessionSurfaceIDs()))",
      ]
    )
    if terminatesTerminalSessionsOnClose {
      terminal.terminateTerminalSessions()
    }
    isPerformingConfirmedClose = true
    window.close()
  }

  private func observeRuntimeAppearance() {
    let center = NotificationCenter.default
    for name in [
      Notification.Name.ghosttyRuntimeConfigDidChange,
      .ghosttyRuntimeBackgroundOpacityDidChange,
    ] {
      runtimeObservers.append(
        center.addObserver(
          forName: name,
          object: runtime,
          queue: .main
        ) { [weak self] _ in
          MainActor.assumeIsolated {
            self?.applyWindowBackgroundAppearance()
          }
        })
    }
  }

  private func applyWindowBackgroundAppearance() {
    guard let window else { return }
    let usesOpaqueBackground =
      window.styleMask.contains(.fullScreen) || runtime.backgroundOpacityOverrideIsActive()
    if !usesOpaqueBackground {
      window.isOpaque = false
      window.titlebarAppearsTransparent = true
      window.backgroundColor = .clear
      if window.isVisible, let app = runtime.app {
        ghostty_set_window_background_blur(
          app,
          Unmanaged.passUnretained(window).toOpaque()
        )
      }
      return
    }
    window.isOpaque = true
    window.titlebarAppearsTransparent = false
    window.backgroundColor = runtime.backgroundColor().withAlphaComponent(1)
  }

}

extension TerminalWindowController: NSWindowDelegate {
  func windowDidBecomeKey(_ notification: Notification) {
    applyWindowBackgroundAppearance()
    commandHoldObserver.update(modifierFlags: NSEvent.modifierFlags)
    registry.markWindowFocused(windowControllerID)
  }

  func windowDidChangeOcclusionState(_ notification: Notification) {
    applyWindowBackgroundAppearance()
  }

  func windowDidEnterFullScreen(_ notification: Notification) {
    applyWindowBackgroundAppearance()
  }

  func windowDidExitFullScreen(_ notification: Notification) {
    applyWindowBackgroundAppearance()
  }

  func windowDidResignKey(_ notification: Notification) {
    commandHoldObserver.reset()
  }

  func windowShouldClose(_ sender: NSWindow) -> Bool {
    if isPerformingConfirmedClose {
      isPerformingConfirmedClose = false
      return true
    }
    let surfaceIDs = terminal.sessionSurfaceIDs()
    guard terminatesTerminalSessionsOnClose, !surfaceIDs.isEmpty else {
      SupatermLog.notice(
        SupatermLog.terminal,
        "terminal.window.close",
        fields: [
          "terminatesSessions=\(terminatesTerminalSessionsOnClose)",
          "surfaceIDs=\(TerminalHostState.logSurfaceIDs(surfaceIDs))",
        ]
      )
      return true
    }
    _ = store.send(.terminal(.windowCloseRequested(windowID: ObjectIdentifier(sender))))
    return false
  }

  func windowWillClose(_ notification: Notification) {
    registry.updateWindow(nil, for: windowControllerID)
    onWindowWillClose?(self)
  }
}
