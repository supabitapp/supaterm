import AppKit
import Darwin
import GhosttyKit

@MainActor
final class GhosttyClipboard {
  private let confirmations = GhosttyClipboardConfirmationCoordinator()
  private let pasteboardProvider: (ghostty_clipboard_e) -> NSPasteboard?

  init(pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard?) {
    self.pasteboardProvider = pasteboardProvider
  }

  func read(
    from view: GhosttySurfaceView,
    location: ghostty_clipboard_e,
    state: UnsafeMutableRawPointer?,
    request: GhosttyClipboardReadRequest
  ) -> ghostty_clipboard_read_result_e {
    guard
      location != GHOSTTY_CLIPBOARD_PRIMARY,
      view.surface != nil,
      state != nil
    else { return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED }
    guard let pasteboard = pasteboardProvider(location) else {
      return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED
    }

    var seen = Set<String>()
    let contents = request.mimes.compactMap { mime -> GhosttyClipboardContent? in
      guard seen.insert(mime).inserted else { return nil }
      guard let data = pasteboard.ghosttyData(forMime: mime, request: request.kind) else {
        return nil
      }
      return GhosttyClipboardContent(mime: mime, data: data)
    }
    let available = request.listsAvailableTypes ? pasteboard.ghosttyAvailableMimes() : []
    guard !contents.isEmpty || request.listsAvailableTypes else {
      return GHOSTTY_CLIPBOARD_READ_UNAVAILABLE
    }
    guard let surface = view.surface else { return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED }
    complete(surface: surface, contents: contents, available: available, state: state)
    return GHOSTTY_CLIPBOARD_READ_STARTED
  }

  func confirmRead(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    payload: GhosttyClipboardConfirmationPayload?,
    state: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
  ) {
    guard
      let state,
      let surfaceReference,
      surfaceReference.isValid,
      let payload,
      let request = GhosttyClipboardConfirmationRequest(request)
    else {
      deny(from: view, state: state)
      return
    }

    let confirmedPayload =
      request == .kittyWrite
      ? GhosttyClipboardConfirmationPayload(
        contents: GhosttyPasteboard.normalizedContents(payload.contents),
        available: payload.available,
        programName: payload.programName,
        canRemember: payload.canRemember
      )
      : payload

    _ = confirmations.present(
      payload: confirmedPayload,
      request: request,
      surface: surfaceReference,
      view: view
    ) { [weak view] allowed, remember in
      guard surfaceReference.isValid else { return }
      if allowed {
        self.complete(
          surface: surfaceReference.surface,
          contents: request == .kittyWrite ? [] : confirmedPayload.contents,
          available: confirmedPayload.available,
          state: state,
          confirmed: true,
          remember: remember
        )
        if request == .paste {
          view?.confirmedPasteDidComplete()
        }
      } else {
        ghostty_surface_deny_clipboard_request(surfaceReference.surface, state)
      }
    }
  }

  func write(
    from view: GhosttySurfaceView,
    surfaceReference: GhosttyRuntime.SurfaceReference?,
    location: ghostty_clipboard_e,
    items: [GhosttyClipboardContent],
    confirm: Bool
  ) -> Bool {
    let items = GhosttyPasteboard.normalizedContents(items)
    guard let pasteboard = pasteboardProvider(location), !items.isEmpty else { return false }
    guard confirm else {
      return GhosttyPasteboard.write(items, to: pasteboard)
    }
    guard let surfaceReference, surfaceReference.isValid else { return false }
    let payload = GhosttyClipboardConfirmationPayload(
      contents: items,
      available: [],
      programName: nil,
      canRemember: false
    )
    return confirmations.present(
      payload: payload,
      request: .osc52Write,
      surface: surfaceReference,
      view: view
    ) { [weak self] allowed, _ in
      guard allowed, surfaceReference.isValid else { return }
      guard self != nil else { return }
      _ = GhosttyPasteboard.write(items, to: pasteboard)
    }
  }

  func cancel(surface: GhosttyRuntime.SurfaceReference) {
    confirmations.cancel(surface: surface)
  }

  func cancelAll() {
    confirmations.cancelAll()
  }

  private func deny(from view: GhosttySurfaceView, state: UnsafeMutableRawPointer?) {
    guard let surface = view.surface, let state else { return }
    ghostty_surface_deny_clipboard_request(surface, state)
  }

  private func complete(
    surface: ghostty_surface_t,
    contents: [GhosttyClipboardContent],
    available: [String],
    state: UnsafeMutableRawPointer?,
    confirmed: Bool = false,
    remember: Bool = false
  ) {
    var strings: [UnsafeMutablePointer<CChar>] = []
    var dataBuffers: [UnsafeMutableRawPointer] = []
    defer {
      for string in strings {
        free(string)
      }
      for buffer in dataBuffers {
        buffer.deallocate()
      }
    }

    let cContents = contents.enumerated().compactMap {
      payloadID, entry -> ghostty_clipboard_content_s? in
      guard let mime = strdup(entry.mime) else { return nil }
      strings.append(mime)
      let buffer = UnsafeMutableRawPointer.allocate(
        byteCount: max(entry.data.count, 1),
        alignment: 1
      )
      dataBuffers.append(buffer)
      entry.data.withUnsafeBytes { bytes in
        guard let source = bytes.baseAddress else { return }
        buffer.copyMemory(from: source, byteCount: bytes.count)
      }
      return ghostty_clipboard_content_s(
        mime: mime,
        data: buffer.assumingMemoryBound(to: CChar.self),
        len: entry.data.count,
        payload_id: payloadID
      )
    }
    let cAvailable: [UnsafePointer<CChar>?] = available.compactMap { mime in
      guard let value = strdup(mime) else { return nil }
      strings.append(value)
      return UnsafePointer(value)
    }.map(Optional.some)
    cContents.withUnsafeBufferPointer { contentsBuffer in
      cAvailable.withUnsafeBufferPointer { availableBuffer in
        var result = ghostty_clipboard_complete_s(
          contents: contentsBuffer.baseAddress,
          contents_len: contentsBuffer.count,
          available: availableBuffer.baseAddress,
          available_len: availableBuffer.count,
          confirmed: confirmed,
          remember: remember
        )
        ghostty_surface_complete_clipboard_request(surface, &result, state)
      }
    }
  }

}
