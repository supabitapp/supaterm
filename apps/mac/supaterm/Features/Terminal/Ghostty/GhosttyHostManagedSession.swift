import Foundation
import GhosttyKit
import Synchronization

nonisolated enum GhosttyHostManagedEvent: Equatable, Sendable {
  case input(Data)
  case viewport(columns: UInt16, rows: UInt16, widthPixels: UInt32, heightPixels: UInt32)
}

nonisolated enum GhosttyHostManagedSessionError: Error, Equatable {
  case eventBufferOverflow
}

nonisolated struct GhosttyHostManagedEvents: AsyncSequence, Sendable {
  typealias Element = GhosttyHostManagedEvent

  struct AsyncIterator: AsyncIteratorProtocol {
    fileprivate var iterator: AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>.AsyncIterator

    mutating func next(
      isolation actor: isolated (any Actor)? = #isolation
    ) async throws -> GhosttyHostManagedEvent? {
      try await iterator.next(isolation: actor)?.consume()
    }
  }

  private let stream: AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>

  fileprivate init(_ stream: AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>) {
    self.stream = stream
  }

  func makeAsyncIterator() -> AsyncIterator {
    AsyncIterator(iterator: stream.makeAsyncIterator())
  }
}

nonisolated final class GhosttyHostManagedSession: Sendable {
  typealias SurfaceWrite = @Sendable (UInt, Data) -> Bool
  typealias SnapshotPrepare = @Sendable (UInt, Data) -> UInt?
  typealias SnapshotCommit = @MainActor @Sendable (UInt, UInt) async -> Bool
  typealias SnapshotFree = @Sendable (UInt) -> Void

  let events: GhosttyHostManagedEvents

  private let eventSink: GhosttyHostManagedEventSink
  private let calls: GhosttyHostManagedSurfaceCalls
  private let executor: GhosttyHostManagedSurfaceExecutor

  init(
    eventBufferCapacity: Int = 256,
    eventBufferByteCapacity: Int = 16 * 1_024 * 1_024,
    surfaceCallCapacity: Int = 256,
    surfaceCallByteCapacity: Int = 256 * 1_024 * 1_024,
    write: @escaping SurfaceWrite = GhosttyHostManagedSession.write,
    prepareSnapshot: @escaping SnapshotPrepare = GhosttyHostManagedSession.prepareSnapshot,
    commitSnapshot: @escaping SnapshotCommit = GhosttyHostManagedSession.commitSnapshot,
    freeSnapshot: @escaping SnapshotFree = GhosttyHostManagedSession.freeSnapshot
  ) {
    precondition((1...256).contains(eventBufferCapacity))
    precondition((1...(16 * 1_024 * 1_024)).contains(eventBufferByteCapacity))
    precondition((1...256).contains(surfaceCallCapacity))
    precondition((1...(256 * 1_024 * 1_024)).contains(surfaceCallByteCapacity))
    let stream = AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>.makeStream(
      of: GhosttyHostManagedBufferedEvent.self,
      throwing: Error.self,
      bufferingPolicy: .unbounded
    )
    let calls = GhosttyHostManagedSurfaceCalls(
      callCapacity: surfaceCallCapacity,
      byteCapacity: surfaceCallByteCapacity
    )
    let eventBuffer = GhosttyHostManagedEventBuffer(
      eventCapacity: eventBufferCapacity,
      byteCapacity: eventBufferByteCapacity
    )
    stream.continuation.onTermination = { _ in
      _ = eventBuffer.finish()
    }
    events = GhosttyHostManagedEvents(stream.stream)
    eventSink = GhosttyHostManagedEventSink(
      stream.continuation,
      buffer: eventBuffer
    )
    self.calls = calls
    executor = GhosttyHostManagedSurfaceExecutor(
      calls: calls,
      write: write,
      prepareSnapshot: prepareSnapshot,
      commitSnapshot: commitSnapshot,
      freeSnapshot: freeSnapshot
    )
  }

  deinit {
    eventSink.finish()
  }

  func configure(_ config: inout ghostty_surface_config_s) {
    let didConfigure = calls.configure()
    guard didConfigure else { fatalError("Host-managed session configured more than once") }
    config.host_managed = true
    config.host_userdata = Unmanaged.passUnretained(eventSink).toOpaque()
    config.host_input_capacity = eventSink.byteCapacity
    config.host_input_rejected = { userdata, _ in
      guard let userdata else { return }
      Unmanaged<GhosttyHostManagedEventSink>
        .fromOpaque(userdata)
        .takeUnretainedValue()
        .rejectInput()
    }
    config.host_input = { userdata, bytes, count in
      guard let userdata else { return false }
      return Unmanaged<GhosttyHostManagedEventSink>
        .fromOpaque(userdata)
        .takeUnretainedValue()
        .sendInput(bytes, count: count)
    }
    config.host_resize = { userdata, columns, rows, widthPixels, heightPixels in
      guard let userdata else { return }
      Unmanaged<GhosttyHostManagedEventSink>
        .fromOpaque(userdata)
        .takeUnretainedValue()
        .sendViewport(
          columns: columns,
          rows: rows,
          widthPixels: widthPixels,
          heightPixels: heightPixels
        )
    }
  }

  func attach(_ surface: ghostty_surface_t) {
    let didAttach = calls.attach(UInt(bitPattern: surface))
    guard didAttach else { fatalError("Host-managed session attached out of order") }
  }

  func write(_ data: Data) async -> Bool {
    guard data.count <= 64 * 1_024,
      let reservation = calls.reserve(byteCount: data.count)
    else {
      return false
    }
    return await executor.write(reservation: reservation, data: data)
  }

  func restore(_ data: Data) async -> Bool {
    guard data.count <= 256 * 1_024 * 1_024,
      let reservation = calls.reserve(byteCount: data.count)
    else {
      return false
    }
    return await executor.restore(reservation: reservation, data: data)
  }

  @discardableResult
  func detach(onDrained: @escaping @Sendable () -> Void = {}) -> Bool {
    switch calls.detach(onDrained: onDrained) {
    case .drain(let onDrained):
      eventSink.finish()
      onDrained()
      return true
    case .pending:
      eventSink.finish()
      return true
    case .unchanged:
      return false
    }
  }

  private static func write(_ address: UInt, _ data: Data) -> Bool {
    guard let surface = ghostty_surface_t(bitPattern: address) else { return false }
    return data.withUnsafeBytes { bytes in
      ghostty_surface_write_buffer(
        surface,
        bytes.bindMemory(to: UInt8.self).baseAddress,
        bytes.count
      )
    }
  }

  private static func prepareSnapshot(_ address: UInt, _ data: Data) -> UInt? {
    guard let surface = ghostty_surface_t(bitPattern: address) else { return nil }
    return data.withUnsafeBytes { bytes in
      ghostty_surface_prepare_snapshot(
        surface,
        bytes.bindMemory(to: UInt8.self).baseAddress,
        bytes.count
      ).map { UInt(bitPattern: $0) }
    }
  }

  @MainActor
  private static func commitSnapshot(_ address: UInt, _ snapshotAddress: UInt) -> Bool {
    guard let surface = ghostty_surface_t(bitPattern: address),
      let snapshot = ghostty_surface_snapshot_t(bitPattern: snapshotAddress)
    else {
      return false
    }
    return ghostty_surface_commit_snapshot(surface, snapshot)
  }

  private static func freeSnapshot(_ snapshotAddress: UInt) {
    guard let snapshot = ghostty_surface_snapshot_t(bitPattern: snapshotAddress) else { return }
    ghostty_surface_snapshot_free(snapshot)
  }
}

