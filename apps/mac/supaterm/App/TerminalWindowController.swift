import AppKit
import ComposableArchitecture
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

  private let registry: TerminalWindowRegistry
  private let commandHoldObserver: CommandHoldObserver
  private var isPerformingConfirmedClose = false
  private var terminatesTerminalSessionsOnClose = true

  init(
    runtime: GhosttyRuntime,
    registry: TerminalWindowRegistry,
    session: TerminalWindowSession? = nil,
    startupCommand: String? = nil,
    zmxClient: ZmxClient = .live,
    zmxSessionsEnabled: Bool = true,
    onSessionChange: @escaping @MainActor () -> Void = {}
  ) {
    self.registry = registry
    let windowControllerID = UUID()
    self.windowControllerID = windowControllerID

    let terminal = TerminalHostState(
      runtime: runtime,
      zmxClient: zmxClient,
      zmxSessionsEnabled: zmxSessionsEnabled,
      windowControllerID: windowControllerID
    )
    terminal.onSessionChange = onSessionChange
    if let session {
      _ = terminal.restore(from: session)
    }
    let commandPaletteClient = TerminalCommandPaletteClient.live(registry: registry)
    let store = Self.makeStore(
      commandPaletteClient: commandPaletteClient,
      registry: registry,
      session: session,
      startupCommand: startupCommand,
      terminal: terminal
    )
    let ghosttyShortcuts = GhosttyShortcutManager(runtime: runtime)
    let commandHoldObserver = CommandHoldObserver()

    self.commandHoldObserver = commandHoldObserver
    self.terminal = terminal
    self.store = store

    let contentViewController = NSHostingController(
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
    let window = Self.makeWindow(
      contentViewController: contentViewController,
      frame: session?.frame,
      windowControllerID: windowControllerID
    )

    super.init(window: window)

    configure(window, ghosttyShortcuts: ghosttyShortcuts)
  }

  private static func makeStore(
    commandPaletteClient: TerminalCommandPaletteClient,
    registry: TerminalWindowRegistry,
    session: TerminalWindowSession?,
    startupCommand: String?,
    terminal: TerminalHostState
  ) -> StoreOf<AppFeature> {
    Store(
      initialState: AppFeature.State(
        terminal: TerminalWindowFeature.State(
          collapsedProjectIDs: session?.collapsedProjectIDs ?? [],
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
  }

  private static func makeWindow(
    contentViewController: NSViewController,
    frame: TerminalWindowFrame?,
    windowControllerID: UUID
  ) -> TerminalGestureWindow {
    let window = TerminalGestureWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1_440, height: 900),
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = contentViewController
    window.contentMinSize = NSSize(width: 1_080, height: 720)
    window.identifier = NSUserInterfaceItemIdentifier(
      "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").window.\(windowControllerID.uuidString)")
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.title = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "Supaterm"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    applyRestoredFrame(frame, to: window)
    return window
  }

  private func configure(
    _ window: TerminalGestureWindow,
    ghosttyShortcuts: GhosttyShortcutManager
  ) {
    window.onModifierFlagsChanged = { [commandHoldObserver] modifierFlags in
      commandHoldObserver.update(modifierFlags: modifierFlags)
    }
    window.onPaletteShortcut = { [store] slot in
      guard store.terminal.commandPalette != nil else { return false }
      _ = store.send(.terminal(.commandPaletteSlotActivated(slot)))
      return true
    }
    window.onSwipeLeft = { [store] in
      _ = store.send(.terminal(.nextSpaceRequested))
    }
    window.onSwipeRight = { [store] in
      _ = store.send(.terminal(.previousSpaceRequested))
    }
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
      },
      setTerminatesTerminalSessionsOnClose: { [weak self] terminates in
        self?.terminatesTerminalSessionsOnClose = terminates
      }
    )
    registry.updateWindow(window, for: windowControllerID)
    terminal.onProjectDirectoryPickerRequest = { [weak self, weak terminal] in
      guard let terminal, let spaceID = terminal.selectedSpaceID else { return }
      TerminalProjectDirectoryPicker.chooseDirectories(for: self?.window) { [weak terminal] urls in
        guard let terminal, !urls.isEmpty else { return }
        do {
          _ = try terminal.createProjects(directoryURLs: urls, in: spaceID)
        } catch {
          TerminalProjectDirectoryPicker.present(error, for: self?.window)
        }
      }
    }
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
        "surfaceIDs=\(TerminalHostState.logSurfaceIDs(terminal.liveSurfaceIDs()))",
      ]
    )
    if terminatesTerminalSessionsOnClose {
      terminal.terminateLiveTerminalSessions()
    }
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
    let surfaceIDs = terminal.liveSurfaceIDs()
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
