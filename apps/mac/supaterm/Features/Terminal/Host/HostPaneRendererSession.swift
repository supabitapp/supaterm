import CryptoKit
import Foundation
import SupatermHostClient

@MainActor
final class HostPaneRendererSession {
  let renderer: GhosttyHostManagedSession

  private let attachment: HostPaneAttachment

  init(
    connection: HostConnection,
    paneID: HostPaneID,
    onFailure: @escaping @Sendable (String) -> Void = { _ in }
  ) {
    let attachment = HostPaneAttachment(
      connection: connection,
      paneID: paneID,
      onFailure: onFailure
    )
    self.attachment = attachment
    renderer = GhosttyHostManagedSession(
      onInput: { data in
        Task { await attachment.input(data) }
      },
      onResize: { viewport in
        Task { await attachment.resize(viewport) }
      }
    )
  }

  func start() {
    let renderer = renderer
    Task {
      await attachment.start(
        restore: { [weak renderer] snapshot in
          renderer?.restore(snapshot: snapshot) == true
        },
        write: { [weak renderer] bytes in
          renderer?.write(bytes) == true
        }
      )
    }
  }

  func stop() async {
    await attachment.stop()
  }

  isolated deinit {
    let attachment = attachment
    Task { await attachment.stop() }
  }
}

private actor HostPaneAttachment {
  typealias Render = @Sendable (Data) -> Bool

  private let connection: HostConnection
  private let paneID: HostPaneID
  private let onFailure: @Sendable (String) -> Void
  private var task: Task<Void, Never>?
  private var streamID: UInt32?
  private var expectedSnapshotID: UUID?
  private var boundary: UInt64?
  private var declaredLength: UInt64?
  private var snapshot = Data()
  private var restored = false
  private var nextSequence: UInt64?
  private var latestViewport: HostViewport?
  private var pendingInput = Data()
  private var restore: Render?
  private var write: Render?

  init(
    connection: HostConnection,
    paneID: HostPaneID,
    onFailure: @escaping @Sendable (String) -> Void
  ) {
    self.connection = connection
    self.paneID = paneID
    self.onFailure = onFailure
  }

  func start(
    restore: @escaping Render,
    write: @escaping Render
  ) {
    guard task == nil else { return }
    self.restore = restore
    self.write = write
    task = Task { [weak self] in
      guard let self else { return }
      await self.run()
    }
  }

  func stop() async {
    task?.cancel()
    task = nil
    if let streamID {
      await connection.detach(streamID: streamID)
    }
    reset()
  }

  func input(_ data: Data) async {
    guard !data.isEmpty else { return }
    guard let streamID, nextSequence != nil else {
      if pendingInput.count + data.count <= 64 * 1024 {
        pendingInput.append(data)
      } else {
        await fail(HostPaneAttachmentError.inputOverflow)
      }
      return
    }
    do {
      try await connection.input(streamID: streamID, bytes: data)
    } catch {
      await fail(error)
    }
  }

  func resize(_ viewport: GhosttyHostManagedSession.Viewport) async {
    let viewport = HostViewport(
      rows: viewport.rows,
      columns: viewport.columns,
      pixelWidth: UInt16(clamping: viewport.pixelWidth),
      pixelHeight: UInt16(clamping: viewport.pixelHeight)
    )
    latestViewport = viewport
    guard let streamID, nextSequence != nil else { return }
    do {
      try await connection.resize(streamID: streamID, viewport: viewport)
    } catch {
      await fail(error)
    }
  }

  private func run() async {
    do {
      let attachment = try await connection.attach(paneID)
      streamID = attachment.streamID
      for await event in attachment.events {
        try Task.checkCancellation()
        try await receive(event)
      }
      if !Task.isCancelled {
        throw HostPaneAttachmentError.closed
      }
    } catch is CancellationError {
    } catch {
      await fail(error)
    }
  }

  private func receive(_ event: HostTerminalEvent) async throws {
    switch event {
    case .control(.attached(let snapshotID, let boundary)):
      resetSnapshot()
      expectedSnapshotID = snapshotID
      self.boundary = boundary
    case .control(
      .snapshotBegin(let snapshotID, let boundary, let encoding, let declaredLength, let limit)
    ):
      guard snapshotID == expectedSnapshotID,
        boundary == self.boundary,
        encoding == .ghosttyV1,
        declaredLength <= limit
      else {
        throw HostPaneAttachmentError.invalidSnapshot
      }
      self.declaredLength = declaredLength
      snapshot.reserveCapacity(Int(clamping: declaredLength))
    case .snapshotChunk(let snapshotID, let offset, let bytes):
      guard snapshotID == expectedSnapshotID,
        let declaredLength,
        offset == UInt64(snapshot.count),
        UInt64(snapshot.count + bytes.count) <= declaredLength
      else {
        throw HostPaneAttachmentError.invalidSnapshot
      }
      snapshot.append(bytes)
    case .control(.snapshotEnd(let snapshotID, let totalLength, let sha256)):
      guard snapshotID == expectedSnapshotID,
        totalLength == declaredLength,
        totalLength == UInt64(snapshot.count),
        sha256 == Array(SHA256.hash(data: snapshot)),
        restore?(snapshot) == true
      else {
        throw HostPaneAttachmentError.invalidSnapshot
      }
      restored = true
    case .control(.ready(let nextSequence)):
      guard restored, let boundary, nextSequence == boundary, let streamID else {
        throw HostPaneAttachmentError.invalidJoin
      }
      _ = try await connection.claim(streamID: streamID)
      self.nextSequence = nextSequence
      if let latestViewport {
        try await connection.resize(streamID: streamID, viewport: latestViewport)
      }
      if !pendingInput.isEmpty {
        try await connection.input(streamID: streamID, bytes: pendingInput)
        pendingInput.removeAll(keepingCapacity: true)
      }
      snapshot.removeAll(keepingCapacity: false)
    case .output(let sequence, let bytes):
      guard sequence == nextSequence, write?(bytes) == true else {
        throw HostPaneAttachmentError.invalidJoin
      }
      self.nextSequence = sequence + UInt64(bytes.count)
    case .control(.exited):
      throw HostPaneAttachmentError.exited
    }
  }

  private func fail(_ error: any Error) async {
    guard task != nil || streamID != nil else { return }
    task?.cancel()
    task = nil
    if let streamID {
      await connection.detach(streamID: streamID)
    }
    reset()
    onFailure(String(describing: error))
  }

  private func reset() {
    streamID = nil
    restore = nil
    write = nil
    pendingInput.removeAll(keepingCapacity: false)
    latestViewport = nil
    nextSequence = nil
    resetSnapshot()
  }

  private func resetSnapshot() {
    expectedSnapshotID = nil
    boundary = nil
    declaredLength = nil
    snapshot.removeAll(keepingCapacity: false)
    restored = false
  }
}

private enum HostPaneAttachmentError: Error {
  case closed
  case exited
  case inputOverflow
  case invalidJoin
  case invalidSnapshot
}
