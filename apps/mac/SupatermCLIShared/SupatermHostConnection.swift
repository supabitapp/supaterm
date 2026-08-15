import Foundation
import Network

public struct SupatermHostIdentity: Equatable, Sendable {
  public let machineID: MachineID
  public let bootID: BootID

  public init(machineID: MachineID, bootID: BootID) {
    self.machineID = machineID
    self.bootID = bootID
  }
}

public struct SupatermHostAttachment: Equatable, Sendable {
  public let terminal: SupatermHostTerminalInfo
  public let attachmentID: AttachmentID
  public let replay: [SupatermHostAttachReplayChunk]
  public let boundarySequence: UInt64

  public init(
    terminal: SupatermHostTerminalInfo,
    attachmentID: AttachmentID,
    replay: [SupatermHostAttachReplayChunk],
    boundarySequence: UInt64
  ) {
    self.terminal = terminal
    self.attachmentID = attachmentID
    self.replay = replay
    self.boundarySequence = boundarySequence
  }

  public var snapshotFormat: SupatermHostSnapshotFormat { .vtReplayV1 }
}

public struct SupatermHostAttachReplayChunk: Equatable, Sendable {
  public let segment: SupatermHostAttachReplaySegment
  public let data: Data

  public init(segment: SupatermHostAttachReplaySegment, data: Data) {
    self.segment = segment
    self.data = data
  }
}

public enum SupatermHostConnectionError: Error, Equatable, Sendable {
  case connectionClosed
  case invalidEventCapacity(Int)
  case invalidRequestCapacity(Int)
  case invalidAttachReplayCapacity(Int)
  case eventBufferOverflow(Int)
  case requestBufferOverflow(Int)
  case attachReplayBufferOverflow(Int)
  case terminalDataLength(Int)
  case inputUnavailable(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    state: SupatermHostInputState
  )
  case inputInFlight(terminalID: TerminalID, attachmentID: AttachmentID)
  case transport(String)
  case protocolViolation(String)
  case remote(code: SupatermHostErrorCode, message: String)
  case unexpectedResponse(SupatermHostMessage)
  case resyncRequired(terminalID: TerminalID, attachmentID: AttachmentID)
  case outputSequence(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    expected: UInt64,
    actual: UInt64
  )
}