nonisolated private final class GhosttyHostManagedEventSink: Sendable {
  private let continuation: AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>.Continuation
  private let buffer: GhosttyHostManagedEventBuffer

  var byteCapacity: Int { buffer.byteCapacity }

  init(
    _ continuation: AsyncThrowingStream<GhosttyHostManagedBufferedEvent, Error>.Continuation,
    buffer: GhosttyHostManagedEventBuffer
  ) {
    self.continuation = continuation
    self.buffer = buffer
  }

  func sendInput(_ bytes: UnsafePointer<UInt8>?, count: Int) -> Bool {
    guard count == 0 || bytes != nil,
      let reservation = reserve(byteCount: count)
    else {
      return false
    }
    let data = bytes.map { Data(bytes: $0, count: count) } ?? Data()
    return send(.input(data), reservation: reservation)
  }

  func sendViewport(
    columns: UInt16,
    rows: UInt16,
    widthPixels: UInt32,
    heightPixels: UInt32
  ) {
    guard let reservation = reserve(byteCount: 0) else { return }
    _ = send(
      .viewport(
        columns: columns,
        rows: rows,
        widthPixels: widthPixels,
        heightPixels: heightPixels
      ),
      reservation: reservation
    )
  }

  func rejectInput() {
    if buffer.finish() {
      continuation.finish(throwing: GhosttyHostManagedSessionError.eventBufferOverflow)
    }
  }

  func finish() {
    if buffer.finish() {
      continuation.finish()
    }
  }

  private func reserve(byteCount: Int) -> GhosttyHostManagedEventReservation? {
    switch buffer.reserve(byteCount: byteCount) {
    case .accepted(let accepted):
      return accepted
    case .overflow:
      continuation.finish(throwing: GhosttyHostManagedSessionError.eventBufferOverflow)
      return nil
    case .finished:
      return nil
    }
  }

  private func send(
    _ event: GhosttyHostManagedEvent,
    reservation: GhosttyHostManagedEventReservation
  ) -> Bool {
    switch continuation.yield(
      GhosttyHostManagedBufferedEvent(event: event, reservation: reservation)
    ) {
    case .enqueued:
      return true
    case .dropped:
      return false
    case .terminated:
      _ = buffer.finish()
      return false
    @unknown default:
      return false
    }
  }
}

