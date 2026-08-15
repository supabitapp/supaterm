import Foundation
import Network

public actor SupatermHostConnection {
  public nonisolated let role: SupatermHostClientRole
  public nonisolated let socketURL: URL

  struct PendingRequest {
    let body: SupatermHostRequest
    let continuation: CheckedContinuation<CompletedResponse, any Error>
    var replay: AttachReplayState?
  }

  struct CanceledRequest {
    let body: SupatermHostRequest
    var replay: AttachReplayState?
    let reconcilesState: Bool
  }

  struct CleanupRequest {
    let terminalID: TerminalID
    let attachmentID: AttachmentID
  }

  struct AttachWaiter {
    let id: UUID
    let continuation: CheckedContinuation<Void, any Error>
  }

  struct CompletedResponse {
    let message: SupatermHostMessage
    let replay: [SupatermHostAttachReplayChunk]
  }

  struct AttachReplayState {
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

  struct OutboundFrame {
    let requestID: HostRequestID
    let data: Data
  }

  struct InputReservation {
    let requestID: HostRequestID
    let sequence: UInt64
  }

  struct OutputCursor {
    let terminalID: TerminalID
    var nextOutputSequence: UInt64
    var nextInputSequence: UInt64
    var inputState: SupatermHostInputState
    var inputRequestID: HostRequestID?
  }

  enum Phase {
    case starting
    case ready
    case failed(SupatermHostConnectionError)
  }

  let clientID: ClientID
  let expectedUserID: uid_t
  let eventCapacity: Int
  let requestCapacity: Int
  let attachReplayCapacity: Int
  let codec = SupatermHostFrameCodec()
  var phase = Phase.starting
  var hostIdentity: SupatermHostIdentity?
  var networkConnection: NetworkConnection<TCP>?
  var lifecycleTask: Task<Void, Never>?
  var transportWaiters: [HostRequestID: CheckedContinuation<Void, any Error>] = [:]
  var pendingRequests: [HostRequestID: PendingRequest] = [:]
  var canceledRequests: [HostRequestID: CanceledRequest] = [:]
  var cleanupRequests: [HostRequestID: CleanupRequest] = [:]
  var activeAttachTerminals: Set<TerminalID> = []
  var attachWaiters: [TerminalID: [AttachWaiter]] = [:]
  var outboundFrames: [OutboundFrame] = []
  var writerTask: Task<Void, Never>?
  var events: [SupatermHostMessage] = []
  var eventWaiters: [HostRequestID: CheckedContinuation<SupatermHostMessage, any Error>] =
    [:]
  var eventWaiterOrder: [HostRequestID] = []
  var outputCursors: [AttachmentID: OutputCursor] = [:]

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

  func request(_ body: SupatermHostRequest) async throws -> SupatermHostMessage {
    guard case .ready = phase else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    return try await send(body).message
  }

  public func reserve(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID,
    size: SupatermHostTerminalSize = SupatermHostTerminalSize(),
    startupInput: String,
    startupInputDelivery: SupatermHostStartupInputDelivery
  ) async throws {
    let startupInputLength = startupInput.utf8.count
    guard startupInputLength <= supatermHostMaximumTerminalDataBytes else {
      throw SupatermHostConnectionError.startupInputLength(startupInputLength)
    }
    let response = try await request(
      .reserve(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        size: size,
        startupInput: startupInput,
        startupInputDelivery: startupInputDelivery
      )
    )
    guard case .reserved = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    try Task.checkCancellation()
  }

  public func launch(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID,
    command: SupatermHostCommand,
    size: SupatermHostTerminalSize = SupatermHostTerminalSize()
  ) async throws -> SupatermHostTerminalInfo {
    let response = try await request(
      .launch(
        launchTicketID: launchTicketID,
        terminalID: terminalID,
        command: command,
        size: size
      )
    )
    guard case .launched(let terminal) = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
    return terminal
  }

  public func cancelReservation(
    launchTicketID: LaunchTicketID,
    terminalID: TerminalID
  ) async throws {
    try await expectAck(
      .cancelReservation(
        launchTicketID: launchTicketID,
        terminalID: terminalID
      )
    )
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
    try await acquireAttachLane(terminalID: terminalID)
    let requestID = HostRequestID()
    var retainsLaneForCleanup = false
    do {
      guard case .ready = phase else {
        throw currentFailure ?? SupatermHostConnectionError.connectionClosed
      }
      let completed = try await send(
        .attach(terminalID: terminalID, snapshotFormat: .vtReplayV1, size: size),
        requestID: requestID
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
      if Task.isCancelled {
        do {
          try enqueueCleanupDetach(
            terminalID: terminal.id,
            attachmentID: attachmentID
          )
          retainsLaneForCleanup = true
        } catch {
          fail(.protocolViolation("could not encode canceled attach cleanup"))
          throw error
        }
        throw CancellationError()
      }
      releaseAttachLane(terminalID: terminalID)
      return SupatermHostAttachment(
        terminal: terminal,
        attachmentID: attachmentID,
        replay: completed.replay,
        boundarySequence: boundarySequence
      )
    } catch {
      if case .attach = canceledRequests[requestID]?.body {
        retainsLaneForCleanup = true
      }
      if !retainsLaneForCleanup {
        releaseAttachLane(terminalID: terminalID)
      }
      throw error
    }
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

  var currentFailure: SupatermHostConnectionError? {
    if case .failed(let error) = phase {
      return error
    }
    return nil
  }

  func start() {
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
        await self?.fail(.transport(SupatermHostTransportFailure(error)))
      }
    }
  }

  func install(_ connection: NetworkConnection<TCP>) throws {
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

  func completeHello() async throws {
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

  func send(
    _ body: SupatermHostRequest,
    requestID: HostRequestID = HostRequestID()
  ) async throws -> CompletedResponse {
    try Task.checkCancellation()
    try await waitForTransport()
    guard networkConnection != nil else {
      throw currentFailure ?? SupatermHostConnectionError.connectionClosed
    }
    let requestCount = pendingRequests.count + canceledRequests.count + cleanupRequests.count
    let usesReservedCleanupSlot: Bool
    if case .cancelReservation = body {
      usesReservedCleanupSlot = requestCount == requestCapacity
    } else {
      usesReservedCleanupSlot = false
    }
    guard requestCount < requestCapacity || usesReservedCleanupSlot else {
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

  func waitForTransport() async throws {
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

  func cancelTransportWaiter(_ waiterID: HostRequestID) {
    guard let waiter = transportWaiters.removeValue(forKey: waiterID) else { return }
    waiter.resume(throwing: CancellationError())
  }

  func cancelRequest(_ requestID: HostRequestID) {
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

  func cancelEventWaiter(_ waiterID: HostRequestID) {
    guard let waiter = eventWaiters.removeValue(forKey: waiterID) else { return }
    eventWaiterOrder.removeAll { $0 == waiterID }
    waiter.resume(throwing: CancellationError())
  }

  func expectAck(_ request: SupatermHostRequest) async throws {
    let response = try await self.request(request)
    guard case .ack = response else {
      throw SupatermHostConnectionError.unexpectedResponse(response)
    }
  }

  func fail(_ error: SupatermHostConnectionError) {
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
    activeAttachTerminals.removeAll()

    let attachWaiters = attachWaiters.values.flatMap { $0 }
    self.attachWaiters.removeAll()
    for waiter in attachWaiters {
      waiter.continuation.resume(throwing: error)
    }

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
  var requiresCurrentBoot: Bool {
    switch self {
    case .starting, .running, .exiting:
      true
    case .exited, .failed, .interrupted:
      false
    }
  }
}
