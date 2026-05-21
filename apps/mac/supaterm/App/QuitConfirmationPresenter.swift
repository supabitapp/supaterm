import AppKit
import SwiftUI

@MainActor
final class QuitConfirmationPresenter {
  func confirmQuit(terminatesSessions: Bool) -> QuitConfirmationDecision {
    guard let panelController = panelController(terminatesSessions: terminatesSessions) else { return .cancel }
    return panelController.runModal()
  }

  private func panelController(terminatesSessions: Bool) -> QuitConfirmationPanelController? {
    guard let parentWindow = preferredParentWindow() else { return nil }
    return QuitConfirmationPanelController(parentWindow: parentWindow, terminatesSessions: terminatesSessions)
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

enum QuitConfirmationDecision: Equatable {
  case cancel
  case quitPreservingSessions
  case quitTerminatingSessions
}

struct QuitConfirmationContent: Equatable {
  let message: String
  let preservingSessionsTitle: String?
  let terminatingSessionsTitle: String

  init(terminatesSessions: Bool) {
    if terminatesSessions {
      message = "All terminal sessions will be terminated."
      preservingSessionsTitle = nil
      terminatingSessionsTitle = "Quit and Terminate Sessions"
    } else {
      message =
        "Terminal sessions will continue running in the background. "
        + "Choose Quit and Terminate Sessions to also close every tab and stop their shells."
      preservingSessionsTitle = "Quit"
      terminatingSessionsTitle = "Quit and Terminate Sessions"
    }
  }

  var buttonTitles: [String] {
    var titles = ["Cancel"]
    if let preservingSessionsTitle {
      titles.append(preservingSessionsTitle)
    }
    titles.append(terminatingSessionsTitle)
    return titles
  }
}

@MainActor
private final class QuitConfirmationPanelController: NSWindowController {
  private weak var parentWindow: NSWindow?
  private var decision = QuitConfirmationDecision.cancel

  init(parentWindow: NSWindow, terminatesSessions: Bool) {
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
      rootView: QuitConfirmationOverlay(
        palette: palette,
        content: QuitConfirmationContent(terminatesSessions: terminatesSessions),
        onPreserve: { [weak self] in
          self?.finish(.quitPreservingSessions)
        },
        onTerminate: { [weak self] in
          self?.finish(.quitTerminatingSessions)
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

  func runModal() -> QuitConfirmationDecision {
    guard let window, let parentWindow else { return .cancel }

    window.setFrame(parentWindow.frame, display: false)
    parentWindow.addChildWindow(window, ordered: .above)
    NSApp.activate(ignoringOtherApps: true)
    window.makeKeyAndOrderFront(nil)

    NSApp.runModal(for: window)
    parentWindow.removeChildWindow(window)
    window.orderOut(nil)
    return decision
  }

  private func finish(_ decision: QuitConfirmationDecision) {
    guard let window else { return }
    self.decision = decision
    NSApp.stopModal(withCode: decision == .cancel ? .cancel : .OK)
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
