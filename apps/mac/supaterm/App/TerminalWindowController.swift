import AppKit
import ComposableArchitecture
import SupaTheme
import SupatermLicenseFeature
import SupatermSupport
import SupatermUpdateFeature
import SwiftUI

enum TerminalWindowLaunch: Equatable {
  case newShell(spaceID: TerminalSpaceID?, startupCommand: SupatermTerminalStartup?)
  case restore(TerminalWindowSession)
  case tabTransferDestination(spaceID: TerminalSpaceID)

  var windowSession: TerminalWindowSession? {
    switch self {
    case .newShell, .tabTransferDestination: nil
    case .restore(let session): session
    }
  }

  var spaceID: TerminalSpaceID? {
    switch self {
    case .newShell(let spaceID, _): spaceID
    case .restore(let session): session.displayedSpaceID
    case .tabTransferDestination(let spaceID): spaceID
    }
  }
}

@MainActor
private final class TerminalGestureWindow: NSWindow {
  var onModifierFlagsChanged: ((NSEvent.ModifierFlags) -> Void)?
  var onPaletteShortcut: ((Int) -> Bool)?
  var onSwipeLeft: (() -> Void)?
  var onSwipeRight: (() -> Void)?

  override func makeKeyAndOrderFront(_ sender: Any?) {
    guard !orderBackInTestMode(sender, makeKey: true) else { return }
    super.makeKeyAndOrderFront(sender)
  }

  override func orderFront(_ sender: Any?) {
    guard !orderBackInTestMode(sender) else { return }
    super.orderFront(sender)
  }

  override func orderFrontRegardless() {
    guard !orderBackInTestMode(nil) else { return }
    super.orderFrontRegardless()
  }

