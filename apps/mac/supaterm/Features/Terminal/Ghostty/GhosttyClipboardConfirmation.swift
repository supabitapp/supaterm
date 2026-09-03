import AppKit
import GhosttyKit
import SupatermUI
import SwiftUI

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
  struct Presentation {
    let title: String
    let message: String
    let cancelTitle: String
    let confirmTitle: String
  }

  private final class PendingRequest {
    let surface: GhosttyRuntime.SurfaceReference
    let window: NSWindow
    let presenter: DialogSurfacePresenter
    let dialogState: GhosttyClipboardConfirmationDialogState
    let completion: (Bool, Bool) -> Void
    weak var view: GhosttySurfaceView?

    init(
      surface: GhosttyRuntime.SurfaceReference,
      window: NSWindow,
      presenter: DialogSurfacePresenter,
      dialogState: GhosttyClipboardConfirmationDialogState,
      view: GhosttySurfaceView,
      completion: @escaping (Bool, Bool) -> Void
    ) {
      self.surface = surface
      self.window = window
      self.presenter = presenter
      self.dialogState = dialogState
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
    guard
      pendingRequests[key] == nil,
      window.attachedSheet == nil,
      !DialogSurfacePresenter.isPresenting(over: window)
    else {
      reject(completion)
      return false
    }

    let presentation = Self.presentation(for: request, programName: payload.programName)
    let presenter = DialogSurfacePresenter()
    let dialogState = GhosttyClipboardConfirmationDialogState()
    let pending = PendingRequest(
      surface: surface,
      window: window,
      presenter: presenter,
      dialogState: dialogState,
      view: view,
      completion: completion
    )
    pendingRequests[key] = pending
    let didPresent = presenter.present(
      over: window,
      onDismiss: { [weak self, weak pending] in
        guard let self, let pending else { return }
        finish(pending, allowed: false, remember: false, dismissDialog: false)
      }
    ) { [weak self, weak pending] in
      GhosttyClipboardConfirmationDialog(
        presentation: presentation,
        preview: payload.preview,
        previewImage: payload.previewImage,
        canRemember: payload.canRemember,
        state: dialogState,
        onConfirm: {
          guard let self, let pending else { return }
          self.finish(
            pending,
            allowed: true,
            remember: pending.dialogState.remember,
            dismissDialog: true
          )
        },
        onCancel: {
          guard let self, let pending else { return }
          self.finish(pending, allowed: false, remember: false, dismissDialog: true)
        }
      )
    }
    guard didPresent else {
      pendingRequests.removeValue(forKey: key)
      reject(completion)
      return false
    }
    return true
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    let matching = pendingRequests.values.filter { $0.surface === surface }
    for pending in matching {
      finish(pending, allowed: false, remember: false, dismissDialog: true)
    }
  }

  func cancelAll() {
    for pending in Array(pendingRequests.values) {
      finish(pending, allowed: false, remember: false, dismissDialog: true)
    }
  }

  #if DEBUG
  func setRemember(_ remember: Bool, in window: NSWindow) -> Bool {
    guard let pending = pendingRequests[ObjectIdentifier(window)] else { return false }
    pending.dialogState.remember = remember
    return true
  }
  #endif

  private func finish(
    _ pending: PendingRequest,
    allowed: Bool,
    remember: Bool,
    dismissDialog: Bool
  ) {
    let key = ObjectIdentifier(pending.window)
    guard pendingRequests.removeValue(forKey: key) === pending else { return }
    if dismissDialog {
      pending.presenter.dismiss()
    }
    let valid = pending.surface.isValid && pending.view?.window === pending.window
    pending.completion(allowed && valid, remember && allowed && valid)
  }

  private func reject(_ completion: @escaping (Bool, Bool) -> Void) {
    completion(false, false)
  }

  static func presentation(
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
