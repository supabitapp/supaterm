import AppKit

@MainActor
enum GhosttyUntrustedURLAlert {
  static func presentConfirmation(for url: URL, displayString: String) {
    deferPresentation {
      let workspace = NSWorkspace.shared
      let handler =
        workspace.urlForApplication(toOpen: url)
        .map { "“\($0.deletingPathExtension().lastPathComponent)”" }
        ?? "the default application"
      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.icon = NSImage(named: NSImage.cautionName)
      alert.messageText = "Open Link from Terminal Output?"
      alert.informativeText =
        "This link will open in \(handler). Only continue if you recognize and trust the destination."
      alert.accessoryView = targetView(displayString)
      alert.addButton(withTitle: "Cancel")
      alert.addButton(withTitle: "Open Link")
      present(alert) { response in
        guard response == .alertSecondButtonReturn else { return }
        workspace.open(url)
      }
    }
  }

  static func presentBlock(
    reason: GhosttyUntrustedURL.DenialReason,
    displayString: String
  ) {
    deferPresentation {
      let alert = NSAlert()
      alert.alertStyle = .warning
      alert.icon = NSImage(named: NSImage.cautionName)
      alert.messageText = "Supaterm Blocked This Link"
      alert.informativeText = reason.message
      alert.accessoryView = targetView(displayString)
      alert.addButton(withTitle: "OK")
      alert.addButton(withTitle: "Copy Link")
      present(alert) { response in
        guard response == .alertSecondButtonReturn else { return }
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(displayString, forType: .string)
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

  private static func present(
    _ alert: NSAlert,
    completion: @escaping (NSApplication.ModalResponse) -> Void
  ) {
    if let window = NSApp.keyWindow {
      alert.beginSheetModal(for: window, completionHandler: completion)
    } else {
      completion(alert.runModal())
    }
  }

  private static func targetView(_ target: String) -> NSView {
    let scrollView = NSScrollView(frame: NSRect(x: 0, y: 0, width: 480, height: 96))
    scrollView.borderType = .bezelBorder
    scrollView.hasVerticalScroller = true
    scrollView.autohidesScrollers = true

    let textView = NSTextView(frame: scrollView.contentView.bounds)
    textView.isEditable = false
    textView.isSelectable = true
    textView.isRichText = false
    textView.font = .monospacedSystemFont(
      ofSize: NSFont.systemFontSize,
      weight: .regular
    )
    textView.textContainerInset = NSSize(width: 6, height: 6)
    textView.string = target
    textView.textContainer?.widthTracksTextView = true
    textView.textContainer?.containerSize = NSSize(
      width: scrollView.contentSize.width,
      height: .greatestFiniteMagnitude
    )
    scrollView.documentView = textView
    return scrollView
  }
}