  private func orderBackInTestMode(_ sender: Any?, makeKey: Bool = false) -> Bool {
    guard AppBuild.isTestMode else { return false }
    if makeKey {
      super.makeKey()
    }
    super.orderBack(sender)
    return true
  }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    if let slot = TerminalCommandPaletteShortcut.slot(for: event) {
      if onPaletteShortcut?(slot) == true { return true }
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
  private struct ShellInput {
    let commandHoldObserver: CommandHoldObserver
    let commandPaletteClient: TerminalCommandPaletteClient
    let ghosttyShortcuts: GhosttyShortcutManager
    let licenseStore: StoreOf<LicenseFeature>
    let runtime: GhosttyRuntime
    let store: StoreOf<AppFeature>
    let tabDragRegistry: TerminalTabDragRegistry
    let terminal: TerminalHostState
    let updateStore: StoreOf<UpdateFeature>
    let windowControllerID: UUID
  }

  private struct WindowInput {
    let commandHoldObserver: CommandHoldObserver
    let session: TerminalWindowSession?
    let shellController: NSViewController
    let store: StoreOf<AppFeature>
    let terminal: TerminalHostState
    let windowControllerID: UUID
  }

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
    process: Shared<AppFeature.ProcessState> = Shared(value: AppFeature.ProcessState()),
    launch: TerminalWindowLaunch = .newShell(spaceID: nil, startupCommand: nil),
    zmxClient: ZmxClient = .live,
    zmxSessionsEnabled: Bool = true,
    agentDetectionRuleRepository: AgentDetectionRuleRepository? = nil,
    onSessionChange: @escaping @MainActor () -> Void = {}
  ) {
    self.registry = registry
    let windowControllerID = UUID()
    self.windowControllerID = windowControllerID
    let session = launch.windowSession

    let terminal = TerminalHostState(
      runtime: runtime,
      spaceID: launch.spaceID,
      zmxClient: zmxClient,
      zmxSessionsEnabled: zmxSessionsEnabled,
      agentDetectionRuleRepository: agentDetectionRuleRepository,
      licenseTabGate: registry.licenseTabGate,
      licenseOpenTabCount: registry.licenseOpenTabCount
    )
    terminal.onSessionChange = onSessionChange
    Self.prepareTerminal(terminal, launch: launch)
    let commandPaletteClient = TerminalCommandPaletteClient.live(registry: registry)
    let store = Store(
      initialState: AppFeature.State(
        process: process,
        terminal: TerminalWindowFeature.State(
          sidebarWidth: session?.sidebarWidth.map { CGFloat($0) },
          windowControllerID: windowControllerID
        )
      )
    ) {
      AppFeature()
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

    let shellController = Self.makeShellController(
      ShellInput(
        commandHoldObserver: commandHoldObserver,
        commandPaletteClient: commandPaletteClient,
        ghosttyShortcuts: ghosttyShortcuts,
        licenseStore: registry.licenseStore,
        runtime: runtime,
        store: store,
        tabDragRegistry: registry.tabDragRegistry,
        terminal: terminal,
        updateStore: registry.updateStore,
        windowControllerID: windowControllerID
      )
    )

    let window = Self.makeWindow(
      WindowInput(
        commandHoldObserver: commandHoldObserver,
        session: session,
        shellController: shellController,
        store: store,
        terminal: terminal,
        windowControllerID: windowControllerID
      )
    )

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
      },
      setTerminatesTerminalSessionsOnClose: { [weak self] terminates in
        self?.terminatesTerminalSessionsOnClose = terminates
      }
    )
    registry.updateWindow(window, for: windowControllerID)
    _ = store.send(.terminal(.windowIdentifierChanged(ObjectIdentifier(window))))
  }

  private static func makeWindow(_ input: WindowInput) -> TerminalGestureWindow {
    let window = TerminalGestureWindow(
      contentRect: .zero,
      styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
      backing: .buffered,
      defer: false
    )
    window.contentViewController = input.shellController
    window.contentMinSize = NSSize(width: 1_080, height: 720)
    window.setContentSize(NSSize(width: 1_440, height: 900))
    window.identifier = NSUserInterfaceItemIdentifier(
      "\(Bundle.main.bundleIdentifier ?? "app.supabit.supaterm").window.\(input.windowControllerID.uuidString)")
    window.isReleasedWhenClosed = false
    window.tabbingMode = .disallowed
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.isOpaque = false
    window.backgroundColor = .clear
    applyRestoredFrame(input.session?.frame, to: window)
    window.onModifierFlagsChanged = {
      [commandHoldObserver = input.commandHoldObserver]
      modifierFlags in
      commandHoldObserver.update(modifierFlags: modifierFlags)
    }
    window.onPaletteShortcut = { [store = input.store] slot in
      guard store.terminal.commandPalette != nil else { return false }
      _ = store.send(.terminal(.commandPaletteSlotActivated(slot)))
      return true
    }
    configureSpaceSwipes(window, terminal: input.terminal)
    return window
  }

  private static func configureSpaceSwipes(
    _ window: TerminalGestureWindow,
    terminal: TerminalHostState
  ) {
    window.onSwipeLeft = {
      terminal.onSpaceAction(.next)
    }
    window.onSwipeRight = {
      terminal.onSpaceAction(.previous)
    }
  }

  private static func makeShellController(_ input: ShellInput) -> TerminalWindowShellController {
    let shellController = TerminalWindowShellController(
      windowControllerID: input.windowControllerID,
      tabDragRegistry: input.tabDragRegistry
    )
    shellController.onSidebarResizeInput = { [weak shellController, store = input.store] resizeInput in
      guard let shellController else { return }
      _ = store.send(
        .terminal(
          .sidebarResizeInput(resizeInput, totalWidth: shellController.view.bounds.width)
        )
      )
    }
    let detailController = NSHostingController(
      rootView: AppAppearanceView {
        GhosttyColorSchemeSyncView(ghostty: input.runtime) {
          ContentView(
            commandHoldObserver: input.commandHoldObserver,
            ghosttyShortcuts: input.ghosttyShortcuts,
            commandPaletteClient: input.commandPaletteClient,
            updateWindowShell: { [weak shellController] presentation in
              shellController?.apply(presentation)
            },
            store: input.store,
            terminal: input.terminal
          )
        }
      }
    )
    let dialogController = TerminalWindowDialogController(
      store: input.store.scope(state: \.terminal, action: \.terminal),
      terminal: input.terminal
    )
    let backgroundController = NSHostingController(
      rootView: TerminalWindowChromeBackground(terminal: input.terminal)
    )
    let sidebarController = NSHostingController(
      rootView: AppAppearanceView {
        GhosttyColorSchemeSyncView(ghostty: input.runtime) {
          TerminalSidebarContentView(
            commandHoldObserver: input.commandHoldObserver,
            ghosttyShortcuts: input.ghosttyShortcuts,
            licenseStore: input.licenseStore,
            shellState: shellController.state,
            store: input.store,
            terminal: input.terminal,
            sidebarControllerCache: shellController.sidebarControllerCache,
            spacePagingDidEnd: { [weak shellController] in
              shellController?.spacePagingDidEnd()
            },
            updateStore: input.updateStore
          )
        }
      }
    )
    shellController.isSpacePaging = { [weak terminal = input.terminal] in
      terminal?.spacePager?.isTracking == true
    }
    shellController.splitDestination = { [weak terminal = input.terminal] in
      guard
        let terminal,
        let selectedTabID = terminal.selectedTabID,
        let destinationTabID = terminal.liveTabSplitTargetTabID(
          selectedTabID,
          in: terminal.displayedSpaceID
        )
      else { return nil }
      let palette = terminal.chromePalette(
        appearanceMode: terminal.supatermSettings.appearanceMode
      )
      return TerminalTabSplitDropDestination(
        spaceID: terminal.displayedSpaceID,
        tabID: destinationTabID,
        color: palette.accent
      )
    }
    shellController.install(
      background: backgroundController,
      sidebar: sidebarController,
      detail: detailController,
      dialogOverlay: dialogController
    )
    return shellController
  }

  private static func prepareTerminal(
    _ terminal: TerminalHostState,
    launch: TerminalWindowLaunch
  ) {
    switch launch {
    case .newShell(_, let startupCommand):
      terminal.ensureInitialTab(focusing: false, startupCommand: startupCommand)
    case .restore(let session):
      if !terminal.restore(from: session), session.surfaceIDs.isEmpty {
        terminal.ensureInitialTab(
          focusing: false,
          startupCommand: nil,
          reason: .restore
        )
      }
    case .tabTransferDestination:
      break
    }
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
        "surfaceIDs=\(TerminalHostState.logSurfaceIDs(terminal.sessionSurfaceIDs()))",
      ]
    )
    if terminatesTerminalSessionsOnClose {
      terminal.terminateTerminalSessions()
    }
    isPerformingConfirmedClose = true
    window.close()
  }

}

extension TerminalWindowController: NSWindowDelegate {
  func windowDidBecomeKey(_ notification: Notification) {
    commandHoldObserver.update(modifierFlags: NSEvent.modifierFlags)
    registry.markWindowFocused(windowControllerID)
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
