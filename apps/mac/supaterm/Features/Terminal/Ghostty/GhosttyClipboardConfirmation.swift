import AppKit
import GhosttyKit

enum GhosttyClipboardConfirmationRequest: Equatable {
  case paste
  case osc52Read
  case osc52Write
  case kittyRead
  case kittyWrite

  init?(_ request: ghostty_clipboard_request_e) {
    switch request {
    case GHOSTTY_CLIPBOARD_REQUEST_PASTE:
      self = .paste
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_READ:
      self = .osc52Read
    case GHOSTTY_CLIPBOARD_REQUEST_OSC_52_WRITE:
      self = .osc52Write
    case GHOSTTY_CLIPBOARD_REQUEST_KITTY_READ:
      self = .kittyRead
    case GHOSTTY_CLIPBOARD_REQUEST_KITTY_WRITE:
      self = .kittyWrite
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

  private struct Alert {
    let alert: NSAlert
    let rememberButton: NSButton?
  }

  private final class PendingRequest {
    let surface: GhosttyRuntime.SurfaceReference
    let window: NSWindow
    let alert: NSAlert
    let rememberButton: NSButton?
    let completion: (Bool, Bool) -> Void
    weak var view: GhosttySurfaceView?
    var windowCloseObserver: NSObjectProtocol?

    init(
      surface: GhosttyRuntime.SurfaceReference,
      window: NSWindow,
      alert: Alert,
      view: GhosttySurfaceView,
      completion: @escaping (Bool, Bool) -> Void
    ) {
      self.surface = surface
      self.window = window
      self.alert = alert.alert
      self.rememberButton = alert.rememberButton
      self.view = view
      self.completion = completion
    }
  }

  private var pendingRequests: [ObjectIdentifier: PendingRequest] = [:]

  func present(
    payload: GhosttyClipboardConfirmationPayload,
    request: GhosttyClipboardConfirmationRequest,
    surface: GhosttyRuntime.SurfaceReference,
    view: GhosttySurfaceView,
    completion: @escaping (Bool, Bool) -> Void
  ) -> Bool {
    guard
      let window = view.window,
      window.isVisible,
      window.firstResponder === view
    else {
      reject(completion)
      return false
    }

    let key = ObjectIdentifier(window)
    guard pendingRequests[key] == nil, window.attachedSheet == nil else {
      reject(completion)
      return false
    }

    let alert = Self.alert(
      contents: payload.preview,
      previewImage: payload.previewImage,
      request: request,
      programName: payload.programName,
      canRemember: payload.canRemember
    )
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
        self.finish(pending, allowed: false, remember: false, dismissSheet: false)
      }
    }
    alert.alert.beginSheetModal(for: window) { [weak self, weak pending] response in
      guard let self, let pending else { return }
      let allowed = response == .alertFirstButtonReturn
      self.finish(
        pending,
        allowed: allowed,
        remember: allowed && pending.rememberButton?.state == .on,
        dismissSheet: false
      )
    }
    return true
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    let matching = pendingRequests.values.filter { $0.surface === surface }
    for pending in matching {
      finish(pending, allowed: false, remember: false, dismissSheet: true)
    }
  }

  func cancelAll() {
    for pending in Array(pendingRequests.values) {
      finish(pending, allowed: false, remember: false, dismissSheet: true)
    }
  }

  private func finish(
    _ pending: PendingRequest,
    allowed: Bool,
    remember: Bool,
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
    let valid = pending.surface.isValid && pending.view?.window === pending.window
    pending.completion(allowed && valid, remember && allowed && valid)
  }

  private func reject(_ completion: @escaping (Bool, Bool) -> Void) {
    completion(false, false)
  }

