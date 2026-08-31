import Foundation
import GhosttyKit

nonisolated enum GhosttyClipboardBridge {
  struct ReadCallback {
    let userdata: UnsafeMutableRawPointer?
    let location: ghostty_clipboard_e
    let state: UnsafeMutableRawPointer?
    let request: ghostty_clipboard_request_e
    let mimes: UnsafePointer<UnsafePointer<CChar>?>?
    let mimesCount: Int
    let listsAvailableTypes: Bool
  }

  static func read(_ callback: ReadCallback) -> ghostty_clipboard_read_result_e {
    guard let mimes = copiedMIMEs(callback.mimes, count: callback.mimesCount) else {
      return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED
    }
    let userdataBits = callback.userdata.map { UInt(bitPattern: $0) }
    let stateBits = callback.state.map { UInt(bitPattern: $0) }
    let location = callback.location
    let readRequest = GhosttyClipboardReadRequest(
      kind: callback.request,
      mimes: mimes,
      listsAvailableTypes: callback.listsAvailableTypes
    )
    if Thread.isMainThread {
      return MainActor.assumeIsolated {
        read(
          userdataBits: userdataBits,
          location: location,
          stateBits: stateBits,
          request: readRequest
        )
      }
    }
    return DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        read(
          userdataBits: userdataBits,
          location: location,
          stateBits: stateBits,
          request: readRequest
        )
      }
    }
  }

  static func confirm(
    _ userdata: UnsafeMutableRawPointer?,
    payload: UnsafePointer<ghostty_clipboard_confirm_s>?,
    state: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
  ) {
    let payload = GhosttyClipboardConfirmationPayload(copying: payload, request: request)
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    let stateBits = state.map { UInt(bitPattern: $0) }
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        confirm(
          userdataBits: userdataBits,
          payload: payload,
          stateBits: stateBits,
          request: request
        )
      }
      return
    }
    DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        confirm(
          userdataBits: userdataBits,
          payload: payload,
          stateBits: stateBits,
          request: request
        )
      }
    }
  }

  static func write(
    _ userdata: UnsafeMutableRawPointer?,
    location: ghostty_clipboard_e,
    content: UnsafePointer<ghostty_clipboard_content_s>?,
    count: Int,
    confirm: Bool
  ) -> Bool {
    guard
      let content,
      count > 0,
      let contents = GhosttyClipboardContent.copying(
        UnsafeBufferPointer(start: content, count: count)
      )
    else { return false }
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    if Thread.isMainThread {
      return MainActor.assumeIsolated {
        write(
          userdataBits: userdataBits,
          location: location,
          contents: contents,
          confirm: confirm
        )
      }
    }
    return DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        write(
          userdataBits: userdataBits,
          location: location,
          contents: contents,
          confirm: confirm
        )
      }
    }
  }

  private static func copiedMIMEs(
    _ mimes: UnsafePointer<UnsafePointer<CChar>?>?,
    count: Int
  ) -> [String]? {
    guard count >= 0, count == 0 || mimes != nil else { return nil }
    guard let mimes else { return [] }
    var result: [String] = []
    result.reserveCapacity(count)
    for index in 0..<count {
      guard
        let pointer = mimes[index],
        let mime = String(validatingCString: pointer)
      else { return nil }
      result.append(mime)
    }
    return result
  }

  @MainActor private static func read(
    userdataBits: UInt?,
    location: ghostty_clipboard_e,
    stateBits: UInt?,
    request: GhosttyClipboardReadRequest
  ) -> ghostty_clipboard_read_result_e {
    guard let view = surfaceBridge(userdataBits: userdataBits)?.surfaceView else {
      return GHOSTTY_CLIPBOARD_READ_UNSUPPORTED
    }
    let state = stateBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    return view.runtime.clipboard.read(
      from: view,
      location: location,
      state: state,
      request: request
    )
  }

  @MainActor private static func confirm(
    userdataBits: UInt?,
    payload: GhosttyClipboardConfirmationPayload?,
    stateBits: UInt?,
    request: ghostty_clipboard_request_e
  ) {
    let state = stateBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let bridge = surfaceBridge(userdataBits: userdataBits), let surface = bridge.surface else {
      return
    }
    guard let view = bridge.surfaceView else {
      ghostty_surface_deny_clipboard_request(surface, state)
      return
    }
    view.runtime.clipboard.confirmRead(
      from: view,
      surfaceReference: view.surfaceReference,
      payload: payload,
      state: state,
      request: request
    )
  }

  @MainActor private static func write(
    userdataBits: UInt?,
    location: ghostty_clipboard_e,
    contents: [GhosttyClipboardContent],
    confirm: Bool
  ) -> Bool {
    guard let view = surfaceBridge(userdataBits: userdataBits)?.surfaceView else { return false }
    return view.runtime.clipboard.write(
      from: view,
      surfaceReference: view.surfaceReference,
      location: location,
      items: contents,
      confirm: confirm
    )
  }

  @MainActor private static func surfaceBridge(userdataBits: UInt?) -> GhosttySurfaceBridge? {
    guard
      let userdataBits,
      let userdata = UnsafeMutableRawPointer(bitPattern: userdataBits)
    else { return nil }
    return Unmanaged<GhosttySurfaceBridge>.fromOpaque(userdata).takeUnretainedValue()
  }
}