nonisolated private struct GhosttyHostManagedBufferedEvent: Sendable {
  let event: GhosttyHostManagedEvent
  let reservation: GhosttyHostManagedEventReservation

  func consume() -> GhosttyHostManagedEvent {
    withExtendedLifetime(reservation) { event }
  }
}

nonisolated private final class GhosttyHostManagedEventReservation: Sendable {
  private let release: @Sendable () -> Void

  init(release: @escaping @Sendable () -> Void) {
    self.release = release
  }

  deinit {
    release()
  }
}

nonisolated private final class GhosttyHostManagedEventBuffer: Sendable {
  enum Admission: Sendable {
    case accepted(GhosttyHostManagedEventReservation)
    case overflow
    case finished
  }

  private struct State: Sendable {
    var eventCount = 0
    var byteCount = 0
    var finished = false
  }

  private let eventCapacity: Int
  let byteCapacity: Int
  private let state = Mutex(State())

  init(eventCapacity: Int, byteCapacity: Int) {
    self.eventCapacity = eventCapacity
    self.byteCapacity = byteCapacity
  }

  func reserve(byteCount: Int) -> Admission {
    state.withLock { state in
      guard !state.finished else { return .finished }
      guard state.eventCount < eventCapacity,
        byteCount <= byteCapacity - state.byteCount
      else {
        state.finished = true
        return .overflow
      }
      state.eventCount += 1
      state.byteCount += byteCount
      return .accepted(
        GhosttyHostManagedEventReservation { [self] in
          release(byteCount: byteCount)
        })
    }
  }

  func finish() -> Bool {
    state.withLock { state in
      guard !state.finished else { return false }
      state.finished = true
      return true
    }
  }

  private func release(byteCount: Int) {
    state.withLock { state in
      precondition(state.eventCount > 0)
      precondition(state.byteCount >= byteCount)
      state.eventCount -= 1
      state.byteCount -= byteCount
    }
  }
}

nonisolated private final class GhosttyHostManagedSurfaceCalls: Sendable {
  private enum Attachment: Sendable {
    case waiting
    case configured
    case attached(UInt)
    case detaching(@Sendable () -> Void)
    case detached
  }

  private struct State: Sendable {
    var attachment = Attachment.waiting
    var outstandingCallCount = 0
    var outstandingByteCount = 0
  }

  enum DetachAction: Sendable {
    case drain(@Sendable () -> Void)
    case pending
    case unchanged
  }

  private let callCapacity: Int
  private let byteCapacity: Int
  private let state = Mutex(State())

  init(callCapacity: Int, byteCapacity: Int) {
    self.callCapacity = callCapacity
    self.byteCapacity = byteCapacity
  }

  func configure() -> Bool {
    state.withLock { state in
      guard case .waiting = state.attachment else { return false }
      state.attachment = .configured
      return true
    }
  }

  func attach(_ address: UInt) -> Bool {
    state.withLock { state in
      guard case .configured = state.attachment else { return false }
      state.attachment = .attached(address)
      return true
    }
  }

  func reserve(byteCount: Int) -> GhosttyHostManagedSurfaceCallReservation? {
    state.withLock { state in
      guard case .attached(let address) = state.attachment else { return nil }
      guard state.outstandingCallCount < callCapacity,
        byteCount <= byteCapacity - state.outstandingByteCount
      else {
        return nil
      }
      state.outstandingCallCount += 1
      state.outstandingByteCount += byteCount
      return GhosttyHostManagedSurfaceCallReservation(
        address: address,
        byteCount: byteCount
      )
    }
  }

  func complete(_ reservation: GhosttyHostManagedSurfaceCallReservation) {
    let onDrained: (@Sendable () -> Void)? = state.withLock { state in
      precondition(state.outstandingCallCount > 0)
      precondition(state.outstandingByteCount >= reservation.byteCount)
      state.outstandingCallCount -= 1
      state.outstandingByteCount -= reservation.byteCount
      guard state.outstandingCallCount == 0,
        case .detaching(let onDrained) = state.attachment
      else {
        return nil
      }
      state.attachment = .detached
      return onDrained
    }
    onDrained?()
  }

  func detach(onDrained: @escaping @Sendable () -> Void) -> DetachAction {
    state.withLock { state in
      switch state.attachment {
      case .waiting, .configured:
        state.attachment = .detached
        return .drain(onDrained)
      case .attached:
        if state.outstandingCallCount == 0 {
          state.attachment = .detached
          return .drain(onDrained)
        }
        state.attachment = .detaching(onDrained)
        return .pending
      case .detaching, .detached:
        return .unchanged
      }
    }
  }
}

