import Foundation
import Network

public struct RelayTunnelStatus {
  public let state: String
  public let hostAddress: String
  public let origin: String
  public let bytesSent: UInt64
  public let bytesReceived: UInt64
  public let activeStreams: Int
  public let sessionCount: Int
  public let via: String?
  public let reason: String?
}

private final class LocalStream {
  let id: UInt32
  let connection: NWConnection
  var guardHTTP: HTTPHostGuard
  var reading = false
  var writing = 0
  init(id: UInt32, connection: NWConnection, authority: String) {
    self.id = id; self.connection = connection
    guardHTTP = HTTPHostGuard(authority: authority)
  }
}

private final class RelayDial {
  let id: Int
  let route: TunnelRoute
  let handshake: RelayHandshake
  let session: URLSession
  let socket: URLSessionWebSocketTask
  var deadline: DispatchWorkItem?

  init(id: Int, route: TunnelRoute, url: URL, identity: RelayIdentity) throws {
    self.id = id; self.route = route
    handshake = try RelayHandshake(identity: identity)
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.connectionProxyDictionary = [:]
    session = URLSession(configuration: config)
    socket = session.webSocketTask(with: url)
    socket.maximumMessageSize = maxPlain + 24
  }

  func close() {
    deadline?.cancel(); deadline = nil
    socket.cancel(with: .goingAway, reason: nil)
    session.invalidateAndCancel()
  }
}

public final class RelayTunnel: @unchecked Sendable {
  public let identity: RelayIdentity
  private let relayURL: URL
  private let keepaliveInterval: TimeInterval
  private let probeTimeout: TimeInterval
  private let handshakeTimeout: TimeInterval
  private let directTimeout: TimeInterval
  private let failureCooldown: TimeInterval
  let queue = DispatchQueue(label: "com.supaterm.relay-tunnel", qos: .userInitiated)
  private let onStatus: (RelayTunnelStatus) -> Void
  private(set) var listener: NWListener?
  private var startingListener: NWListener?
  private var startContinuations: [CheckedContinuation<String, Error>] = []
  private var closingListener: NWListener?
  private var listenerWaiters: [() -> Void] = []
  private var port: UInt16 = 0
  private var stopped = false
  private var suspended = false
  private var streams: [UInt32: LocalStream] = [:]
  private var nextID: UInt32 = 1
  private(set) var directURLs: [URL]
  private var dials: [Int: RelayDial] = [:]
  private var race: TunnelRace<(reason: String, failure: RelayFailure)>?
  private(set) var route: TunnelRoute?
  private var websocket: URLSessionWebSocketTask?
  private var urlSession: URLSession?
  private var cipher: RelayCipher?
  private var mux: TunnelMux?
  private var generation: UInt64 = 0
  private var probeDeadline: DispatchWorkItem?
  private var cooldown: (failure: RelayFailure, until: Date)?
  private var sending = false
  private var pumpScheduled = false
  private var bytesSent: UInt64 = 0
  private var bytesReceived: UInt64 = 0
  private var sessionCount = 0
  private var state = "down"
  private var lastStatus = Date.distantPast

  public init(relayURL: String, hostAddress: String, directURLs: [String] = [],
              keepaliveInterval: TimeInterval = 15, probeTimeout: TimeInterval = 2,
              handshakeTimeout: TimeInterval = 15, directTimeout: TimeInterval = 5,
              failureCooldown: TimeInterval = 2,
              onStatus: @escaping (RelayTunnelStatus) -> Void = { _ in }) throws {
    identity = try RelayIdentity(address: hostAddress)
    guard let url = tunnelBaseURL(relayURL) else { throw RelayError.invalid("Invalid relay URL") }
    self.relayURL = url; self.keepaliveInterval = keepaliveInterval; self.onStatus = onStatus
    self.probeTimeout = probeTimeout; self.handshakeTimeout = handshakeTimeout
    self.directTimeout = directTimeout; self.failureCooldown = failureCooldown
    self.directURLs = directTunnelURLs(directURLs)
  }

  public func setDirectURLs(_ values: [String]) {
    let urls = directTunnelURLs(values)
    queue.async { self.directURLs = urls }
  }

