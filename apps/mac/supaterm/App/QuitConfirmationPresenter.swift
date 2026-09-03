import AppKit
import SupaTheme
import SupatermUI
import SwiftUI

@MainActor
final class QuitConfirmationPresenter {
  func confirmQuit(
    parentWindow: NSWindow,
    terminatesSessions: Bool
  ) -> QuitConfirmationDecision {
    NSApp.unhide(nil)
    if parentWindow.isMiniaturized {
      parentWindow.deminiaturize(nil)
    }
    parentWindow.makeKeyAndOrderFront(nil)

    let presenter = DialogSurfacePresenter()
    let content = QuitConfirmationContent(terminatesSessions: terminatesSessions)
    var decision = QuitConfirmationDecision.cancel
    _ = presenter.runModal(
      over: parentWindow,
      keyDownHandler: { event in
        guard
          event.charactersIgnoringModifiers == "\r",
          let keyDecision = content.returnKeyDecision(modifierFlags: event.modifierFlags)
        else {
          return false
        }
        decision = keyDecision
        presenter.finish(with: .OK)
        return true
      }
    ) {
      QuitConfirmationOverlay(
        palette: Self.palette(for: parentWindow),
        content: content,
        onPreserve: {
          decision = .quitPreservingSessions
          presenter.finish(with: .OK)
        },
        onTerminate: {
          decision = .quitTerminatingSessions
          presenter.finish(with: .OK)
        },
        onCancel: {
          presenter.finish(with: .cancel)
        }
      )
    }
    return decision
  }

  private static func palette(for window: NSWindow) -> Palette {
    let appearance = window.contentView?.effectiveAppearance ?? window.effectiveAppearance
    let colorScheme: ColorScheme =
      appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light
    return Palette(colorScheme: colorScheme)
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