nonisolated private struct GhosttyHostManagedSurfaceCallReservation: Sendable {
  let address: UInt
  let byteCount: Int
}

private actor GhosttyHostManagedSurfaceExecutor {
  private enum Work {
    case write(
      GhosttyHostManagedSurfaceCallReservation,
      Data,
      CheckedContinuation<Bool, Never>
    )
    case restore(
      GhosttyHostManagedSurfaceCallReservation,
      Data,
      CheckedContinuation<Bool, Never>
    )
  }

  private let calls: GhosttyHostManagedSurfaceCalls
  private let writeCall: GhosttyHostManagedSession.SurfaceWrite
  private let prepareSnapshotCall: GhosttyHostManagedSession.SnapshotPrepare
  private let commitSnapshotCall: GhosttyHostManagedSession.SnapshotCommit
  private let freeSnapshotCall: GhosttyHostManagedSession.SnapshotFree
  private var pending: [Work] = []
  private var draining = false

  init(
    calls: GhosttyHostManagedSurfaceCalls,
    write: @escaping GhosttyHostManagedSession.SurfaceWrite,
    prepareSnapshot: @escaping GhosttyHostManagedSession.SnapshotPrepare,
    commitSnapshot: @escaping GhosttyHostManagedSession.SnapshotCommit,
    freeSnapshot: @escaping GhosttyHostManagedSession.SnapshotFree
  ) {
    self.calls = calls
    writeCall = write
    prepareSnapshotCall = prepareSnapshot
    commitSnapshotCall = commitSnapshot
    freeSnapshotCall = freeSnapshot
  }

  func write(
    reservation: GhosttyHostManagedSurfaceCallReservation,
    data: Data
  ) async -> Bool {
    await withCheckedContinuation { continuation in
      enqueue(.write(reservation, data, continuation))
    }
  }

  func restore(
    reservation: GhosttyHostManagedSurfaceCallReservation,
    data: Data
  ) async -> Bool {
    await withCheckedContinuation { continuation in
      enqueue(.restore(reservation, data, continuation))
    }
  }

  private func enqueue(_ work: Work) {
    pending.append(work)
    guard !draining else { return }
    draining = true
    Task { await drain() }
  }

  private func drain() async {
    while !pending.isEmpty {
      let work = pending.removeFirst()
      switch work {
      case .write(let reservation, let data, let continuation):
        let result = writeCall(reservation.address, data)
        calls.complete(reservation)
        continuation.resume(returning: result)
      case .restore(let reservation, let data, let continuation):
        let result = await performRestore(reservation: reservation, data: data)
        calls.complete(reservation)
        continuation.resume(returning: result)
      }
    }
    draining = false
  }

  private func performRestore(
    reservation: GhosttyHostManagedSurfaceCallReservation,
    data: Data
  ) async -> Bool {
    guard let snapshotAddress = prepareSnapshotCall(reservation.address, data) else {
      return false
    }
    let committed = await commitSnapshotCall(reservation.address, snapshotAddress)
    if !committed {
      freeSnapshotCall(snapshotAddress)
    }
    return committed
  }
}
