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

  var title: String {
    switch self {
    case .paste:
      "Warning: Potentially Unsafe Paste"
    case .osc52Read, .osc52Write:
      "Authorize Clipboard Access"
    }
  }

  var message: String {
    switch self {
    case .paste:
      "Pasting this text may execute multiple commands."
    case .osc52Read:
      "A terminal application is attempting to read from the clipboard."
    case .osc52Write:
      "A terminal application is attempting to write to the clipboard."
    }
  }

  var cancelTitle: String {
    switch self {
    case .paste:
      "Cancel"
    case .osc52Read, .osc52Write:
      "Deny"
    }
  }

  var confirmTitle: String {
    switch self {
    case .paste:
      "Paste"
    case .osc52Read, .osc52Write:
      "Allow"
    }
  }
}

@MainActor
final class GhosttyClipboardConfirmationCoordinator {
  private final class PendingRequest {
    let key: ObjectIdentifier
    let surface: GhosttyRuntime.SurfaceReference
    let window: NSWindow
    let alert: NSAlert
    let completion: (Bool) -> Void
    weak var view: GhosttySurfaceView?
    var windowCloseObserver: NSObjectProtocol?

    init(
      key: ObjectIdentifier,
      surface: GhosttyRuntime.SurfaceReference,
      window: NSWindow,
      alert: NSAlert,
      view: GhosttySurfaceView,
      completion: @escaping (Bool) -> Void
    ) {
      self.key = key
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
    guard let window = view.window, window.isVisible else {
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
      key: key,
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
    guard pendingRequests.removeValue(forKey: pending.key) === pending else { return }
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
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = request.title
    alert.informativeText = request.message

    let preview = NSTextField(wrappingLabelWithString: contents)
    preview.frame = NSRect(x: 0, y: 0, width: 480, height: 180)
    preview.isSelectable = true
    preview.font = .monospacedSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
    alert.accessoryView = preview

    let confirmButton = alert.addButton(withTitle: request.confirmTitle)
    confirmButton.keyEquivalent = "\r"
    let cancelButton = alert.addButton(withTitle: request.cancelTitle)
    cancelButton.keyEquivalent = "\u{1b}"
    return alert
  }
}
