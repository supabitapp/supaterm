import AppKit
import SupatermUI
import SwiftUI

@MainActor
enum GhosttyUntrustedURLAlert {
  static func presentConfirmation(for url: URL, displayString: String) {
    deferPresentation {
      let workspace = NSWorkspace.shared
      let handler =
        workspace.urlForApplication(toOpen: url)
        .map { "“\($0.deletingPathExtension().lastPathComponent)”" }
        ?? "the default application"
      let presenter = DialogSurfacePresenter()
      presenter.present(over: NSApp.keyWindow) {
        GhosttyUntrustedURLConfirmationDialog(
          handler: handler,
          target: displayString,
          onOpen: {
            presenter.dismiss()
            workspace.open(url)
          },
          onCancel: {
            presenter.dismiss()
          }
        )
      }
    }
  }

  static func presentBlock(
    reason: GhosttyUntrustedURL.DenialReason,
    displayString: String
  ) {
    deferPresentation {
      let presenter = DialogSurfacePresenter()
      presenter.present(over: NSApp.keyWindow) {
        GhosttyBlockedURLDialog(
          message: reason.message,
          target: displayString,
          onCopy: {
            let pasteboard = NSPasteboard.general
            pasteboard.clearContents()
            pasteboard.setString(displayString, forType: .string)
            presenter.dismiss()
          },
          onDismiss: {
            presenter.dismiss()
          }
        )
      }
    }
  }

  private static func deferPresentation(
    _ action: @escaping @MainActor @Sendable () -> Void
  ) {
    DispatchQueue.main.async {
      action()
    }
  }

}

struct GhosttyUntrustedURLConfirmationDialog: View {
  let handler: String
  let target: String
  let onOpen: () -> Void
  let onCancel: () -> Void

  var body: some View {
    DialogSurface(
      title: "Open Link from Terminal Output?",
      message:
        "This link will open in \(handler). Only continue if you recognize and trust the destination.",
      icon: .system("link", tone: .warning),
      layout: DialogSurfaceLayout(width: 500),
      actions: [
        DialogSurfaceAction(
          id: "cancel",
          title: "Cancel",
          role: .secondary,
          shortcut: .cancel,
          accessibilityIdentifier: "dialog.cancel",
          action: onCancel
        ),
        DialogSurfaceAction(
          id: "open",
          title: "Open Link",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onOpen
        ),
      ],
      scrimLabel: "Cancel opening link",
      onDismiss: onCancel
    ) {
      GhosttyLinkTargetPreview(target: target)
    }
  }
}

struct GhosttyBlockedURLDialog: View {
  let message: String
  let target: String
  let onCopy: () -> Void
  let onDismiss: () -> Void

  var body: some View {
    DialogSurface(
      title: "Supaterm Blocked This Link",
      message: message,
      icon: .system("hand.raised.fill", tone: .warning),
      layout: DialogSurfaceLayout(width: 500),
      actions: [
        DialogSurfaceAction(
          id: "copy",
          title: "Copy Link",
          role: .secondary,
          action: onCopy
        ),
        DialogSurfaceAction(
          id: "dismiss",
          title: "OK",
          role: .primary,
          shortcut: .default,
          accessibilityIdentifier: "dialog.confirm",
          action: onDismiss
        ),
      ],
      onDismiss: onDismiss
    ) {
      GhosttyLinkTargetPreview(target: target)
    }
  }
}

private struct GhosttyLinkTargetPreview: View {
  let target: String

  var body: some View {
    DialogTextPreview(
      target,
      minimumHeight: 72,
      maximumHeight: 96,
      accessibilityIdentifier: "dialog.link-target"
    )
  }
}
