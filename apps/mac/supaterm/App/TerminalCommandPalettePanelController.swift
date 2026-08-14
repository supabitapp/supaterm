import AppKit
import SupaTheme
import SwiftUI

struct TerminalCommandPalettePanelConfiguration {
  let commandHoldObserver: CommandHoldObserver
  let matches: [TerminalCommandPaletteMatch]
  let palette: Palette
  let state: TerminalCommandPaletteState
  let activate: () -> Void
  let activateSlot: (Int) -> Void
  let close: () -> Void
  let moveSelection: (Int) -> Void
  let queryChanged: (String) -> Void
  let selectionChanged: (Int) -> Void
}

struct TerminalCommandPalettePanelPresenter: NSViewRepresentable {
  let configuration: TerminalCommandPalettePanelConfiguration

  func makeCoordinator() -> Coordinator {
    Coordinator()
  }

  func makeNSView(context: Context) -> TerminalCommandPalettePanelAnchorView {
    let view = TerminalCommandPalettePanelAnchorView()
    view.windowChanged = { [weak coordinator = context.coordinator, weak view] in
      guard let view else { return }
      coordinator?.apply(to: view.window)
    }
    return view
  }

  func updateNSView(_ view: TerminalCommandPalettePanelAnchorView, context: Context) {
    context.coordinator.configuration = configuration
    context.coordinator.apply(to: view.window)
  }

  static func dismantleNSView(
    _ view: TerminalCommandPalettePanelAnchorView,
    coordinator: Coordinator
  ) {
    view.windowChanged = nil
    coordinator.dismiss()
  }

  @MainActor
  final class Coordinator {
    var configuration: TerminalCommandPalettePanelConfiguration?
    private let controller = TerminalCommandPalettePanelController()

    func apply(to parentWindow: NSWindow?) {
      guard let configuration, let parentWindow else { return }
      controller.present(configuration, from: parentWindow)
    }

    func dismiss() {
      controller.dismiss()
    }
  }
}

@MainActor
final class TerminalCommandPalettePanelAnchorView: NSView {
  var windowChanged: (() -> Void)?

  override func viewDidMoveToWindow() {
    super.viewDidMoveToWindow()
    windowChanged?()
  }
}

@MainActor
final class TerminalCommandPalettePanelController: NSObject, NSWindowDelegate {
  private var configuration: TerminalCommandPalettePanelConfiguration?
  private var frameObservers: [NSObjectProtocol] = []
  private var hostingController: NSHostingController<TerminalCommandPalettePanelRoot>?
  private weak var parentWindow: NSWindow?
  private var panel: TerminalCommandPalettePanel?

  func present(
    _ configuration: TerminalCommandPalettePanelConfiguration,
    from parentWindow: NSWindow
  ) {
    self.configuration = configuration
    if self.parentWindow !== parentWindow {
      dismissPanel()
      self.parentWindow = parentWindow
    }
    let rootView = TerminalCommandPalettePanelRoot(
      configuration: configuration,
      activate: { [weak self] in self?.activateSelection() }
    )
    if let hostingController, let panel {
      hostingController.rootView = rootView
      panel.appearance = parentWindow.appearance
      updateFrame(panel, parentWindow: parentWindow)
      return
    }
    let hostingController = NSHostingController(rootView: rootView)
    let panel = TerminalCommandPalettePanel(contentViewController: hostingController)
    panel.onPaletteShortcut = { [weak self] slot in
      self?.activateSlot(slot)
    }
    panel.delegate = self
    panel.appearance = parentWindow.appearance
    updateFrame(panel, parentWindow: parentWindow)
    parentWindow.addChildWindow(panel, ordered: .above)
    observeFrame(of: parentWindow)
    self.hostingController = hostingController
    self.panel = panel
    panel.makeKeyAndOrderFront(nil)
  }

  func dismiss() {
    configuration = nil
    dismissPanel()
  }

  private func activateSelection() {
    guard let activate = configuration?.activate else { return }
    dismissAndRun(activate)
  }

  func windowDidResignKey(_ notification: Notification) {
    configuration?.close()
  }

  private func activateSlot(_ slot: Int) {
    guard let activateSlot = configuration?.activateSlot else { return }
    dismissAndRun { activateSlot(slot) }
  }

  private func dismissAndRun(_ action: () -> Void) {
    configuration = nil
    dismissPanel()
    action()
  }

  private func dismissPanel() {
    for observer in frameObservers {
      NotificationCenter.default.removeObserver(observer)
    }
    frameObservers.removeAll()
    if let panel {
      parentWindow?.removeChildWindow(panel)
      panel.orderOut(nil)
    }
    hostingController = nil
    panel = nil
    parentWindow = nil
  }

  private func observeFrame(of parentWindow: NSWindow) {
    let center = NotificationCenter.default
    frameObservers = [NSWindow.didMoveNotification, NSWindow.didResizeNotification].map {
      center.addObserver(forName: $0, object: parentWindow, queue: .main) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let self, let panel = self.panel else { return }
          self.updateFrame(panel, parentWindow: parentWindow)
        }
      }
    }
  }

  private func updateFrame(_ panel: NSPanel, parentWindow: NSWindow) {
    guard let contentView = parentWindow.contentView else {
      panel.setFrame(parentWindow.frame, display: false)
      return
    }
    let contentFrame = contentView.convert(contentView.bounds, to: nil)
    panel.setFrame(parentWindow.convertToScreen(contentFrame), display: false)
  }
}

@MainActor
final class TerminalCommandPalettePanel: NSPanel {
  var onPaletteShortcut: ((Int) -> Void)?

  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  override func performKeyEquivalent(with event: NSEvent) -> Bool {
    guard let slot = TerminalCommandPaletteShortcut.slot(for: event) else {
      return super.performKeyEquivalent(with: event)
    }
    onPaletteShortcut?(slot)
    return true
  }

  init(contentViewController: NSViewController) {
    super.init(
      contentRect: .zero,
      styleMask: [.borderless, .nonactivatingPanel],
      backing: .buffered,
      defer: false
    )
    self.contentViewController = contentViewController
    animationBehavior = .none
    backgroundColor = .clear
    collectionBehavior = [.fullScreenAuxiliary, .transient, .ignoresCycle]
    hasShadow = false
    hidesOnDeactivate = true
    isFloatingPanel = true
    isOpaque = false
    isReleasedWhenClosed = false
  }
}

enum TerminalCommandPaletteShortcut {
  static func slot(for event: NSEvent) -> Int? {
    guard event.type == .keyDown else { return nil }
    guard event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command else {
      return nil
    }
    guard let characters = event.charactersIgnoringModifiers else { return nil }
    guard let slot = Int(characters), (1...9).contains(slot) else { return nil }
    return slot
  }
}

private struct TerminalCommandPalettePanelRoot: View {
  let configuration: TerminalCommandPalettePanelConfiguration
  let activate: () -> Void

  var body: some View {
    TerminalCommandPaletteOverlay(
      palette: configuration.palette,
      state: configuration.state,
      matches: configuration.matches,
      onActivate: activate,
      onClose: configuration.close,
      onQueryChange: configuration.queryChanged,
      onMoveSelection: configuration.moveSelection,
      onSelectionChange: configuration.selectionChanged
    )
    .environment(configuration.commandHoldObserver)
  }
}
