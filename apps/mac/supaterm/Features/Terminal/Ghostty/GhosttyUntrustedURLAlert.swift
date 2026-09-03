import AppKit
import SupatermUI

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
              accessibilityIdentifier: "dialog.cancel"
            ) {
              presenter.dismiss()
            },
            DialogSurfaceAction(
              id: "open",
              title: "Open Link",
              role: .primary,
              shortcut: .default,
              accessibilityIdentifier: "dialog.confirm"
            ) {
              presenter.dismiss()
              workspace.open(url)
            },
          ],
          scrimLabel: "Cancel opening link",
          onDismiss: {
            presenter.dismiss()
          }
        ) {
          targetPreview(displayString)
        }
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
        DialogSurface(
          title: "Supaterm Blocked This Link",
          message: reason.message,
          icon: .system("hand.raised.fill", tone: .warning),
          layout: DialogSurfaceLayout(width: 500),
          actions: [
            DialogSurfaceAction(
              id: "copy",
              title: "Copy Link",
              role: .secondary
            ) {
              let pasteboard = NSPasteboard.general
              pasteboard.clearContents()
              pasteboard.setString(displayString, forType: .string)
              presenter.dismiss()
            },
            DialogSurfaceAction(
              id: "dismiss",
              title: "OK",
              role: .primary,
              shortcut: .default,
              accessibilityIdentifier: "dialog.confirm"
            ) {
              presenter.dismiss()
            },
          ],
          onDismiss: {
            presenter.dismiss()
          }
        ) {
          targetPreview(displayString)
        }
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

  private static func targetPreview(_ target: String) -> DialogTextPreview {
    DialogTextPreview(
      target,
      minimumHeight: 72,
      maximumHeight: 96,
      accessibilityIdentifier: "dialog.link-target"
    )
  }
}