public actor SupatermHostConnection {
  public nonisolated let role: SupatermHostClientRole
  public nonisolated let socketURL: URL

  private struct PendingRequest {
    let body: SupatermHostRequest
    let continuation: CheckedContinuation<CompletedResponse, any Error>
    var replay: AttachReplayState?
  }

  private struct CanceledRequest {
    let body: SupatermHostRequest
    var replay: AttachReplayState?
    let reconcilesState: Bool
  }

  private struct CleanupRequest {
    let terminalID: TerminalID
    let attachmentID: AttachmentID
  }

  private struct CompletedResponse {
    let message: SupatermHostMessage
    let replay: [SupatermHostAttachReplayChunk]
  }

  private struct AttachReplayState {
    var attachmentID: AttachmentID?
    var lastSegment: SupatermHostAttachReplaySegment?
    var byteCount = 0
    var vt = Data()
    var title = Data()
    var continuation = Data()

    var chunks: [SupatermHostAttachReplayChunk] {
      [
        SupatermHostAttachReplayChunk(segment: .vt, data: vt),
        SupatermHostAttachReplayChunk(segment: .title, data: title),
        SupatermHostAttachReplayChunk(segment: .continuation, data: continuation),
      ].filter { !$0.data.isEmpty }
    }

    mutating func append(_ data: Data, to segment: SupatermHostAttachReplaySegment) {
      switch segment {
      case .vt:
        vt.append(data)
      case .title:
        title.append(data)
      case .continuation:
        continuation.append(data)
      }
    }

    mutating func discardData() {
      vt.removeAll()
      title.removeAll()
      continuation.removeAll()
    }
  }

  private struct OutboundFrame {
    let requestID: HostRequestID
    let data: Data
  }

  private struct InputReservation {
    let requestID: HostRequestID
    let sequence: UInt64
  }

  private struct OutputCursor {
    let terminalID: TerminalID
    var nextOutputSequence: UInt64
    var nextInputSequence: UInt64
    var inputState: SupatermHostInputState
    var inputRequestID: HostRequestID?
  }

  private enum Phase {
    case starting
    case ready
    case failed(SupatermHostConnectionError)
  }

  private let clientID: ClientID
  private let expectedUserID: uid_t
  private let eventCapacity: Int
  private let requestCapacity: Int
  private let attachReplayCapacity: Int
  private let codec = SupatermHostFrameCodec()
  private var phase = Phase.starting
  private var hostIdentity: SupatermHostIdentity?
  private var networkConnection: NetworkConnection<TCP>?
  private var lifecycleTask: Task<Void, Never>?
  private var transportWaiters: [HostRequestID: CheckedContinuation<Void, any Error>] = [:]
  private var pendingRequests: [HostRequestID: PendingRequest] = [:]
  private var canceledRequests: [HostRequestID: CanceledRequest] = [:]
  private var cleanupRequests: [HostRequestID: CleanupRequest] = [:]
  private var outboundFrames: [OutboundFrame] = []
  private var writerTask: Task<Void, Never>?
  private var events: [SupatermHostMessage] = []
  private var eventWaiters: [HostRequestID: CheckedContinuation<SupatermHostMessage, any Error>] = [:]
  private var eventWaiterOrder: [HostRequestID] = []
  private var outputCursors: [AttachmentID: OutputCursor] = [:]

  private init(
    socketURL: URL,
    role: SupatermHostClientRole,
    clientID: ClientID,
    expectedUserID: uid_t,
    eventCapacity: Int,
    requestCapacity: Int,
    attachReplayCapacity: Int
  ) {
    self.socketURL = socketURL.standardizedFileURL
    self.role = role
    self.clientID = clientID
    self.expectedUserID = expectedUserID
    self.eventCapacity = eventCapacity
    self.requestCapacity = requestCapacity
    self.attachReplayCapacity = attachReplayCapacity
  }

  deinit {
    lifecycleTask?.cancel()
    writerTask?.cancel()
  }

  public static func connect(
    socketURL: URL,
    role: SupatermHostClientRole,
    clientID: ClientID = ClientID(),
    expectedUserID: uid_t = geteuid(),
    eventCapacity: Int = 128,
    requestCapacity: Int = 128,
    attachReplayCapacity: Int = supatermHostMaximumAttachReplayBytes
  ) async throws -> SupatermHostConnection {
    guard eventCapacity > 0 else {
      throw SupatermHostConnectionError.invalidEventCapacity(eventCapacity)
    }
    guard requestCapacity > 0 else {
      throw SupatermHostConnectionError.invalidRequestCapacity(requestCapacity)
    }
    guard
      attachReplayCapacity > 0,
      attachReplayCapacity <= supatermHostMaximumAttachReplayBytes
    else {
      throw SupatermHostConnectionError.invalidAttachReplayCapacity(attachReplayCapacity)
    }
    try SupatermHostSocketSecurity.validate(
      socketURL: socketURL,
      expectedUserID: expectedUserID
    )
    let connection = SupatermHostConnection(
      socketURL: socketURL,
      role: role,
      clientID: clientID,
      expectedUserID: expectedUserID,
      eventCapacity: eventCapacity,
      requestCapacity: requestCapacity,
      attachReplayCapacity: attachReplayCapacity
    )
    await connection.start()
    do {
      try await connection.completeHello()
      try SupatermHostSocketSecurity.validate(
        socketURL: socketURL,
        expectedUserID: expectedUserID
      )
      return connection
    } catch {
      await connection.close()
      throw error
    }
  }

  public func identity() throws -> SupatermHostIdentity {
    guard case .ready = phase, let hostIdentity else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    return hostIdentity
  }

  private func request(_ body: SupatermHostRequest) async throws -> SupatermHostMessage {
    guard case .ready = phase else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    return try await send(body).message
  }

  public func create(
    terminalID: TerminalID,
    command: SupatermHostCommand,
    size: SupatermHostTerminalSize = SupatermHostTerminalSize()
  ) async throws -> SupatermHostTerminalInfo {
    let response = try await request(.create(terminalID: terminalID, command: command, size: size))
    guard case .created(let terminal) = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    return terminal
  }

  public func list() async throws -> [SupatermHostTerminalInfo] {
    let response = try await request(.list)
    guard case .terminals(let terminals) = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    return terminals
  }

  public func get(terminalID: TerminalID) async throws -> SupatermHostTerminalInfo {
    let response = try await request(.get(terminalID: terminalID))
    guard case .terminal(let terminal) = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    return terminal
  }

  public func attach(
    terminalID: TerminalID,
    size: SupatermHostTerminalSize = SupatermHostTerminalSize()
  ) async throws -> SupatermHostAttachment {
    guard case .ready = phase else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    let completed = try await send(
      .attach(terminalID: terminalID, snapshotFormat: .vtReplayV1, size: size)
    )
    guard
      case .attached(
        let terminal,
        let attachmentID,
        let boundarySequence,
        _
      ) = completed.message
    else {
      throw SupatermHostConnectionError.unexpectedResponse(completed.message)
    }
    return SupatermHostAttachment(
      terminal: terminal,
      attachmentID: attachmentID,
      replay: completed.replay,
      boundarySequence: boundarySequence
    )
  }

  public func input(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    data: Data
  ) async throws {
    guard !data.isEmpty, data.count <= supatermHostMaximumTerminalDataBytes else {
      throw SupatermHostConnectionError.terminalDataLength(data.count)
    }
    let reservation = try acquireInput(
      terminalID: terminalID,
      attachmentID: attachmentID
    )
    do {
      let completed = try await send(
        .input(
          terminalID: terminalID,
          attachmentID: attachmentID,
          sequence: reservation.sequence,
          data: data
        ),
        requestID: reservation.requestID
      )
      guard case .inputCommitted = completed.message else {
        throw SupatermHostConnectionError.unexpectedResponse(completed.message)
      }
    } catch {
      releaseInputReservationIfUntracked(
        attachmentID: attachmentID,
        requestID: reservation.requestID
      )
      throw error
    }
  }

  public func resize(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    size: SupatermHostTerminalSize
  ) async throws {
    try await expectAck(
      .resize(terminalID: terminalID, attachmentID: attachmentID, size: size)
    )
  }

  public func detach(terminalID: TerminalID, attachmentID: AttachmentID) async throws {
    try await expectAck(.detach(terminalID: terminalID, attachmentID: attachmentID))
  }

  public func end(terminalID: TerminalID) async throws {
    try await expectAck(.end(terminalID: terminalID))
  }

  public func nextEvent() async throws -> SupatermHostMessage {
    try Task.checkCancellation()
    if !events.isEmpty {
      return events.removeFirst()
    }
    if let currentFailure {
      throw currentFailure
    }
    let waiterID = HostRequestID()
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        eventWaiters[waiterID] = continuation
        eventWaiterOrder.append(waiterID)
      }
    } onCancel: {
      Task { await self.cancelEventWaiter(waiterID) }
    }
  }

  public func close() {
    lifecycleTask?.cancel()
    lifecycleTask = nil
    networkConnection = nil
    fail(.connectionClosed)
  }

  private var currentFailure: SupatermHostConnectionError? {
    if case .failed(let error) = phase {
      return error
    }
    return nil
  }

  private func start() {
    let socketPath = socketURL.path
    lifecycleTask = Task { [weak self] in
      do {
        try await withNetworkConnection(
          to: .unix(path: socketPath),
          using: { TCP() },
          { [weak self] connection in
            guard self != nil else { return }
            try await self?.install(connection)
            while !Task.isCancelled {
              let envelope = try await Self.readEnvelope(from: connection)
              guard let owner = self else { return }
              try await owner.receive(envelope)
            }
          }
        )
        await self?.fail(.connectionClosed)
      } catch is CancellationError {
        await self?.fail(.connectionClosed)
      } catch let error as SupatermHostConnectionError {
        await self?.fail(error)
      } catch let error as SupatermHostFrameCodecError {
        await self?.fail(.protocolViolation(String(describing: error)))
      } catch is DecodingError {
        await self?.fail(.protocolViolation("host sent invalid JSON"))
      } catch {
        await self?.fail(.transport(String(describing: error)))
      }
    }
  }

  private func install(_ connection: NetworkConnection<TCP>) throws {
    guard case .starting = phase, networkConnection == nil else {
      throw SupatermHostConnectionError.protocolViolation("transport started twice")
    }
    try SupatermHostSocketSecurity.validate(
      socketURL: socketURL,
      expectedUserID: expectedUserID
    )
    networkConnection = connection
    let waiters = transportWaiters.values
    transportWaiters.removeAll()
    for waiter in waiters {
      waiter.resume()
    }
  }

  private func completeHello() async throws {
    let response = try await send(.hello(clientID: clientID)).message
    guard case .hello(let machineID, let bootID) = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    if let currentFailure {
      throw currentFailure
    }
    hostIdentity = SupatermHostIdentity(machineID: machineID, bootID: bootID)
    phase = .ready
  }

  private func send(
    _ body: SupatermHostRequest,
    requestID: HostRequestID = HostRequestID()
  ) async throws -> CompletedResponse {
    try Task.checkCancellation()
    try await waitForTransport()
    guard networkConnection != nil else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    guard
      pendingRequests.count + canceledRequests.count + cleanupRequests.count
        < requestCapacity
    else {
      throw SupatermHostConnectionError.requestBufferOverflow(requestCapacity)
    }
    let envelope = SupatermHostClientEnvelope(role: role, requestID: requestID, body: body)
    let data = try codec.encode(envelope)
    return try await withTaskCancellationHandler {
      try Task.checkCancellation()
      return try await withCheckedThrowingContinuation { continuation in
        let replay: AttachReplayState?
        if case .attach = body {
          replay = AttachReplayState()
        } else {
          replay = nil
        }
        pendingRequests[requestID] = PendingRequest(
          body: body,
          continuation: continuation,
          replay: replay
        )
        outboundFrames.append(OutboundFrame(requestID: requestID, data: data))
        startWriterIfNeeded()
      }
    } onCancel: {
      Task { await self.cancelRequest(requestID) }
    }
  }

  private func waitForTransport() async throws {
    if networkConnection != nil {
      return
    }
    if let currentFailure {
      throw currentFailure
    }
    let waiterID = HostRequestID()
    try await withTaskCancellationHandler {
      try Task.checkCancellation()
      try await withCheckedThrowingContinuation { continuation in
        transportWaiters[waiterID] = continuation
      }
    } onCancel: {
      Task { await self.cancelTransportWaiter(waiterID) }
    }
  }

  private func startWriterIfNeeded() {
    guard writerTask == nil, !outboundFrames.isEmpty else { return }
    let frame = outboundFrames.removeFirst()
    guard let networkConnection else {
      fail(.connectionClosed)
      return
    }
    writerTask = Task { [weak self] in
      do {
        try await networkConnection.send(frame.data)
        await self?.finishedWriting(error: nil)
      } catch {
        await self?.finishedWriting(error: .transport(String(describing: error)))
      }
    }
  }

  private func finishedWriting(error: SupatermHostConnectionError?) {
    writerTask = nil
    if let error {
      fail(error)
    } else {
      startWriterIfNeeded()
    }
  }

  private nonisolated static func readEnvelope(
    from connection: NetworkConnection<TCP>
  ) async throws -> SupatermHostEnvelope {
    let codec = SupatermHostFrameCodec()
    let header = try await connection.receive(exactly: MemoryLayout<UInt32>.size).content
    let payloadLength = try codec.decodePayloadLength(header)
    let payload = try await connection.receive(exactly: payloadLength).content
    return try codec.decodePayload(SupatermHostEnvelope.self, from: payload)
  }

  private func receive(_ envelope: SupatermHostEnvelope) throws {
    guard envelope.epoch == supatermHostProtocolEpoch, envelope.role == .host else {
      throw SupatermHostConnectionError.protocolViolation("invalid host envelope")
    }
    if let requestID = envelope.requestID {
      guard !envelope.body.isEvent else {
        throw SupatermHostConnectionError.protocolViolation("event has a request ID")
      }
      try receiveResponse(envelope.body, requestID: requestID)
      return
    }
    guard envelope.body.isEvent else {
      throw SupatermHostConnectionError.protocolViolation("response has no request ID")
    }
    if try validateEvent(envelope.body) {
      try enqueueEvent(envelope.body)
    }
  }

  private func receiveResponse(
    _ message: SupatermHostMessage,
    requestID: HostRequestID
  ) throws {
    if let cleanup = cleanupRequests[requestID] {
      try receiveCleanupResponse(message, requestID: requestID, cleanup: cleanup)
      return
    }
    if let canceled = canceledRequests[requestID] {
      try receiveCanceledResponse(message, requestID: requestID, canceled: canceled)
      return
    }
    guard var pending = pendingRequests[requestID] else {
      throw SupatermHostConnectionError.protocolViolation("response has no matching request")
    }
    if case .error(let code, let message) = message {
      handleRemoteError(code, for: pending.body, requestID: requestID)
      pendingRequests.removeValue(forKey: requestID)
      pending.continuation.resume(
        throwing: SupatermHostConnectionError.remote(code: code, message: message)
      )
      return
    }
    if case .attachReplay(let attachmentID, let segment, let data) = message {
      guard case .attach = pending.body, var replay = pending.replay else {
        throw SupatermHostConnectionError.protocolViolation(
          "attach replay does not match its request"
        )
      }
      try appendReplay(
        attachmentID: attachmentID,
        segment: segment,
        data: data,
        to: &replay,
        storesData: true
      )
      pending.replay = replay
      pendingRequests[requestID] = pending
      return
    }
    guard response(message, matches: pending.body) else {
      throw SupatermHostConnectionError.protocolViolation("response does not match its request")
    }
    try validateFinalReplay(message, replay: pending.replay)
    try validateTerminalBootIDs(in: message)
    try registerResponse(message, for: pending.body, requestID: requestID)
    pendingRequests.removeValue(forKey: requestID)
    pending.continuation.resume(
      returning: CompletedResponse(message: message, replay: pending.replay?.chunks ?? [])
    )
  }

  private func receiveCanceledResponse(
    _ message: SupatermHostMessage,
    requestID: HostRequestID,
    canceled: CanceledRequest
  ) throws {
    if case .error(let code, _) = message {
      if canceled.reconcilesState {
        handleRemoteError(code, for: canceled.body, requestID: requestID)
      }
      canceledRequests.removeValue(forKey: requestID)
      return
    }
    if case .attachReplay(let attachmentID, let segment, let data) = message {
      guard case .attach = canceled.body, var replay = canceled.replay else {
        throw SupatermHostConnectionError.protocolViolation(
          "attach replay does not match its canceled request"
        )
      }
      try appendReplay(
        attachmentID: attachmentID,
        segment: segment,
        data: data,
        to: &replay,
        storesData: false
      )
      canceledRequests[requestID] = CanceledRequest(
        body: canceled.body,
        replay: replay,
        reconcilesState: canceled.reconcilesState
      )
      return
    }
    guard response(message, matches: canceled.body) else {
      throw SupatermHostConnectionError.protocolViolation(
        "response does not match its canceled request"
      )
    }
    try validateFinalReplay(message, replay: canceled.replay)
    try validateTerminalBootIDs(in: message)
    if case .attach = canceled.body {
      canceledRequests.removeValue(forKey: requestID)
      guard case .attached(let terminal, let attachmentID, _, _) = message else {
        throw SupatermHostConnectionError.protocolViolation(
          "canceled attach did not complete with an attachment"
        )
      }
      try registerResponse(message, for: canceled.body, requestID: requestID)
      try enqueueCleanupDetach(
        terminalID: terminal.id,
        attachmentID: attachmentID
      )
      return
    }
    if canceled.reconcilesState {
      try registerResponse(message, for: canceled.body, requestID: requestID)
    }
    canceledRequests.removeValue(forKey: requestID)
  }

  private func enqueueCleanupDetach(
    terminalID: TerminalID,
    attachmentID: AttachmentID
  ) throws {
    let requestID = HostRequestID()
    let body = SupatermHostRequest.detach(
      terminalID: terminalID,
      attachmentID: attachmentID
    )
    let envelope = SupatermHostClientEnvelope(
      role: role,
      requestID: requestID,
      body: body
    )
    let data = try codec.encode(envelope)
    cleanupRequests[requestID] = CleanupRequest(
      terminalID: terminalID,
      attachmentID: attachmentID
    )
    outboundFrames.append(
      OutboundFrame(requestID: requestID, data: data)
    )
    startWriterIfNeeded()
  }

  private func receiveCleanupResponse(
    _ message: SupatermHostMessage,
    requestID: HostRequestID,
    cleanup: CleanupRequest
  ) throws {
    switch message {
    case .ack:
      break
    case .error(let code, _)
    where code == .notAttached || code == .notFound || code == .terminalExited:
      break
    default:
      throw SupatermHostConnectionError.protocolViolation(
        "canceled attach cleanup received an invalid response"
      )
    }
    cleanupRequests.removeValue(forKey: requestID)
    removeOutputCursor(
      terminalID: cleanup.terminalID,
      attachmentID: cleanup.attachmentID
    )
  }

  private func cleanupRequest(for attachmentID: AttachmentID) -> CleanupRequest? {
    cleanupRequests.values.first { $0.attachmentID == attachmentID }
  }

  private func appendReplay(
    attachmentID: AttachmentID,
    segment: SupatermHostAttachReplaySegment,
    data: Data,
    to replay: inout AttachReplayState,
    storesData: Bool
  ) throws {
    if let expectedAttachmentID = replay.attachmentID {
      guard expectedAttachmentID == attachmentID else {
        throw SupatermHostConnectionError.protocolViolation(
          "attach replay changed attachment ID"
        )
      }
    } else {
      replay.attachmentID = attachmentID
    }
    if let lastSegment = replay.lastSegment {
      guard replayOrder(segment) >= replayOrder(lastSegment) else {
        throw SupatermHostConnectionError.protocolViolation(
          "attach replay segment order regressed"
        )
      }
    }
    let (byteCount, overflow) = replay.byteCount.addingReportingOverflow(data.count)
    guard !overflow, byteCount <= attachReplayCapacity else {
      throw SupatermHostConnectionError.attachReplayBufferOverflow(attachReplayCapacity)
    }
    replay.lastSegment = segment
    replay.byteCount = byteCount
    if storesData {
      replay.append(data, to: segment)
    }
  }

  private func replayOrder(_ segment: SupatermHostAttachReplaySegment) -> Int {
    switch segment {
    case .vt:
      return 0
    case .title:
      return 1
    case .continuation:
      return 2
    }
  }

  private func validateFinalReplay(
    _ message: SupatermHostMessage,
    replay: AttachReplayState?
  ) throws {
    guard
      case .attached(_, let attachmentID, _, _) = message,
      let replayAttachmentID = replay?.attachmentID
    else { return }
    guard replayAttachmentID == attachmentID else {
      throw SupatermHostConnectionError.protocolViolation(
        "attach replay does not match final attachment"
      )
    }
  }

  private func response(
    _ message: SupatermHostMessage,
    matches request: SupatermHostRequest
  ) -> Bool {
    switch (request, message) {
    case (.hello, .hello):
      return true
    case (.create(let requestedID, _, _), .created(let terminal)):
      return terminal.id == requestedID
    case (.list, .terminals):
      return true
    case (.get(let requestedID), .terminal(let terminal)):
      return terminal.id == requestedID
    case (
      .attach(let requestedID, _, _),
      .attached(let terminal, _, _, _)
    ):
      return terminal.id == requestedID
    case (
      .input(_, _, let sequence, _),
      .inputCommitted(let nextInputSequence)
    ):
      let (expected, overflow) = sequence.addingReportingOverflow(1)
      return !overflow && nextInputSequence == expected
    case (.resize, .ack), (.detach, .ack), (.end, .ack):
      return true
    default:
      return false
    }
  }

  private func validateTerminalBootIDs(in message: SupatermHostMessage) throws {
    let terminals: [SupatermHostTerminalInfo]
    switch message {
    case .created(let terminal), .attached(let terminal, _, _, _):
      terminals = [terminal]
    case .terminal(let terminal):
      terminals = terminal.status.requiresCurrentBoot ? [terminal] : []
    case .terminals(let values):
      terminals = values.filter { $0.status.requiresCurrentBoot }
    default:
      return
    }
    guard let currentBootID = hostIdentity?.bootID else {
      throw SupatermHostConnectionError.protocolViolation(
        "terminal arrived before host identity"
      )
    }
    guard terminals.allSatisfy({ $0.bootID == currentBootID }) else {
      throw SupatermHostConnectionError.protocolViolation(
        "active terminal boot ID does not match host"
      )
    }
  }

  private func registerResponse(
    _ message: SupatermHostMessage,
    for request: SupatermHostRequest,
    requestID: HostRequestID
  ) throws {
    switch (request, message) {
    case (
      .attach,
      .attached(
        let terminal,
        let attachmentID,
        let boundarySequence,
        let nextInputSequence
      )
    ):
      guard outputCursors[attachmentID] == nil else {
        throw SupatermHostConnectionError.protocolViolation(
          "host reused an attachment ID"
        )
      }
      outputCursors[attachmentID] = OutputCursor(
        terminalID: terminal.id,
        nextOutputSequence: boundarySequence,
        nextInputSequence: nextInputSequence,
        inputState: terminal.inputState,
        inputRequestID: nil
      )
    case (
      .input(let terminalID, let attachmentID, let sequence, _),
      .inputCommitted(let nextInputSequence)
    ):
      guard
        var cursor = outputCursors[attachmentID],
        cursor.terminalID == terminalID,
        cursor.inputRequestID == requestID,
        cursor.nextInputSequence == sequence
      else {
        throw SupatermHostConnectionError.protocolViolation(
          "input commit has no matching reservation"
        )
      }
      cursor.nextInputSequence = nextInputSequence
      cursor.inputRequestID = nil
      outputCursors[attachmentID] = cursor
    case (.detach(let terminalID, let attachmentID), .ack):
      removeOutputCursor(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
      revokePendingRequests(
        terminalID: terminalID,
        attachmentID: attachmentID,
        error: SupatermHostConnectionError.inputUnavailable(
          terminalID: terminalID,
          attachmentID: attachmentID,
          state: .closed
        ),
        excluding: requestID
      )
    default:
      break
    }
  }

  private func handleRemoteError(
    _ code: SupatermHostErrorCode,
    for request: SupatermHostRequest,
    requestID: HostRequestID
  ) {
    guard
      let (terminalID, attachmentID) = attachmentIdentity(for: request),
      var cursor = outputCursors[attachmentID],
      cursor.terminalID == terminalID
    else { return }
    let isInput: Bool
    if case .input = request {
      isInput = true
    } else {
      isInput = false
    }
    if isInput, cursor.inputRequestID == requestID {
      cursor.inputRequestID = nil
    }
    switch code {
    case .inputUncertain where isInput:
      cursor.inputState = .uncertain
      outputCursors[attachmentID] = cursor
    case .terminalExited:
      cursor.inputState = .closed
      outputCursors[attachmentID] = cursor
    case .notAttached:
      removeOutputCursor(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
      revokePendingRequests(
        terminalID: terminalID,
        attachmentID: attachmentID,
        error: SupatermHostConnectionError.remote(
          code: .notAttached,
          message: "attachment is no longer active"
        ),
        excluding: requestID
      )
    default:
      outputCursors[attachmentID] = cursor
    }
  }

  private func validateEvent(_ event: SupatermHostMessage) throws -> Bool {
    switch event {
    case .output(let terminalID, let attachmentID, let sequence, let data):
      guard data.count <= supatermHostMaximumTerminalDataBytes else {
        throw SupatermHostConnectionError.terminalDataLength(data.count)
      }
      guard var cursor = outputCursors[attachmentID], cursor.terminalID == terminalID else {
        throw SupatermHostConnectionError.protocolViolation("output has no matching attachment")
      }
      guard cursor.nextOutputSequence == sequence else {
        throw SupatermHostConnectionError.outputSequence(
          terminalID: terminalID,
          attachmentID: attachmentID,
          expected: cursor.nextOutputSequence,
          actual: sequence
        )
      }
      let (nextSequence, overflow) = sequence.addingReportingOverflow(UInt64(data.count))
      guard !overflow else {
        throw SupatermHostConnectionError.protocolViolation("output sequence overflow")
      }
      cursor.nextOutputSequence = nextSequence
      outputCursors[attachmentID] = cursor
      return cleanupRequest(for: attachmentID) == nil
    case .resyncRequired(let terminalID, let attachmentID):
      guard outputCursors[attachmentID]?.terminalID == terminalID else {
        throw SupatermHostConnectionError.protocolViolation(
          "resync has no matching attachment"
        )
      }
      let error = SupatermHostConnectionError.resyncRequired(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
      removeOutputCursor(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
      if cleanupRequest(for: attachmentID) != nil {
        return false
      }
      revokePendingRequests(
        terminalID: terminalID,
        attachmentID: attachmentID,
        error: error
      )
      return true
    case .exited(let terminalID, _):
      for (attachmentID, var cursor) in outputCursors
      where cursor.terminalID == terminalID {
        cursor.inputState = .closed
        outputCursors[attachmentID] = cursor
      }
      return true
    default:
      throw SupatermHostConnectionError.protocolViolation("host sent a non-event")
    }
  }

  private func enqueueEvent(_ event: SupatermHostMessage) throws {
    while let waiterID = eventWaiterOrder.first {
      eventWaiterOrder.removeFirst()
      if let waiter = eventWaiters.removeValue(forKey: waiterID) {
        waiter.resume(returning: event)
        return
      }
    }
    guard events.count < eventCapacity else {
      throw SupatermHostConnectionError.eventBufferOverflow(eventCapacity)
    }
    events.append(event)
  }

  private func acquireInput(
    terminalID: TerminalID,
    attachmentID: AttachmentID
  ) throws -> InputReservation {
    try Task.checkCancellation()
    guard
      var cursor = outputCursors[attachmentID],
      cursor.terminalID == terminalID
    else {
      throw SupatermHostConnectionError.protocolViolation(
        "input has no matching attachment"
      )
    }
    guard cursor.inputState == .ready else {
      throw SupatermHostConnectionError.inputUnavailable(
        terminalID: terminalID,
        attachmentID: attachmentID,
        state: cursor.inputState
      )
    }
    guard cursor.inputRequestID == nil else {
      throw SupatermHostConnectionError.inputInFlight(
        terminalID: terminalID,
        attachmentID: attachmentID
      )
    }
    let reservationID = HostRequestID()
    cursor.inputRequestID = reservationID
    outputCursors[attachmentID] = cursor
    return InputReservation(
      requestID: reservationID,
      sequence: cursor.nextInputSequence
    )
  }

  private func releaseInputReservationIfUntracked(
    attachmentID: AttachmentID,
    requestID: HostRequestID
  ) {
    guard pendingRequests[requestID] == nil, canceledRequests[requestID] == nil else {
      return
    }
    releaseInputReservation(attachmentID: attachmentID, requestID: requestID)
  }

  private func releaseInputReservation(
    attachmentID: AttachmentID,
    requestID: HostRequestID
  ) {
    guard
      var cursor = outputCursors[attachmentID],
      cursor.inputRequestID == requestID
    else { return }
    cursor.inputRequestID = nil
    outputCursors[attachmentID] = cursor
  }

  private func removeOutputCursor(
    terminalID: TerminalID,
    attachmentID: AttachmentID
  ) {
    if let cursor = outputCursors[attachmentID], cursor.terminalID == terminalID {
      outputCursors.removeValue(forKey: attachmentID)
    }
  }

  private func attachmentIdentity(
    for request: SupatermHostRequest
  ) -> (TerminalID, AttachmentID)? {
    switch request {
    case .input(let terminalID, let attachmentID, _, _),
      .resize(let terminalID, let attachmentID, _),
      .detach(let terminalID, let attachmentID):
      return (terminalID, attachmentID)
    default:
      return nil
    }
  }

  private func revokePendingRequests(
    terminalID: TerminalID,
    attachmentID: AttachmentID,
    error: SupatermHostConnectionError,
    excluding excludedRequestID: HostRequestID? = nil
  ) {
    let requestIDs: [HostRequestID] = pendingRequests.compactMap { requestID, pending in
      guard
        requestID != excludedRequestID,
        let identity = attachmentIdentity(for: pending.body),
        identity == (terminalID, attachmentID)
      else { return nil }
      return requestID
    }
    for requestID in requestIDs {
      guard let pending = pendingRequests.removeValue(forKey: requestID) else { continue }
      if let frameIndex = outboundFrames.firstIndex(where: { $0.requestID == requestID }) {
        outboundFrames.remove(at: frameIndex)
      } else {
        var replay = pending.replay
        replay?.discardData()
        canceledRequests[requestID] = CanceledRequest(
          body: pending.body,
          replay: replay,
          reconcilesState: false
        )
      }
      pending.continuation.resume(throwing: error)
    }
    let canceledRequestIDs: [HostRequestID] = canceledRequests.compactMap {
      requestID, canceled in
      guard
        requestID != excludedRequestID,
        let identity = attachmentIdentity(for: canceled.body),
        identity == (terminalID, attachmentID)
      else { return nil }
      return requestID
    }
    for requestID in canceledRequestIDs {
      guard let canceled = canceledRequests[requestID] else { continue }
      canceledRequests[requestID] = CanceledRequest(
        body: canceled.body,
        replay: canceled.replay,
        reconcilesState: false
      )
    }
  }

  private func cancelTransportWaiter(_ waiterID: HostRequestID) {
    guard let waiter = transportWaiters.removeValue(forKey: waiterID) else { return }
    waiter.resume(throwing: CancellationError())
  }

  private func cancelRequest(_ requestID: HostRequestID) {
    guard let pending = pendingRequests.removeValue(forKey: requestID) else { return }
    if let frameIndex = outboundFrames.firstIndex(where: { $0.requestID == requestID }) {
      outboundFrames.remove(at: frameIndex)
      if case .input(_, let attachmentID, _, _) = pending.body {
        releaseInputReservation(
          attachmentID: attachmentID,
          requestID: requestID
        )
      }
    } else {
      var replay = pending.replay
      replay?.discardData()
      canceledRequests[requestID] = CanceledRequest(
        body: pending.body,
        replay: replay,
        reconcilesState: true
      )
    }
    pending.continuation.resume(throwing: CancellationError())
  }

  private func cancelEventWaiter(_ waiterID: HostRequestID) {
    guard let waiter = eventWaiters.removeValue(forKey: waiterID) else { return }
    eventWaiterOrder.removeAll { $0 == waiterID }
    waiter.resume(throwing: CancellationError())
  }

  private func expectAck(_ request: SupatermHostRequest) async throws {
    let response = try await self.request(request)
    guard case .ack = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
  }

  private func fail(_ error: SupatermHostConnectionError) {
    guard currentFailure == nil else { return }
    lifecycleTask?.cancel()
    lifecycleTask = nil
    phase = .failed(error)
    networkConnection = nil
    writerTask?.cancel()
    writerTask = nil
    outboundFrames.removeAll()
    outputCursors.removeAll()
    canceledRequests.removeAll()
    cleanupRequests.removeAll()

    let transportWaiters = transportWaiters.values
    self.transportWaiters.removeAll()
    for waiter in transportWaiters {
      waiter.resume(throwing: error)
    }

    let pendingRequests = pendingRequests.values
    self.pendingRequests.removeAll()
    for pending in pendingRequests {
      pending.continuation.resume(throwing: error)
    }

    let eventWaiters = eventWaiters.values
    self.eventWaiters.removeAll()
    eventWaiterOrder.removeAll()
    for waiter in eventWaiters {
      waiter.resume(throwing: error)
    }
  }
}

extension SupatermHostTerminalStatus {
  fileprivate var requiresCurrentBoot: Bool {
    switch self {
    case .starting, .running, .exiting:
      true
    case .exited, .failed, .interrupted:
      false
    }
  }
}
