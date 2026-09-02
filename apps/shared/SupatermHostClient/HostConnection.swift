import Foundation

public struct HostTransportLink: Sendable {
  public let incoming: AsyncThrowingStream<Data, any Error>
  private let sendBytes: @Sendable (Data) async throws -> Void
  private let closeLink: @Sendable () async -> Void

  public init(
    incoming: AsyncThrowingStream<Data, any Error>,
    send: @escaping @Sendable (Data) async throws -> Void,
    close: @escaping @Sendable () async -> Void
  ) {
    self.incoming = incoming
    sendBytes = send
    closeLink = close
  }

  public func send(_ data: Data) async throws {
    try await sendBytes(data)
  }

  public func close() async {
    await closeLink()
  }
}

public protocol HostTransport: Sendable {
  func open() async throws -> HostTransportLink
}

public struct HostConnectionConfiguration: Sendable {
  public typealias CapabilityHandler = @Sendable (HostCapabilityRequest) async throws -> HostJSONValue

  public let build: HostBuildIdentity
  public let role: HostClientRole
  public let clientID: HostClientID?
  public let capabilities: [String]
  public let limits: HostLimits
  public let capabilityHandler: CapabilityHandler

  public init(
    build: HostBuildIdentity,
    role: HostClientRole = .ui,
    clientID: HostClientID?,
    capabilities: [String] = ["semantic_state", "terminal_snapshot"],
    limits: HostLimits = HostLimits(),
    capabilityHandler: @escaping CapabilityHandler = { _ in
      throw HostProtocolError(code: .capabilityUnavailable)
    }
  ) {
    self.build = build
    self.role = role
    self.clientID = clientID
    self.capabilities = capabilities
    self.limits = limits
    self.capabilityHandler = capabilityHandler
  }
}

public enum HostConnectionEvent: Equatable, Sendable {
  case connecting
  case welcomed(HostWelcome)
  case subscription(HostSubscription)
  case epochChanged
  case resyncRequired
  case disconnected(String)
}

public struct HostTerminalAttachment: Sendable {
  public let streamID: UInt32
  public let events: AsyncStream<HostTerminalEvent>
}

