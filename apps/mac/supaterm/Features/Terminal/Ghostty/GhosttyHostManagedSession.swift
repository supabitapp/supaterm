import Dispatch
import Foundation
import GhosttyKit

private nonisolated final class GhosttyHostManagedCallbackState: Sendable {
  let queue: DispatchQueue
  let onInput: @Sendable (Data) -> Void
  let onResize: @Sendable (GhosttyHostManagedSession.Viewport) -> Void

  init(
    queue: DispatchQueue,
    onInput: @escaping @Sendable (Data) -> Void,
    onResize: @escaping @Sendable (GhosttyHostManagedSession.Viewport) -> Void
  ) {
    self.queue = queue
    self.onInput = onInput
    self.onResize = onResize
  }

  func receiveInput(_ pointer: UnsafePointer<UInt8>?, count: Int) {
    guard let pointer else {
      if count == 0 {
        queue.async { [onInput] in onInput(Data()) }
      }
      return
    }
    let data = Data(bytes: pointer, count: count)
    queue.async { [onInput] in onInput(data) }
  }

  func receiveResize(
    columns: UInt16,
    rows: UInt16,
    pixelWidth: UInt32,
    pixelHeight: UInt32
  ) {
    let viewport = GhosttyHostManagedSession.Viewport(
      columns: columns,
      rows: rows,
      pixelWidth: pixelWidth,
      pixelHeight: pixelHeight
    )
    queue.async { [onResize] in onResize(viewport) }
  }

  private nonisolated static func inputCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ pointer: UnsafePointer<UInt8>?,
    _ count: Int
  ) {
    guard let userdata else { return }
    Unmanaged<GhosttyHostManagedCallbackState>.fromOpaque(userdata)
      .takeUnretainedValue()
      .receiveInput(pointer, count: count)
  }

  private nonisolated static func resizeCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ columns: UInt16,
    _ rows: UInt16,
    _ pixelWidth: UInt32,
    _ pixelHeight: UInt32
  ) {
    guard let userdata else { return }
    Unmanaged<GhosttyHostManagedCallbackState>.fromOpaque(userdata)
      .takeUnretainedValue()
      .receiveResize(
        columns: columns,
        rows: rows,
        pixelWidth: pixelWidth,
        pixelHeight: pixelHeight
      )
  }

  func configure(_ config: inout ghostty_surface_config_s) {
    config.host_managed = true
    config.host_managed_userdata = Unmanaged.passUnretained(self).toOpaque()
    config.host_managed_input = { @Sendable userdata, pointer, count in
      GhosttyHostManagedCallbackState.inputCallback(userdata, pointer, count)
    }
    config.host_managed_resize = {
      @Sendable userdata, columns, rows, pixelWidth, pixelHeight in
      GhosttyHostManagedCallbackState.resizeCallback(
        userdata,
        columns,
        rows,
        pixelWidth,
        pixelHeight
      )
    }
  }
}

@MainActor
final class GhosttyHostManagedSession {
  nonisolated struct Viewport: Equatable, Sendable {
    let columns: UInt16
    let rows: UInt16
    let pixelWidth: UInt32
    let pixelHeight: UInt32
  }

  private let callbacks: GhosttyHostManagedCallbackState
  private var surface: ghostty_surface_t?

  init(
    deliveryQueue: DispatchQueue = DispatchQueue(label: "app.supabit.supaterm.host-renderer"),
    onInput: @escaping @Sendable (Data) -> Void,
    onResize: @escaping @Sendable (Viewport) -> Void
  ) {
    callbacks = GhosttyHostManagedCallbackState(
      queue: deliveryQueue,
      onInput: onInput,
      onResize: onResize
    )
  }

  func write(_ data: Data) -> Bool {
    guard let surface else { return false }
    return data.withUnsafeBytes { bytes in
      ghostty_surface_write_buffer(
        surface,
        bytes.bindMemory(to: UInt8.self).baseAddress,
        bytes.count
      )
    }
  }

  func restore(snapshot: Data) -> Bool {
    guard let surface else { return false }
    return snapshot.withUnsafeBytes { bytes in
      ghostty_surface_restore_snapshot(
        surface,
        bytes.bindMemory(to: UInt8.self).baseAddress,
        bytes.count
      )
    }
  }

  func configure(_ config: inout ghostty_surface_config_s) {
    callbacks.configure(&config)
  }

  func attach(_ surface: ghostty_surface_t) {
    precondition(self.surface == nil)
    self.surface = surface
  }

  func detach(_ surface: ghostty_surface_t) {
    guard self.surface == surface else { return }
    self.surface = nil
  }
}
