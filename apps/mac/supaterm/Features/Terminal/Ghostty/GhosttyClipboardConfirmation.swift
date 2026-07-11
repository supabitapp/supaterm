import AppKit
import GhosttyKit

enum GhosttyClipboardConfirmationRequest {
  case paste
  case osc52Read
  case osc52Write

  init?(_ request: ghostty_clipboard_request_e) {
    switch request {
    case GHOSTTY_CLIPBOARD_REQUEST_PASTE:
      self = .paste
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ:
      self = .osc52Read
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE:
      self = .osc52Write
    default:
      return nil
    }
  }
}

@MainActor
final class GhosttyClipboardConfirmationCoordinator {
  private struct Presentation {
    let title: String
    let message: String
    let cancelTitle: String
    let confirmTitle: String
  }

  private final class PendingRequest {
    let surface: GhosttyRuntime.SurfaceReference
    let window: NSWindow
    let alert: NSAlert
    let completion: (Bool) -> Void
    weak var view: GhosttySurfaceView?
    var windowCloseObserver: NSObjectProtocol?

    init(
      surface: GhosttyRuntime.SurfaceReference,
      window: NSWindow,
      alert: NSAlert,
      view: GhosttySurfaceView,
      completion: @escaping (Bool) -> Void
    ) {
      self.surface = surface
      self.window = window
      self.alert = alert
      self.view = view
      self.completion = completion
    }
  }

  private var pendingRequests: [ObjectIdentifier: PendingRequest] = [:]

  func present(
    contents: String,
    request: GhosttyClipboardConfirmationRequest,
    surface: GhosttyRuntime.SurfaceReference,
    view: GhosttySurfaceView,
    completion: @escaping (Bool) -> Void
  ) {
    guard
      let window = view.window,
      window.isVisible,
      window.firstResponder === view
    else {
      completion(false)
      return
    }

    let key = ObjectIdentifier(window)
    guard pendingRequests[key] == nil, window.attachedSheet == nil else {
      completion(false)
      return
    }

    let alert = Self.alert(contents: contents, request: request)
    let pending = PendingRequest(
      surface: surface,
      window: window,
      alert: alert,
      view: view,
      completion: completion
    )
    pendingRequests[key] = pending
    pending.windowCloseObserver = NotificationCenter.default.addObserver(
      forName: NSWindow.willCloseNotification,
      object: window,
      queue: .main
    ) { [weak self, weak pending] _ in
      MainActor.assumeIsolated {
        guard let self, let pending else { return }
        self.finish(pending, allowed: false, dismissSheet: false)
      }
    }
    alert.beginSheetModal(for: window) { [weak self, weak pending] response in
      guard let self, let pending else { return }
      self.finish(
        pending,
        allowed: response == .alertFirstButtonReturn,
        dismissSheet: false
      )
    }
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    let matching = pendingRequests.values.filter { $0.surface === surface }
    for pending in matching {
      finish(pending, allowed: false, dismissSheet: true)
    }
  }

  func cancelAll() {
    for pending in Array(pendingRequests.values) {
      finish(pending, allowed: false, dismissSheet: true)
    }
  }

  private func finish(
    _ pending: PendingRequest,
    allowed: Bool,
    dismissSheet: Bool
  ) {
    let key = ObjectIdentifier(pending.window)
    guard pendingRequests.removeValue(forKey: key) === pending else { return }
    if let observer = pending.windowCloseObserver {
      NotificationCenter.default.removeObserver(observer)
      pending.windowCloseObserver = nil
    }
    if dismissSheet, pending.alert.window.sheetParent != nil {
      pending.window.endSheet(pending.alert.window)
    }
    pending.completion(
      allowed && pending.surface.isValid && pending.view?.window === pending.window
    )
  }

  private static func alert(
    contents: String,
    request: GhosttyClipboardConfirmationRequest
  ) -> NSAlert {
    let presentation = presentation(for: request)
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = presentation.title
    alert.informativeText = presentation.message

    let scrollView = NSTextView.scrollableTextView()
    scrollView.frame = NSRect(x: 0, y: 0, width: 480, height: 180)
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = false
    let preview = scrollView.documentView as? NSTextView
    preview?.isEditable = false
    preview?.isSelectable = true
    preview?.isRichText = false
    preview?.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    preview?.string = contents
    alert.accessoryView = scrollView

    let confirmButton = alert.addButton(withTitle: presentation.confirmTitle)
    confirmButton.keyEquivalent = "\r"
    let cancelButton = alert.addButton(withTitle: presentation.cancelTitle)
    cancelButton.keyEquivalent = "\u{1b}"
    return alert
  }

  private static func presentation(
    for request: GhosttyClipboardConfirmationRequest
  ) -> Presentation {
    let message: String
    switch request {
    case .paste:
      return Presentation(
        title: "Warning: Potentially Unsafe Paste",
        message: "Pasting this text may execute multiple commands.",
        cancelTitle: "Cancel",
        confirmTitle: "Paste"
      )
    case .osc52Read:
      message = "A terminal application is attempting to read from the clipboard."
    case .osc52Write:
      message = "A terminal application is attempting to write to the clipboard."
    }
    return Presentation(
      title: "Authorize Clipboard Access",
      message: message,
      cancelTitle: "Deny",
      confirmTitle: "Allow"
    )
  }
}