  public func networkChanged() {
    queue.async {
      if self.route == .direct { self.drop("Network changed"); return }
      for dial in self.dials.values.sorted(by: { $0.id < $1.id }) where dial.route == .direct {
        self.lose(dial, "Network changed", .unreachable)
      }
    }
  }

  public func start(port requested: UInt16? = nil) async throws -> String {
    try await activate(port: requested, resuming: false)
  }

  public func resume() async throws -> String {
    try await activate(port: nil, resuming: true)
  }

  private func activate(port requested: UInt16?, resuming: Bool) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      queue.async {
        guard !self.stopped else { continuation.resume(throwing: RelayError.invalid("Tunnel stopped")); return }
        if resuming {
          if self.suspended { self.closeListener() }
          self.suspended = false
          self.checkSession()
        }
        guard !self.suspended else {
          continuation.resume(throwing: RelayError.invalid("Relay tunnel is suspended while the app is in the background"))
          return
        }
        if self.listener != nil {
          continuation.resume(returning: self.origin); return
        }
        self.startContinuations.append(continuation)
        guard self.startContinuations.count == 1 else { return }
        let bind = {
          guard !self.stopped, !self.suspended else {
            self.finishStart(.failure(RelayError.invalid("Tunnel inactive"))); return
          }
          guard self.listener == nil, self.startingListener == nil, !self.startContinuations.isEmpty else { return }
          self.listen(port: requested ?? (self.port == 0 ? self.identity.stablePort : self.port),
                      fallback: self.port == 0)
        }
        if self.closingListener != nil { self.listenerWaiters.append(bind) }
        else { bind() }
      }
    }
  }

  public func stop() async {
    await withCheckedContinuation { continuation in
      queue.async {
        self.stopped = true
        self.closeListener()
        self.drop("Stopped")
        if self.closingListener != nil { self.listenerWaiters.append { continuation.resume() } }
        else { continuation.resume() }
      }
    }
  }

  public func suspend() {
    queue.sync {
      self.suspended = true
      if self.listener == nil { self.closeListener() }
      self.drop("Backgrounded")
    }
  }

  private func checkSession() {
    guard let mux else {
      if race != nil { drop("Relay resumed during handshake", answering: .unreachable) }
      cooldown = nil
      return
    }
    probeDeadline?.cancel()
    let attempt = generation
    let deadline = DispatchWorkItem { [weak self] in
      guard let self, self.generation == attempt else { return }
      self.drop("Relay resume probe timed out")
    }
    probeDeadline = deadline
    queue.asyncAfter(deadline: .now() + probeTimeout, execute: deadline)
    mux.ping(); schedulePump()
  }

  private func closeListener() {
    finishStart(.failure(RelayError.invalid("Tunnel inactive")))
    guard let old = listener ?? startingListener else { return }
    listener = nil; startingListener = nil
    retire(old)
  }

  private func retire(_ old: NWListener) {
    if case .cancelled = old.state { return }
    closingListener = old
    old.stateUpdateHandler = { [weak self, weak old] state in
      guard let self, let old, case .cancelled = state, self.closingListener === old else { return }
      self.closingListener = nil
      let waiting = self.listenerWaiters; self.listenerWaiters.removeAll()
      for resume in waiting { resume() }
    }
    old.cancel()
  }

  private func finishStart(_ result: Result<String, Error>) {
    let waiting = startContinuations; startContinuations.removeAll()
    for continuation in waiting { continuation.resume(with: result) }
  }

  private var origin: String { "http://127.0.0.1:\(port)" }
  private func emit(_ newState: String? = nil, reason: String? = nil) {
    if let newState { state = newState }
    if newState == nil && Date().timeIntervalSince(lastStatus) < 1 { return }
    lastStatus = Date()
    onStatus(RelayTunnelStatus(state: state, hostAddress: identity.address, origin: origin,
      bytesSent: bytesSent, bytesReceived: bytesReceived, activeStreams: streams.count,
      sessionCount: sessionCount, via: route?.rawValue, reason: reason))
  }

  private func listen(port requested: UInt16, fallback: Bool) {
    do {
      let tcp = NWProtocolTCP.Options(); tcp.noDelay = true
      let parameters = NWParameters(tls: nil, tcp: tcp)
      parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: requested)!)
      let candidate = try NWListener(using: parameters)
      startingListener = candidate
      candidate.stateUpdateHandler = { [weak self, weak candidate] result in
        guard let self, let candidate else { return }
        if self.listener === candidate { self.listenerChanged(candidate, result); return }
        guard self.startingListener === candidate else { return }
        switch result {
        case .ready:
          self.startingListener = nil
          self.listener = candidate
          self.port = candidate.port!.rawValue
          self.emit(self.state)
          self.finishStart(.success(self.origin))
        case .failed(let error):
          self.startingListener = nil; candidate.cancel()
          if fallback && requested != 0 {
            self.listen(port: 0, fallback: false)
          } else { self.finishStart(.failure(error)) }
        default: break
        }
      }
      candidate.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
      candidate.start(queue: queue)
    } catch { finishStart(.failure(error)) }
  }

  private func listenerChanged(_ active: NWListener, _ result: NWListener.State) {
    switch result {
    case .failed: listener = nil; retire(active)
    case .cancelled: listener = nil
    default: break
    }
  }

  private func accept(_ connection: NWConnection) {
    guard !stopped, !suspended, streams.count < 256, nextID < UInt32.max - 2 else {
      connection.cancel(); return
    }
    if let cooldown, cooldown.until > Date() {
      connection.start(queue: queue); answer(connection, cooldown.failure); return
    }
    let stream = LocalStream(id: nextID, connection: connection, authority: "127.0.0.1:\(port)")
    nextID += 2; streams[stream.id] = stream
    connection.stateUpdateHandler = { [weak self, weak stream] result in
      guard let self, let stream, self.streams[stream.id] === stream else { return }
      switch result {
      case .ready:
        if self.mux != nil { self.read(stream) } else { self.connect() }
      case .failed, .cancelled: self.reset(stream)
      default: break
      }
    }
    connection.start(queue: queue)
    if let mux { mux.open(stream.id); schedulePump() }
    else { connect() }
    emit()
  }

  private func connect() {
    guard websocket == nil, race == nil, !stopped, !suspended else { return }
    generation += 1
    let bases = [(relayURL, TunnelRoute.relay)] + directURLs.map { ($0, TunnelRoute.direct) }
    do {
      for (id, (base, route)) in bases.enumerated() {
        dials[id] = try RelayDial(id: id, route: route, url: connectURL(base), identity: identity)
      }
    } catch { fail("Handshake setup failed", .unreachable); return }
    race = TunnelRace(dials.mapValues(\.route))
    emit("connecting")
    for dial in dials.values.sorted(by: { $0.id < $1.id }) { start(dial) }
  }

  private func connectURL(_ base: URL) -> URL {
    var url = URLComponents(url: base, resolvingAgainstBaseURL: false)!
    url.path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/connect"
    if !url.path.hasPrefix("/") { url.path = "/" + url.path }
    url.queryItems = [URLQueryItem(name: "endpointId", value: identity.endpointID)]
    return url.url!
  }

  private func start(_ dial: RelayDial) {
    let deadline = DispatchWorkItem { [weak self, weak dial] in
      guard let self, let dial else { return }
      self.lose(dial, "Handshake timed out", .timeout)
    }
    dial.deadline = deadline
    let timeout = dial.route == .relay ? handshakeTimeout : min(directTimeout, handshakeTimeout)
    queue.asyncAfter(deadline: .now() + timeout, execute: deadline)
    dial.socket.resume()
    dial.socket.send(.string(dial.handshake.hello)) { [weak self] error in
      guard let self else { return }
      self.queue.async {
        if error != nil { self.lose(dial, "Relay send failed") }
        else { self.awaitWelcome(dial) }
      }
    }
  }

  private func awaitWelcome(_ dial: RelayDial) {
    guard dials[dial.id] === dial else { return }
    dial.socket.receive { [weak self] result in
      guard let self else { return }
      self.queue.async {
        guard self.dials[dial.id] === dial else { dial.close(); return }
        do {
          guard case .string(let text) = try result.get() else { throw RelayError.invalid("Invalid relay welcome") }
          self.win(dial, try dial.handshake.finish(text))
        } catch {
          let protocolError = error as? RelayError
          self.lose(dial, protocolError?.description ?? "Relay disconnected", protocolError == nil ? nil : .unreachable)
        }
      }
    }
  }

  private func win(_ dial: RelayDial, _ cipher: RelayCipher) {
    guard dials[dial.id] === dial, let losers = race?.welcome(dial.id) else { dial.close(); return }
    race = nil
    dial.deadline?.cancel(); dial.deadline = nil
    for id in losers { dials[id]?.close() }
    dials.removeAll()
    websocket = dial.socket; urlSession = dial.session; route = dial.route
    self.cipher = cipher
    cooldown = nil; sessionCount += 1
    let mux = TunnelMux(); self.mux = mux
    mux.onPong = { [weak self] in
      self?.probeDeadline?.cancel(); self?.probeDeadline = nil
    }
    for stream in streams.values.sorted(by: { $0.id < $1.id }) {
      mux.open(stream.id)
      read(stream)
    }
    let attempt = generation
    keepalive(attempt: attempt)
    emit("up"); schedulePump()
    receive(attempt: attempt, socket: dial.socket)
  }

  private func lose(_ dial: RelayDial, _ reason: String, _ failure: RelayFailure? = nil) {
    guard dials[dial.id] === dial else { return }
    dials.removeValue(forKey: dial.id)
    let failure = failure ?? RelayFailure(relayStatus: (dial.socket.response as? HTTPURLResponse)?.statusCode)
    dial.close()
    guard let exhausted = race?.fail(dial.id, (reason, failure)) else { return }
    fail(exhausted.reason, exhausted.failure)
  }

  private func receive(attempt: UInt64, socket: URLSessionWebSocketTask) {
    socket.receive { [weak self] result in
      guard let self else { return }
      self.queue.async {
        guard self.generation == attempt else { return }
        do {
          guard case .data(let record) = try result.get(), let cipher = self.cipher, let mux = self.mux else {
            throw RelayError.invalid("Unencrypted relay message")
          }
          self.deliver(try mux.receive(cipher.open(record)), attempt: attempt)
          self.schedulePump()
          self.receive(attempt: attempt, socket: socket)
        } catch {
          self.drop((error as? RelayError)?.description ?? "Relay disconnected")
        }
      }
    }
  }

  private func keepalive(attempt: UInt64) {
    queue.asyncAfter(deadline: .now() + keepaliveInterval) { [weak self] in
      guard let self, self.generation == attempt, let mux = self.mux else { return }
      do {
        try mux.tick()
        self.schedulePump(); self.keepalive(attempt: attempt)
      } catch {
        self.drop((error as? RelayError)?.description ?? "Relay session timed out")
      }
    }
  }

  private func drop(_ reason: String, answering failure: RelayFailure? = nil) {
    generation += 1
    probeDeadline?.cancel(); probeDeadline = nil
    for dial in dials.values { dial.close() }
    dials.removeAll(); race = nil; route = nil
    websocket?.cancel(with: .goingAway, reason: nil); websocket = nil
    urlSession?.invalidateAndCancel(); urlSession = nil
    cipher = nil; mux = nil; sending = false
    let old = streams; streams.removeAll()
    for stream in old.values {
      if let failure { answer(stream.connection, failure) } else { stream.connection.cancel() }
    }
    emit("down", reason: failure.map { "\(reason): \($0.rawValue)" } ?? reason)
  }

  private func fail(_ reason: String, _ failure: RelayFailure) {
    cooldown = (failure, Date() + failureCooldown)
    drop(reason, answering: failure)
  }

  private func answer(_ connection: NWConnection, _ failure: RelayFailure) {
    connection.send(content: failure.response, contentContext: .finalMessage, isComplete: true, completion: .idempotent)
    Self.discard(connection, budget: 1 << 16)
    queue.asyncAfter(deadline: .now() + 5) { connection.cancel() }
  }

  private static func discard(_ connection: NWConnection, budget: Int) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { data, _, complete, error in
      let left = budget - (data?.count ?? 0)
      if complete || error != nil || left <= 0 { connection.cancel() }
      else { discard(connection, budget: left) }
    }
  }

  private func read(_ stream: LocalStream) {
    guard streams[stream.id] === stream, !stream.reading, let flow = mux?.streams[stream.id],
          !flow.localEnded, flow.pending.isEmpty, flow.sendCredit > 0 else { return }
    stream.reading = true
    stream.connection.receive(minimumIncompleteLength: 1, maximumLength: maxPlain - 9) { [weak self, weak stream] data, _, complete, error in
      guard let self, let stream else { return }
      self.queue.async {
        guard self.streams[stream.id] === stream, let mux = self.mux else { return }
        stream.reading = false
        if error != nil { self.reset(stream); return }
        do {
          if let data, !data.isEmpty {
            mux.write(stream.id, try stream.guardHTTP.feed(data))
          }
          if complete { try stream.guardHTTP.finish(); mux.end(stream.id) }
          self.schedulePump()
          if !complete { self.read(stream) }
        } catch {
          stream.connection.send(content: Data("HTTP/1.1 421 Misdirected Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".utf8),
                                 contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
            self.queue.async { self.reset(stream) }
          })
        }
      }
    }
  }

  private func schedulePump() {
    guard !pumpScheduled else { return }
    pumpScheduled = true
    queue.async { self.pumpScheduled = false; self.pump() }
  }
  private func pump() {
    guard !sending, let cipher, let mux, let socket = websocket, let record = mux.nextRecord() else { return }
    let attempt = generation
    do {
      let sealed = try cipher.seal(record.plain)
      sending = true; bytesSent += UInt64(record.dataBytes)
      socket.send(.data(sealed)) { [weak self] error in
        guard let self else { return }
        self.queue.async {
          guard self.generation == attempt else { return }
          self.sending = false
          if error != nil { self.drop("Relay send failed"); return }
          for id in record.drained { if let stream = self.streams[id] { self.read(stream) } }
          for stream in self.streams.values { self.maybeFinish(stream) }
          self.emit(); self.schedulePump()
        }
      }
    } catch { drop("Relay seal failed") }
  }

  private func deliver(_ events: [MuxEvent], attempt: UInt64) {
    for event in events {
      switch event {
      case .credit(let id):
        if let stream = streams[id] { read(stream) }
      case .reset(let id):
        streams.removeValue(forKey: id)?.connection.cancel()
      case .fin(let id):
        guard let stream = streams[id] else { continue }
        if stream.guardHTTP.awaitingUpgrade { reset(stream); continue }
        stream.writing += 1
        stream.connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { [weak self, weak stream] _ in
          guard let self, let stream else { return }
          self.queue.async {
            guard self.streams[id] === stream else { return }
            stream.writing -= 1; self.maybeFinish(stream)
          }
        })
      case .data(let id, let payload):
        guard let stream = streams[id] else { continue }
        do {
          let released = try stream.guardHTTP.observeResponse(payload)
          if !released.isEmpty { mux?.write(id, released) }
        } catch { reset(stream); continue }
        stream.writing += 1
        bytesReceived += UInt64(payload.count)
        stream.connection.send(content: payload, completion: .contentProcessed { [weak self, weak stream] error in
          guard let self else { return }
          self.queue.async {
            guard self.generation == attempt, let stream, self.streams[id] === stream else { return }
            stream.writing -= 1
            if error != nil { self.reset(stream); return }
            self.mux?.consumed(id, bytes: payload.count)
            self.schedulePump()
            self.maybeFinish(stream); self.emit()
          }
        })
      }
    }
  }

  private func reset(_ stream: LocalStream) {
    guard streams.removeValue(forKey: stream.id) != nil else { return }
    if let mux { mux.close(stream.id, reset: true); schedulePump() }
    stream.connection.cancel(); emit()
  }
  private func maybeFinish(_ stream: LocalStream) {
    guard let mux, let flow = mux.streams[stream.id], flow.finSent, flow.remoteEnded,
          flow.pending.isEmpty, stream.writing == 0 else { return }
    mux.close(stream.id, reset: false)
    streams.removeValue(forKey: stream.id); stream.connection.cancel()
  }
}