  private static func alert(
    contents: String,
    previewImage: NSImage?,
    request: GhosttyClipboardConfirmationRequest,
    programName: String?,
    canRemember: Bool
  ) -> Alert {
    let presentation = presentation(for: request, programName: programName)
    let alert = NSAlert()
    alert.alertStyle = .warning
    alert.messageText = presentation.title
    alert.informativeText = presentation.message

    let preview = preview(contents: contents, image: previewImage)

    let rememberButton: NSButton?
    if canRemember {
      let button = NSButton(
        checkboxWithTitle: "Remember this choice for the session",
        target: nil,
        action: nil
      )
      button.frame = NSRect(x: 0, y: 0, width: 480, height: 24)
      button.setAccessibilityIdentifier("terminal.clipboard-confirmation.remember")
      rememberButton = button
      preview.frame.origin.y = 32
      let accessory = NSView(
        frame: NSRect(x: 0, y: 0, width: 480, height: preview.frame.height + 32)
      )
      accessory.addSubview(preview)
      accessory.addSubview(button)
      alert.accessoryView = accessory
    } else {
      rememberButton = nil
      alert.accessoryView = preview
    }

    let confirmButton = alert.addButton(withTitle: presentation.confirmTitle)
    confirmButton.setAccessibilityIdentifier("terminal.clipboard-confirmation.confirm")
    confirmButton.keyEquivalent = "\r"
    let cancelButton = alert.addButton(withTitle: presentation.cancelTitle)
    cancelButton.setAccessibilityIdentifier("terminal.clipboard-confirmation.cancel")
    cancelButton.keyEquivalent = "\u{1b}"
    return Alert(alert: alert, rememberButton: rememberButton)
  }

  private static func preview(contents: String, image: NSImage?) -> NSView {
    let scrollView = NSTextView.scrollableTextView()
    scrollView.hasVerticalScroller = true
    scrollView.hasHorizontalScroller = false
    let textView = scrollView.documentView as? NSTextView
    textView?.isEditable = false
    textView?.isSelectable = true
    textView?.isRichText = false
    textView?.font = .monospacedSystemFont(
      ofSize: NSFont.systemFontSize,
      weight: .regular
    )
    textView?.string = contents
    guard let image else {
      scrollView.frame = NSRect(x: 0, y: 0, width: 480, height: 180)
      return scrollView
    }

    let imageView = NSImageView(frame: NSRect(x: 0, y: 96, width: 480, height: 180))
    imageView.image = image
    imageView.imageAlignment = .alignCenter
    imageView.imageScaling = .scaleProportionallyUpOrDown
    imageView.setAccessibilityIdentifier("terminal.clipboard-confirmation.image")
    scrollView.frame = NSRect(x: 0, y: 0, width: 480, height: 88)
    let container = NSView(frame: NSRect(x: 0, y: 0, width: 480, height: 276))
    container.addSubview(imageView)
    container.addSubview(scrollView)
    return container
  }

  private static func presentation(
    for request: GhosttyClipboardConfirmationRequest,
    programName: String?
  ) -> Presentation {
    switch request {
    case .paste:
      return Presentation(
        title: "Warning: Potentially Unsafe Paste",
        message: "Pasting this text may execute multiple commands.",
        cancelTitle: "Cancel",
        confirmTitle: "Paste"
      )
    case .osc52Read, .kittyRead:
      return Presentation(
        title: "Authorize Clipboard Access",
        message: "\(requester(programName)) is attempting to read from the clipboard.",
        cancelTitle: "Deny",
        confirmTitle: "Allow"
      )
    case .osc52Write, .kittyWrite:
      return Presentation(
        title: "Authorize Clipboard Access",
        message: "\(requester(programName)) is attempting to write to the clipboard.",
        cancelTitle: "Deny",
        confirmTitle: "Allow"
      )
    }
  }

  private static func requester(_ programName: String?) -> String {
    guard let programName else { return "A terminal application" }
    let sanitized = GhosttyClipboardDisplay.sanitize(
      programName,
      maximumBytes: GhosttyClipboardDisplay.maximumRequesterBytes / 2
    )
    let name = sanitized.text.trimmingCharacters(in: .whitespaces)
    guard !name.isEmpty else { return "A terminal application" }
    let truncation =
      sanitized.isTruncated
      ? " [Name truncated: showing \(sanitized.sourceBytes) of \(sanitized.totalSourceBytes) UTF-8 bytes]"
      : ""
    return GhosttyClipboardDisplay.bounded(
      String(reflecting: name) + truncation,
      maximumBytes: GhosttyClipboardDisplay.maximumRequesterBytes,
      marker: "[Name display truncated; source is \(sanitized.totalSourceBytes) UTF-8 bytes]"
    )
  }
}