public actor HostConnection {
  public nonisolated let events: AsyncStream<HostConnectionEvent>

  private let transport: any HostTransport
  private let configuration: HostConnectionConfiguration
  private let eventContinuation: AsyncStream<HostConnectionEvent>.Continuation
  private var connectionTask: Task<Void, Never>?
  private var link: HostTransportLink?
  private var decoder = HostFrameDecoder()
  private var pending: [HostCommandID: PendingRequest] = [:]
  private var cancelledRequests: [HostCommandID: UInt64] = [:]
  private var cancelledRequestSequence: UInt64 = 0
  private var terminals: [UInt32: AsyncStream<HostTerminalEvent>.Continuation] = [:]
  private var nextStreamID: UInt32 = 1
  private var currentEpoch: UUID?
  private var currentRevision: UInt64?
  private var stopped = true

  public init(transport: any HostTransport, configuration: HostConnectionConfiguration) {
    self.transport = transport
    self.configuration = configuration
    let pair = AsyncStream<HostConnectionEvent>.makeStream(bufferingPolicy: .bufferingNewest(256))
    events = pair.stream
    eventContinuation = pair.continuation
  }

  public func start() {
    guard stopped else { return }
    stopped = false
    let transport = self.transport
    connectionTask = Task { [weak self] in
      var delay = Duration.milliseconds(100)
      while !Task.isCancelled {
        self?.eventContinuation.yield(.connecting)
        do {
          let link = try await transport.open()
          guard self != nil else {
            await link.close()
            return
          }
          try await self?.begin(link)
          delay = .milliseconds(100)
          for try await bytes in link.incoming {
            try Task.checkCancellation()
            guard let connection = self else {
              await link.close()
              return
            }
            try await connection.ingest(bytes)
          }
          throw HostConnectionFailure.closed
        } catch is CancellationError {
          return
        } catch {
          await self?.lost(error)
        }
        try? await Task.sleep(for: delay)
        delay = min(delay * 2, .seconds(3))
      }
    }
  }

  public var isConnected: Bool {
    link != nil
  }

  public func stop() async {
    guard !stopped else { return }
    stopped = true
    connectionTask?.cancel()
    connectionTask = nil
    await link?.close()
    link = nil
    failAll(HostConnectionFailure.closed)
    finishTerminals()
    eventContinuation.yield(.disconnected("closed"))
  }

  public func resync() {
    guard link != nil else { return }
    currentRevision = nil
    eventContinuation.yield(.resyncRequired)
    subscribe()
  }

  public func request(
    method: String,
    params: HostJSONValue = .null
  ) async throws -> HostJSONValue {
    guard let link else { throw HostConnectionFailure.notConnected }
    let commandID = HostCommandID()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        pending[commandID] = PendingRequest(continuation: continuation)
        do {
          let control = HostClientControl.request(
            commandID: commandID,
            method: method,
            params: params
          )
          let frame = try HostFrame(
            kind: .clientControl,
            streamID: 0,
            payload: HostWireCodec.encode(control)
          )
          Task {
            do {
              try await link.send(frame.encoded())
            } catch {
              self.fail(commandID, error: error)
            }
          }
        } catch {
          pending.removeValue(forKey: commandID)?.continuation.resume(throwing: error)
        }
      }
    } onCancel: {
      Task { await self.cancel(commandID) }
    }
  }

  public func request<Parameters: Encodable, Result: Decodable & Sendable>(
    method: String,
    params: Parameters,
    as type: Result.Type = Result.self
  ) async throws -> Result {
    let value = try await request(method: method, params: HostJSONValue.encode(params))
    return try value.decode(type)
  }

  public func apply(
    command: HostWorkspaceCommand,
    expectedStructureRevision: UInt64?,
    spawnSpecs: [String: HostSpawnSpec] = [:],
    confirmationTokens: [String: UUID] = [:]
  ) async throws -> HostApplyResult {
    try await request(
      method: "workspace.apply",
      params: HostApplyRequest(
        command: command,
        expectedStructureRevision: expectedStructureRevision,
        spawnSpecs: spawnSpecs,
        confirmationTokens: confirmationTokens
      )
    )
  }

  public func attach(_ paneID: HostPaneID) async throws -> HostTerminalAttachment {
    let streamID = allocateStreamID()
    let pair = AsyncStream<HostTerminalEvent>.makeStream(bufferingPolicy: .bufferingOldest(256))
    terminals[streamID] = pair.continuation
    do {
      _ = try await request(
        method: "terminal.attach",
        params: HostTerminalAttachRequest(paneID: paneID, streamID: streamID),
        as: HostTerminalStreamResult.self
      )
      return HostTerminalAttachment(streamID: streamID, events: pair.stream)
    } catch {
      terminals.removeValue(forKey: streamID)?.finish()
      throw error
    }
  }

  public func detach(streamID: UInt32) async {
    terminals.removeValue(forKey: streamID)?.finish()
    _ = try? await request(
      method: "terminal.detach",
      params: HostTerminalStreamRequest(streamID: streamID),
      as: HostTerminalStreamResult.self
    )
  }

  public func claim(streamID: UInt32) async throws -> UInt64 {
    let result: HostTerminalClaimResult = try await request(
      method: "terminal.claim",
      params: HostTerminalStreamRequest(streamID: streamID)
    )
    return result.generation
  }

  public func input(streamID: UInt32, bytes: Data) async throws {
    guard let link, terminals[streamID] != nil else {
      throw HostConnectionFailure.notConnected
    }
    try await link.send(
      HostFrame(kind: .terminalInput, streamID: streamID, payload: bytes).encoded()
    )
  }

  public func resize(streamID: UInt32, viewport: HostViewport) async throws {
    _ = try await request(
      method: "terminal.resize",
      params: HostTerminalResizeRequest(streamID: streamID, viewport: viewport),
      as: HostTerminalStreamResult.self
    )
  }

  private func begin(_ link: HostTransportLink) async throws {
    self.link = link
    decoder = HostFrameDecoder()
    cancelledRequests.removeAll(keepingCapacity: true)
    let hello = HostClientControl.hello(
      build: configuration.build,
      role: configuration.role,
      clientID: configuration.clientID,
      capabilities: configuration.capabilities,
      limits: configuration.limits
    )
    let frame = try HostFrame(
      kind: .clientControl,
      streamID: 0,
      payload: HostWireCodec.encode(hello)
    )
    try await link.send(frame.encoded(includePreface: true))
  }

  private func ingest(_ bytes: Data) throws {
    for frame in try decoder.append(bytes) {
      try receive(frame)
    }
  }

  private func receive(_ frame: HostFrame) throws {
    switch frame.kind {
    case .hostControl:
      try receive(HostWireCodec.decode(frame.payload))
    case .terminalOutput:
      guard frame.payload.count >= 8 else { throw HostProtocolFailure.malformedTerminalPayload }
      yield(
        .output(
          sequence: frame.payload.integer(at: 0),
          bytes: Data(frame.payload.dropFirst(8))
        ),
        to: frame.streamID
      )
    case .terminalSnapshot:
      guard frame.payload.count >= 24,
        let snapshotID = UUID(data: Data(frame.payload.prefix(16)))
      else {
        throw HostProtocolFailure.malformedTerminalPayload
      }
      yield(
        .snapshotChunk(
          snapshotID: snapshotID,
          offset: frame.payload.integer(at: 16),
          bytes: Data(frame.payload.dropFirst(24))
        ),
        to: frame.streamID
      )
    case .clientControl, .terminalInput:
      throw HostProtocolFailure.invalidDirection
    }
  }

  private func receive(_ control: HostControl) throws {
    switch control {
    case .welcome(let welcome):
      guard welcome.protocolVersion == supatermHostProtocolVersion,
        welcome.build == configuration.build
      else {
        throw HostConnectionFailure.versionMismatch
      }
      let changed = currentEpoch.isSomeAndNotEqual(to: welcome.epoch)
      currentEpoch = welcome.epoch
      if changed {
        currentRevision = nil
        eventContinuation.yield(.epochChanged)
      }
      eventContinuation.yield(.welcomed(welcome))
      subscribe()
    case .result(let commandID, let result):
      guard let request = pending.removeValue(forKey: commandID) else {
        if cancelledRequests.removeValue(forKey: commandID) != nil { return }
        throw HostConnectionFailure.misdirectedResponse
      }
      request.continuation.resume(returning: result)
    case .error(let commandID, let error):
      guard let commandID else { throw error }
      guard let request = pending.removeValue(forKey: commandID) else {
        if cancelledRequests.removeValue(forKey: commandID) != nil { return }
        throw HostConnectionFailure.misdirectedResponse
      }
      request.continuation.resume(throwing: error)
      if error.code == .resyncRequired {
        currentRevision = nil
        eventContinuation.yield(.resyncRequired)
        subscribe()
      }
    case .terminal(let streamID, let event):
      yield(.control(event), to: streamID)
    case .state(let subscription):
      received(subscription)
    case .capabilityRequest(let request):
      perform(request)
    }
  }

  private func perform(_ request: HostCapabilityRequest) {
    let handler = configuration.capabilityHandler
    Task { [weak self] in
      let control: HostClientControl
      do {
        control = .capabilityResult(
          requestID: request.requestID,
          result: try await handler(request)
        )
      } catch let error as HostProtocolError {
        control = .capabilityError(requestID: request.requestID, error: error)
      } catch {
        control = .capabilityError(
          requestID: request.requestID,
          error: HostProtocolError(code: .internal)
        )
      }
      try? await self?.send(control)
    }
  }

  private func send(_ control: HostClientControl) async throws {
    guard let link else { throw HostConnectionFailure.notConnected }
    let frame = try HostFrame(
      kind: .clientControl,
      streamID: 0,
      payload: HostWireCodec.encode(control)
    )
    try await link.send(frame.encoded())
  }

  private func subscribe() {
    let revision = currentRevision
    Task { [weak self] in
      guard let self else { return }
      do {
        let subscription: HostSubscription = try await self.request(
          method: "state.subscribe",
          params: HostSubscribeRequest(afterRevision: revision)
        )
        await self.received(subscription)
      } catch let error as HostProtocolError where error.code == .resyncRequired {
        await self.requireResync()
      } catch {
        await self.lost(error)
      }
    }
  }

  private func received(_ subscription: HostSubscription) {
    switch subscription {
    case .snapshot(let snapshot):
      currentEpoch = snapshot.epoch
      currentRevision = snapshot.revision
    case .replay(let mutations):
      if let mutation = mutations.last {
        currentEpoch = mutation.epoch
        currentRevision = mutation.revision
      }
    }
    eventContinuation.yield(.subscription(subscription))
  }

  private func requireResync() {
    currentRevision = nil
    eventContinuation.yield(.resyncRequired)
    subscribe()
  }

  private func lost(_ error: any Error) async {
    await link?.close()
    link = nil
    failAll(error)
    finishTerminals()
    eventContinuation.yield(.disconnected(String(describing: error)))
  }

  private func fail(_ commandID: HostCommandID, error: any Error) {
    pending.removeValue(forKey: commandID)?.continuation.resume(throwing: error)
  }

  private func cancel(_ commandID: HostCommandID) {
    guard let request = pending.removeValue(forKey: commandID) else { return }
    request.continuation.resume(throwing: CancellationError())
    cancelledRequestSequence &+= 1
    cancelledRequests[commandID] = cancelledRequestSequence
    if cancelledRequests.count > 1024,
      let oldest = cancelledRequests.min(by: { $0.value < $1.value })?.key
    {
      cancelledRequests.removeValue(forKey: oldest)
    }
  }

  private func failAll(_ error: any Error) {
    let requests = pending.values
    pending.removeAll()
    for request in requests {
      request.continuation.resume(throwing: error)
    }
  }

  private func finishTerminals() {
    let streams = terminals.values
    terminals.removeAll()
    for stream in streams {
      stream.finish()
    }
  }

  private func allocateStreamID() -> UInt32 {
    while nextStreamID == 0 || terminals[nextStreamID] != nil {
      nextStreamID &+= 1
    }
    let streamID = nextStreamID
    nextStreamID &+= 1
    return streamID
  }

  private func yield(_ event: HostTerminalEvent, to streamID: UInt32) {
    guard let stream = terminals[streamID] else { return }
    if case .dropped = stream.yield(event) {
      terminals.removeValue(forKey: streamID)?.finish()
      Task { [weak self] in await self?.detach(streamID: streamID) }
    }
  }
}

private struct PendingRequest {
  let continuation: CheckedContinuation<HostJSONValue, any Error>
}

public enum HostConnectionFailure: Error, Equatable, Sendable {
  case notConnected
  case closed
  case versionMismatch
  case misdirectedResponse
}

extension Optional where Wrapped: Equatable {
  fileprivate func isSomeAndNotEqual(to value: Wrapped) -> Bool {
    map { $0 != value } ?? false
  }
}

extension UUID {
  fileprivate init?(data: Data) {
    guard data.count == 16 else { return nil }
    self = data.withUnsafeBytes { bytes in
      UUID(uuid: bytes.loadUnaligned(as: uuid_t.self))
    }
  }
}
