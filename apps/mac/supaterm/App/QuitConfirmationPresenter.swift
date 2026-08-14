import AppKit
import SupaTheme
import SwiftUI

@MainActor
final class QuitConfirmationPresenter {
  func confirmQuit(
    parentWindow: NSWindow,
    palette: Palette,
    terminatesSessions: Bool
  ) -> QuitConfirmationDecision {
    NSApp.unhide(nil)
    if parentWindow.isMiniaturized {
      parentWindow.deminiaturize(nil)
    }
    parentWindow.makeKeyAndOrderFront(nil)
    return QuitConfirmationPanelController(
      parentWindow: parentWindow,
      palette: palette,
      terminatesSessions: terminatesSessions
    ).runModal()
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
    var titles = ["Cancel", terminatingSessionsTitle]
    if let preservingSessionsTitle {
      titles.append(preservingSessionsTitle)
    }
    return titles
  }

  func returnKeyDecision(modifierFlags: NSEvent.ModifierFlags) -> QuitConfirmationDecision? {
    let modifiers = modifierFlags.intersection([.shift, .control, .option, .command])
    guard modifiers.isSubset(of: [.shift]) else { return nil }
    if modifiers.contains(.shift) {
      return .quitTerminatingSessions
    }
    return preservingSessionsTitle == nil ? .quitTerminatingSessions : .quitPreservingSessions
  }
}

@MainActor
private final class QuitConfirmationPanelController: NSWindowController {
  private weak var parentWindow: NSWindow?
  private var decision = QuitConfirmationDecision.cancel

  init(parentWindow: NSWindow, palette: Palette, terminatesSessions: Bool) {
    self.parentWindow = parentWindow

    let window = QuitConfirmationPanel(
      contentRect: parentWindow.frame,
      styleMask: [.borderless],
      backing: .buffered,
      defer: false
    )
    window.appearance = parentWindow.appearance

    super.init(window: window)

    let content = QuitConfirmationContent(terminatesSessions: terminatesSessions)
    window.onReturnKey = { [weak self] modifierFlags in
      guard let decision = content.returnKeyDecision(modifierFlags: modifierFlags) else {
        return false
      }
      self?.finish(decision)
      return true
    }

    window.contentViewController = NSHostingController(
      rootView: QuitConfirmationOverlay(
        palette: palette,
        content: content,
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
      .environment(\.colorScheme, palette.colorScheme)
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

}

private final class QuitConfirmationPanel: NSPanel {
  var onReturnKey: ((NSEvent.ModifierFlags) -> Bool)?

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

  override func keyDown(with event: NSEvent) {
    guard event.charactersIgnoringModifiers == "\r" else {
      super.keyDown(with: event)
      return
    }
    guard onReturnKey?(event.modifierFlags) == true else {
      super.keyDown(with: event)
      return
    }
  }
}
