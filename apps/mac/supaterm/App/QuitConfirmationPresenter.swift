import AppKit
import SwiftUI

@MainActor
final class QuitConfirmationPresenter {
  func confirmQuit() -> Bool {
    guard let panelController = panelController() else { return false }
    return panelController.runModal()
  }

  private func panelController() -> QuitConfirmationPanelController? {
    guard let parentWindow = preferredParentWindow() else { return nil }
    return QuitConfirmationPanelController(parentWindow: parentWindow)
  }

  private func preferredParentWindow() -> NSWindow? {
    let candidates = [
      NSApp.keyWindow,
      NSApp.mainWindow,
      NSApp.orderedWindows.first(where: isPresentable),
    ]
    return candidates.compactMap { $0 }.first(where: isPresentable)
  }

  private func isPresentable(_ window: NSWindow) -> Bool {
    window.isVisible && !window.isMiniaturized
  }
}

@MainActor
private final class QuitConfirmationPanelController: NSWindowController {
  private weak var parentWindow: NSWindow?

  init(parentWindow: NSWindow) {
    self.parentWindow = parentWindow

    let window = QuitConfirmationPanel(
      contentRect: parentWindow.frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )

    super.init(window: window)

    let palette = TerminalPalette(colorScheme: Self.colorScheme(for: parentWindow))
    window.contentViewController = NSHostingController(
      rootView: QuitConfirmationView(
        palette: palette,
        onConfirm: { [weak self] in
          self?.finish(.OK)
        },
        onCancel: { [weak self] in
          self?.finish(.cancel)
        }
      )
    )
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func runModal() -> Bool {
    guard let window, let parentWindow else { return false }

    window.setFrame(parentWindow.frame, display: false)
    parentWindow.addChildWindow(window, ordered: .above)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)

    let response = NSApp.runModal(for: window)
    parentWindow.removeChildWindow(window)
    window.orderOut(nil)
    return response == .OK
  }

  private func finish(_ response: NSApplication.ModalResponse) {
    guard let window else { return }
    NSApp.stopModal(withCode: response)
    window.orderOut(nil)
  }

  private static func colorScheme(for window: NSWindow) -> ColorScheme {
    let appearance = window.contentView?.effectiveAppearance ?? window.effectiveAppearance
    return appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
  }
}

private final class QuitConfirmationPanel: NSPanel {
  override var canBecomeKey: Bool { true }
  override var canBecomeMain: Bool { false }

  override init(
    contentRect: NSRect,
    styleMask style: NSWindow.StyleMask,
    backing backingStoreType: NSWindow.BackingStoreType,
    defer flag: Bool
  ) {
    super.init(
      contentRect: contentRect,
      styleMask: style,
      backing: backingStoreType,
      defer: flag
    )
    backgroundColor = .clear
    hasShadow = false
    isMovable = false
    isOpaque = false
    collectionBehavior = [.fullScreenAuxiliary, .moveToActiveSpace, .ignoresCycle]
    level = .modalPanel
  }
}

private struct QuitConfirmationView: View {
  let palette: TerminalPalette
  let onConfirm: () -> Void
  let onCancel: () -> Void

  var body: some View {
    TerminalConfirmationOverlay(
      palette: palette,
      title: "Quit Supaterm?",
      message: "All terminal sessions will be terminated.",
      confirmTitle: "Quit Supaterm",
      onConfirm: onConfirm,
      onCancel: onCancel
    )
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background(.clear)
  }
}
