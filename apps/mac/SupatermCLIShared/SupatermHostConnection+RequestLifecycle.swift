import Foundation
import Network

extension SupatermHostConnection {
  func acquireAttachLane(terminalID: TerminalID) async throws {
    try Task.checkCancellation()
    if activeAttachTerminals.insert(terminalID).inserted {
      do {
        try Task.checkCancellation()
        return
      } catch {
        releaseAttachLane(terminalID: terminalID)
        throw error
      }
    }
    let id = UUID()
    try await withTaskCancellationHandler {
      try Task.checkCancellation()
      try await withCheckedThrowingContinuation {
        (continuation: CheckedContinuation<Void, any Error>) in
        if Task.isCancelled {
          continuation.resume(throwing: CancellationError())
        } else {
          attachWaiters[terminalID, default: []].append(
            AttachWaiter(id: id, continuation: continuation)
          )
        }
      }
    } onCancel: {
      Task { await self.cancelAttachWaiter(id, terminalID: terminalID) }
    }
    do {
      try Task.checkCancellation()
    } catch {
      releaseAttachLane(terminalID: terminalID)
      throw error
    }
  }

  private func cancelAttachWaiter(_ id: UUID, terminalID: TerminalID) {
    guard
      var waiters = attachWaiters[terminalID],
      let index = waiters.firstIndex(where: { $0.id == id })
    else { return }
    let waiter = waiters.remove(at: index)
    if waiters.isEmpty {
      attachWaiters.removeValue(forKey: terminalID)
    } else {
      attachWaiters[terminalID] = waiters
    }
    waiter.continuation.resume(throwing: CancellationError())
  }

  func releaseAttachLane(terminalID: TerminalID) {
    guard activeAttachTerminals.contains(terminalID) else { return }
    if var waiters = attachWaiters[terminalID], !waiters.isEmpty {
      let waiter = waiters.removeFirst()
      if waiters.isEmpty {
        attachWaiters.removeValue(forKey: terminalID)
      } else {
        attachWaiters[terminalID] = waiters
      }
      waiter.continuation.resume()
    } else {
      activeAttachTerminals.remove(terminalID)
    }
  }

  func startWriterIfNeeded() {
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
        await self?.finishedWriting(
          error: .transport(SupatermHostTransportFailure(error))
        )
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

  nonisolated static func readEnvelope(
    from connection: NetworkConnection<TCP>
  ) async throws -> SupatermHostEnvelope {
    let codec = SupatermHostFrameCodec()
    let header = try await connection.receive(exactly: MemoryLayout<UInt32>.size).content
    let payloadLength = try codec.decodePayloadLength(header)
    let payload = try await connection.receive(exactly: payloadLength).content
    return try codec.decodePayload(SupatermHostEnvelope.self, from: payload)
  }

  func receive(_ envelope: SupatermHostEnvelope) throws {
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
      if case .attach(let terminalID, _, _) = canceled.body {
        releaseAttachLane(terminalID: terminalID)
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

  func enqueueCleanupDetach(
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
    releaseAttachLane(terminalID: cleanup.terminalID)
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
    case (.reserve, .reserved):
      return true
    case (.launch(_, let requestedID, _, _), .launched(let terminal)):
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
    case (.cancelReservation, .ack), (.resize, .ack), (.detach, .ack), (.end, .ack):
      return true
    default:
      return false
    }
  }

  private func validateTerminalBootIDs(in message: SupatermHostMessage) throws {
    let terminals: [SupatermHostTerminalInfo]
    switch message {
    case .launched(let terminal), .attached(let terminal, _, _, _):
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

  func acquireInput(
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

  func releaseInputReservationIfUntracked(
    attachmentID: AttachmentID,
    requestID: HostRequestID
  ) {
    guard pendingRequests[requestID] == nil, canceledRequests[requestID] == nil else {
      return
    }
    releaseInputReservation(attachmentID: attachmentID, requestID: requestID)
  }

  func releaseInputReservation(
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
}
