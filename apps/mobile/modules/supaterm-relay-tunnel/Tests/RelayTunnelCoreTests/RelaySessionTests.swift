import XCTest
import CryptoKit
import Network
@testable import RelayTunnelCore

private let relayErrorHeader = "X-Supaterm-Relay-Error"

private func listen(_ listener: NWListener, on queue: DispatchQueue,
                    accept: @escaping (NWConnection) -> Void) async throws -> String {
  try await withCheckedThrowingContinuation { ready in
    listener.stateUpdateHandler = { [weak listener] state in
      guard let listener else { return }
      switch state {
      case .ready:
        listener.stateUpdateHandler = nil
        ready.resume(returning: "ws://127.0.0.1:\(listener.port?.rawValue ?? 0)")
      case .failed(let error):
        listener.stateUpdateHandler = nil
        ready.resume(throwing: error)
      default: break
      }
    }
    listener.newConnectionHandler = accept
    listener.start(queue: queue)
  }
}

private final class FakeRelay: @unchecked Sendable {
  enum Greeting { case welcome, silence, hangUp }

  let signing: Curve25519.Signing.PrivateKey
  let frames: AsyncStream<MuxFrameValue>
  let hellos: AsyncStream<Void>
  private let continuation: AsyncStream<MuxFrameValue>.Continuation
  private let helloContinuation: AsyncStream<Void>.Continuation
  private let greeting: Greeting
  private var holdsWelcome: Bool
  private var heldHello: Data?
  private let queue = DispatchQueue(label: "fake-relay")
  private let listener: NWListener
  private var connection: NWConnection?
  private var cipher: RelayCipher?
  private var count = 0
  var dials: Int { queue.sync { count } }

  var address: String {
    let hex = signing.publicKey.rawRepresentation.hex
    return "https://\(hex.prefix(32)).\(hex.suffix(32)).relay.supaterm.alt/"
  }

  init(greeting: Greeting = .welcome, signing: Curve25519.Signing.PrivateKey = .init(),
       holdsWelcome: Bool = false) throws {
    self.greeting = greeting; self.signing = signing; self.holdsWelcome = holdsWelcome
    let parameters = NWParameters.tcp
    parameters.defaultProtocolStack.applicationProtocols.insert(NWProtocolWebSocket.Options(), at: 0)
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
    (frames, continuation) = AsyncStream.makeStream()
    (hellos, helloContinuation) = AsyncStream.makeStream()
  }

  func start() async throws -> String {
    try await listen(listener, on: queue) { [weak self] connection in
      guard let self else { return }
      self.connection = connection; self.count += 1
      connection.start(queue: self.queue)
      self.receive(connection)
    }
  }

  func send(_ plain: Data) {
    queue.async {
      guard let record = try? self.cipher?.seal(plain) else { return }
      self.write(record, opcode: .binary)
    }
  }

  func releaseWelcome() {
    queue.async {
      self.holdsWelcome = false
      guard let hello = self.heldHello else { return }
      self.heldHello = nil
      try? self.welcome(hello)
    }
  }

  func awaitDiscarded() async {
    for await frame in frames {
      XCTFail("Expected the tunnel to close this dial, but it carried \(frame.type)"); return
    }
  }

  func stop() {
    queue.async {
      self.connection?.cancel(); self.listener.cancel()
      self.continuation.finish(); self.helloContinuation.finish()
    }
  }

  private func receive(_ connection: NWConnection) {
    connection.receiveMessage { [weak self] data, context, _, error in
      guard let self else { return }
      let metadata = context?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
      guard error == nil, let data, let opcode = metadata?.opcode, opcode != .close else {
        self.continuation.finish(); return
      }
      if opcode == .text { self.helloContinuation.yield() }
      if opcode == .text && self.greeting == .hangUp { connection.cancel(); return }
      do {
        if opcode == .text && self.greeting == .welcome {
          if self.holdsWelcome { self.heldHello = data } else { try self.welcome(data) }
        }
        if opcode == .binary, let cipher = self.cipher {
          for frame in try decodeFrames(cipher.open(data)) { self.continuation.yield(frame) }
        }
        self.receive(connection)
      } catch { self.continuation.finish() }
    }
  }

  private func welcome(_ hello: Data) throws {
    struct Hello: Decodable { let key: String }
    let client = try XCTUnwrap(Data(base64URL: JSONDecoder().decode(Hello.self, from: hello).key))
    let ephemeral = Curve25519.KeyAgreement.PrivateKey()
    let host = ephemeral.publicKey.rawRepresentation
    let transcript = Data("supaterm-tunnel-v2\n".utf8) + signing.publicKey.rawRepresentation + client + host
    let keys = try ephemeral.sharedSecretFromKeyAgreement(with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: client))
      .hkdfDerivedSymmetricKey(using: SHA256.self, salt: Data(SHA256.hash(data: transcript)),
                               sharedInfo: Data("supaterm-tunnel-traffic-v1".utf8), outputByteCount: 64)
      .withUnsafeBytes { Data($0) }
    cipher = RelayCipher(sendKey: SymmetricKey(data: keys.suffix(32)), receiveKey: SymmetricKey(data: keys.prefix(32)))
    let signature = try signing.signature(for: transcript)
    write(Data("{\"type\":\"welcome\",\"version\":2,\"key\":\"\(host.base64URL)\",\"signature\":\"\(signature.base64URL)\"}".utf8),
          opcode: .text)
  }

  private func write(_ data: Data, opcode: NWProtocolWebSocket.Opcode) {
    let context = NWConnection.ContentContext(identifier: "relay", metadata: [NWProtocolWebSocket.Metadata(opcode: opcode)])
    connection?.send(content: data, contentContext: context, isComplete: true, completion: .idempotent)
  }
}

private final class RejectingRelay: @unchecked Sendable {
  let address = "https://\(String(repeating: "ab", count: 16)).\(String(repeating: "cd", count: 16)).relay.supaterm.alt/"
  private let status: String
  private let queue = DispatchQueue(label: "rejecting-relay")
  private let listener: NWListener
  private var count = 0
  private var held: [NWConnection]?
  var dials: Int { queue.sync { count } }

  init(status: String, holding: Bool = false) throws {
    self.status = status; held = holding ? [] : nil
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: .any)
    listener = try NWListener(using: parameters)
  }

  func start() async throws -> String {
    try await listen(listener, on: queue) { [weak self] connection in self?.reject(connection) }
  }

  func release() {
    queue.async {
      let waiting = self.held ?? []; self.held = nil
      for connection in waiting { self.answer(connection) }
    }
  }

  func stop() { queue.async { self.listener.cancel() } }

  private func reject(_ connection: NWConnection) {
    count += 1
    connection.start(queue: queue)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] _, _, _, _ in
      guard let self else { return }
      if self.held != nil { self.held?.append(connection) } else { self.answer(connection) }
    }
  }

  private func answer(_ connection: NWConnection) {
    let body = #"{"error":"rejected"}"#
    let response = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.utf8.count)\r\n" +
      "Connection: close\r\n\r\n\(body)"
    connection.send(content: Data(response.utf8), contentContext: .finalMessage, isComplete: true,
                    completion: .contentProcessed { _ in connection.cancel() })
  }
}

private func localSession() -> URLSession {
  let config = URLSessionConfiguration.ephemeral
  config.connectionProxyDictionary = [:]
  config.timeoutIntervalForRequest = 5
  return URLSession(configuration: config)
}

private func fetchDescriptor(_ session: URLSession, _ origin: String) async throws -> HTTPURLResponse {
  let (_, response) = try await session.data(from: try XCTUnwrap(URL(string: origin + "/.well-known/supaterm/environment")))
  return try XCTUnwrap(response as? HTTPURLResponse)
}

private func openStream(_ origin: String) throws -> NWConnection {
  let port = try XCTUnwrap(URL(string: origin)?.port)
  let client = NWConnection(host: "127.0.0.1", port: try XCTUnwrap(NWEndpoint.Port(rawValue: UInt16(port))), using: .tcp)
  client.start(queue: .global())
  client.send(content: Data("GET / HTTP/1.1\r\nHost: 127.0.0.1:\(port)\r\n\r\n".utf8), completion: .idempotent)
  return client
}

private func rejection(_ status: String) async throws -> HTTPURLResponse {
  let relay = try RejectingRelay(status: status)
  defer { relay.stop() }
  let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address)
  let session = localSession()
  defer { session.invalidateAndCancel() }
  let response = try await fetchDescriptor(session, try await tunnel.start(port: 0))
  await tunnel.stop()
  return response
}

final class RelaySessionTests: XCTestCase {
  func testOfflineHostAnswersEveryWaitingRequestFromOneDial() async throws {
    let relay = try RejectingRelay(status: "404 Not Found")
    defer { relay.stop() }
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address)
    let origin = try await tunnel.start(port: 0)
    let session = localSession()
    defer { session.invalidateAndCancel() }

    let responses = try await withThrowingTaskGroup(of: HTTPURLResponse.self) { group in
      for _ in 0..<3 { group.addTask { try await fetchDescriptor(session, origin) } }
      return try await group.reduce(into: []) { $0.append($1) }
    }
    let next = try await fetchDescriptor(session, origin)
    XCTAssertEqual((responses + [next]).map(\.statusCode), [503, 503, 503, 503])
    XCTAssertEqual((responses + [next]).map { $0.value(forHTTPHeaderField: relayErrorHeader) },
                   Array(repeating: "host-offline", count: 4))
    XCTAssertEqual(relay.dials, 1)
    await tunnel.stop()
  }

  func testRequestAfterTheFailureCooldownDialsAgain() async throws {
    let relay = try RejectingRelay(status: "404 Not Found")
    defer { relay.stop() }
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address, failureCooldown: 0.1)
    let origin = try await tunnel.start(port: 0)
    let session = localSession()
    defer { session.invalidateAndCancel() }

    _ = try await fetchDescriptor(session, origin)
    try await Task.sleep(nanoseconds: 200_000_000)
    let response = try await fetchDescriptor(session, origin)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "host-offline")
    XCTAssertEqual(relay.dials, 2)
    await tunnel.stop()
  }

  func testRelayRejectionsMapToLocalGatewayAnswers() async throws {
    for (status, local, code) in [("429 Too Many Requests", 503, "relay-busy"),
                                  ("503 Service Unavailable", 503, "relay-busy"),
                                  ("500 Internal Server Error", 502, "relay-unreachable")] {
      let response = try await rejection(status)
      XCTAssertEqual(response.statusCode, local, status)
      XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), code, status)
    }
  }

  func testHostThatNeverAnswersThePairingReportsOffline() async throws {
    let relay = try FakeRelay(greeting: .hangUp)
    defer { relay.stop() }
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address)
    let session = localSession()
    defer { session.invalidateAndCancel() }
    let response = try await fetchDescriptor(session, try await tunnel.start(port: 0))
    XCTAssertEqual(response.statusCode, 503)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "host-offline")
    await tunnel.stop()
  }

  func testHandshakeTimeoutAnswersWithGatewayTimeout() async throws {
    let relay = try FakeRelay(greeting: .silence)
    defer { relay.stop() }
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address, handshakeTimeout: 0.2)
    let session = localSession()
    defer { session.invalidateAndCancel() }
    let response = try await fetchDescriptor(session, try await tunnel.start(port: 0))
    XCTAssertEqual(response.statusCode, 504)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "relay-timeout")
    await tunnel.stop()
  }

  func testResumeAnswersAStaleHandshakeAndLetsTheNextRequestDial() async throws {
    let relay = try FakeRelay(greeting: .silence)
    defer { relay.stop() }
    let url = try await relay.start()
    let firstDial = expectation(description: "first dial")
    let secondDial = expectation(description: "next request dials without waiting out a cooldown")
    var dials = 0
    let tunnel = try RelayTunnel(relayURL: url, hostAddress: relay.address) { status in
      guard status.state == "connecting" else { return }
      dials += 1
      (dials == 1 ? firstDial : secondDial).fulfill()
    }
    let origin = try await tunnel.start(port: 0)
    let session = localSession()
    defer { session.invalidateAndCancel() }
    let request = Task { try await fetchDescriptor(session, origin) }
    await fulfillment(of: [firstDial], timeout: 5)

    _ = try await tunnel.resume()
    let response = try await request.value
    XCTAssertEqual(response.statusCode, 502)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "relay-unreachable")
    let client = try openStream(origin)
    defer { client.cancel() }
    await fulfillment(of: [secondDial], timeout: 5)
    await tunnel.stop()
  }

  func testResumeRebindsWithoutDialingUntilARequestArrives() async throws {
    let relay = try FakeRelay()
    defer { relay.stop() }
    let url = try await relay.start()
    let connected = expectation(description: "relay connected on demand")
    var states: [String] = []
    let tunnel = try RelayTunnel(relayURL: url, hostAddress: relay.address) { status in
      states.append(status.state)
      if status.state == "up" { connected.fulfill() }
    }
    let origin = try await tunnel.start(port: 0)
    _ = try await tunnel.resume()
    tunnel.suspend()

    let resumed = try await tunnel.resume()
    XCTAssertEqual(resumed, origin)
    XCTAssertFalse(tunnel.queue.sync { states }.contains("connecting"))
    let client = try openStream(origin)
    defer { client.cancel() }
    await fulfillment(of: [connected], timeout: 5)
    await tunnel.stop()
  }

  func testResumeProbesAndRetainsAResponsiveSession() async throws {
    let relay = try FakeRelay()
    defer { relay.stop() }
    let url = try await relay.start()
    let connected = expectation(description: "relay connected")
    let ping = expectation(description: "resume ping")
    let failed = expectation(description: "healthy probe should not fail")
    failed.isInverted = true
    let tunnel = try RelayTunnel(relayURL: url, hostAddress: relay.address, probeTimeout: 0.3) { status in
      if status.state == "up" { connected.fulfill() }
      if status.reason == "Relay resume probe timed out" { failed.fulfill() }
    }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    await fulfillment(of: [connected], timeout: 5)
    let listener = try XCTUnwrap(tunnel.listener)
    let responses = Task {
      for await frame in relay.frames where frame.type == .ping {
        relay.send(TunnelMux.frame(.pong, 0))
        ping.fulfill()
        break
      }
    }
    _ = try await tunnel.resume()
    XCTAssertTrue(tunnel.listener === listener)
    await fulfillment(of: [ping], timeout: 5)
    await fulfillment(of: [failed], timeout: 0.6)
    responses.cancel()
    await tunnel.stop()
  }

  func testResumeDropsAnUnresponsiveSessionBeforeKeepaliveExpiry() async throws {
    let relay = try FakeRelay()
    defer { relay.stop() }
    let url = try await relay.start()
    let connected = expectation(description: "relay connected")
    let failed = expectation(description: "resume probe failed")
    var states: [String] = []
    let tunnel = try RelayTunnel(relayURL: url, hostAddress: relay.address, probeTimeout: 0.1) { status in
      states.append(status.state)
      if status.state == "up" && status.sessionCount == 1 { connected.fulfill() }
      if status.reason == "Relay resume probe timed out" { failed.fulfill() }
    }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    await fulfillment(of: [connected], timeout: 5)
    _ = try await tunnel.resume()
    await fulfillment(of: [failed], timeout: 5)
    XCTAssertEqual(tunnel.queue.sync { states }.last, "down")
    await tunnel.stop()
  }

  func testSessionAnswersPingsAndClosesAfterThreeIdleTicks() async throws {
    let relay = try FakeRelay()
    let watchdog = Task { try await Task.sleep(nanoseconds: 10_000_000_000); relay.stop() }
    defer { watchdog.cancel(); relay.stop() }
    let relayURL = try await relay.start()
    let (statuses, status) = AsyncStream.makeStream(of: RelayTunnelStatus.self)
    let tunnel = try RelayTunnel(relayURL: relayURL, hostAddress: relay.address, keepaliveInterval: 0.05) { status.yield($0) }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }

    var pong = false
    var pings = 0
    for await frame in relay.frames {
      switch frame.type {
      case .open: relay.send(TunnelMux.frame(.ping, 0))
      case .pong: pong = true
      case .ping: pings += 1
      default: break
      }
      if pings > 3 { break }
    }
    XCTAssertTrue(pong)
    XCTAssertTrue((2...3).contains(pings), "Expected the idle session to close after its third silent tick, saw \(pings) pings")
    var reason: String?
    for await update in statuses where update.state == "down" && update.reason != nil {
      reason = update.reason; break
    }
    XCTAssertEqual(reason, "Relay session timed out")
    await tunnel.stop()
  }

  func testDirectCandidateWinsAndTheSilentRelayDialIsCancelled() async throws {
    let key = Curve25519.Signing.PrivateKey()
    let relay = try FakeRelay(greeting: .silence, signing: key)
    let direct = try FakeRelay(signing: key, holdsWelcome: true)
    defer { relay.stop(); direct.stop() }
    let connected = expectation(description: "direct session up")
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address,
                                 directURLs: [try await direct.start()]) { status in
      if status.state == "up" && status.via == "direct" { connected.fulfill() }
    }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    for await _ in relay.hellos { break }
    direct.releaseWelcome()
    await fulfillment(of: [connected], timeout: 5)
    await relay.awaitDiscarded()
    XCTAssertEqual(relay.dials, 1)
    await tunnel.stop()
  }

  func testRelayFailureWaitsForAPendingDirectCandidate() async throws {
    let relay = try FakeRelay()
    let direct = try FakeRelay(holdsWelcome: true)
    defer { relay.stop(); direct.stop() }
    let (statuses, status) = AsyncStream.makeStream(of: RelayTunnelStatus.self)
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: direct.address,
                                 directURLs: [try await direct.start()]) { status.yield($0) }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    await relay.awaitDiscarded()
    direct.releaseWelcome()
    var settled: RelayTunnelStatus?
    for await update in statuses where update.state == "up" || update.reason != nil {
      settled = update; break
    }
    XCTAssertEqual(settled?.state, "up")
    XCTAssertEqual(settled?.via, "direct")
    await tunnel.stop()
  }

  func testImpostorAtADirectAddressLosesToTheRelay() async throws {
    let relay = try FakeRelay(holdsWelcome: true)
    let impostor = try FakeRelay()
    defer { relay.stop(); impostor.stop() }
    let connected = expectation(description: "relay session up")
    var vias: [String?] = []
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address,
                                 directURLs: [try await impostor.start()]) { status in
      guard status.state == "up" else { return }
      vias.append(status.via); connected.fulfill()
    }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    await impostor.awaitDiscarded()
    relay.releaseWelcome()
    await fulfillment(of: [connected], timeout: 5)
    XCTAssertEqual(impostor.dials, 1)
    XCTAssertEqual(tunnel.queue.sync { vias }, ["relay"])
    await tunnel.stop()
  }

  func testAnswerWaitsForEveryCandidateAndKeepsTheRelayReason() async throws {
    let relay = try RejectingRelay(status: "404 Not Found", holding: true)
    let direct = try FakeRelay(greeting: .silence)
    defer { relay.stop(); direct.stop() }
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address,
                                 directURLs: [try await direct.start()], directTimeout: 0.2)
    let session = localSession()
    defer { session.invalidateAndCancel() }
    let origin = try await tunnel.start(port: 0)
    let request = Task { try await fetchDescriptor(session, origin) }
    await direct.awaitDiscarded()
    relay.release()
    let response = try await request.value
    XCTAssertEqual(response.statusCode, 503)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "host-offline")
    XCTAssertEqual(direct.dials, 1)
    await tunnel.stop()
  }

  func testNewCandidatesApplyToTheNextDialWithoutTearingDownTheSession() async throws {
    let key = Curve25519.Signing.PrivateKey()
    let relay = try FakeRelay(greeting: .silence, signing: key)
    let first = try FakeRelay(signing: key, holdsWelcome: true)
    let second = try FakeRelay(signing: key, holdsWelcome: true)
    defer { relay.stop(); first.stop(); second.stop() }
    let (statuses, status) = AsyncStream.makeStream(of: RelayTunnelStatus.self)
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address,
                                 directURLs: [try await first.start()]) { status.yield($0) }
    let secondURL = try await second.start()
    let origin = try await tunnel.start(port: 0)
    var relayHellos = relay.hellos.makeAsyncIterator()
    let client = try openStream(origin)
    defer { client.cancel() }
    _ = await relayHellos.next()
    first.releaseWelcome()
    var updates = statuses.makeAsyncIterator()
    while let update = await updates.next(), update.state != "up" {}
    let listener = try XCTUnwrap(tunnel.listener)

    tunnel.setDirectURLs([secondURL])
    let resumed = try await tunnel.start(port: 0)
    XCTAssertEqual(resumed, origin)
    XCTAssertTrue(tunnel.listener === listener)
    XCTAssertEqual(tunnel.queue.sync { tunnel.route }, .direct)
    XCTAssertEqual(tunnel.queue.sync { tunnel.directURLs.map(\.absoluteString) }, [secondURL])

    tunnel.networkChanged()
    var dropped: RelayTunnelStatus?
    while let update = await updates.next() {
      if update.state == "down" { dropped = update; break }
    }
    XCTAssertEqual(dropped?.reason, "Network changed")
    XCTAssertNil(dropped?.via)
    let next = try openStream(origin)
    defer { next.cancel() }
    _ = await relayHellos.next()
    second.releaseWelcome()
    var redialed: RelayTunnelStatus?
    while let update = await updates.next() {
      if update.state == "up" { redialed = update; break }
    }
    XCTAssertEqual(redialed?.via, "direct")
    XCTAssertEqual(redialed?.sessionCount, 2)
    XCTAssertEqual([relay.dials, first.dials, second.dials], [2, 1, 1])
    await tunnel.stop()
  }

  func testNetworkChangeCancelsADirectDialStillRacing() async throws {
    let key = Curve25519.Signing.PrivateKey()
    let relay = try FakeRelay(signing: key, holdsWelcome: true)
    let direct = try FakeRelay(signing: key, holdsWelcome: true)
    defer { relay.stop(); direct.stop() }
    let connected = expectation(description: "relay session up")
    var vias: [String?] = []
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address,
                                 directURLs: [try await direct.start()]) { status in
      guard status.state == "up" else { return }
      vias.append(status.via); connected.fulfill()
    }
    let client = try openStream(try await tunnel.start(port: 0))
    defer { client.cancel() }
    for await _ in direct.hellos { break }
    tunnel.networkChanged()
    direct.releaseWelcome()
    await direct.awaitDiscarded()
    relay.releaseWelcome()
    await fulfillment(of: [connected], timeout: 5)
    XCTAssertEqual(tunnel.queue.sync { vias }, ["relay"])
    XCTAssertEqual(direct.dials, 1)
    await tunnel.stop()
  }

  func testNetworkChangeAfterTheRelayFailedAnswersWithTheRelayReason() async throws {
    let relay = try FakeRelay()
    let direct = try FakeRelay(holdsWelcome: true)
    defer { relay.stop(); direct.stop() }
    let (statuses, status) = AsyncStream.makeStream(of: RelayTunnelStatus.self)
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: direct.address,
                                 directURLs: [try await direct.start()]) { status.yield($0) }
    let session = localSession()
    defer { session.invalidateAndCancel() }
    let origin = try await tunnel.start(port: 0)
    let request = Task { try await fetchDescriptor(session, origin) }
    await relay.awaitDiscarded()
    for await _ in direct.hellos { break }
    tunnel.networkChanged()
    direct.releaseWelcome()
    await direct.awaitDiscarded()
    let response = try await request.value
    XCTAssertEqual(response.statusCode, 502)
    XCTAssertEqual(response.value(forHTTPHeaderField: relayErrorHeader), "relay-unreachable")
    var reason: String?
    for await update in statuses where update.reason != nil {
      reason = update.reason; break
    }
    XCTAssertEqual(reason, "Relay host identity mismatch: relay-unreachable")
    await tunnel.stop()
  }

  func testNetworkChangeKeepsARelaySession() async throws {
    let relay = try FakeRelay()
    defer { relay.stop() }
    let connected = expectation(description: "relay session up")
    var reasons: [String] = []
    let tunnel = try RelayTunnel(relayURL: try await relay.start(), hostAddress: relay.address) { status in
      if status.state == "up" { connected.fulfill() }
      if let reason = status.reason { reasons.append(reason) }
    }
    let origin = try await tunnel.start(port: 0)
    let client = try openStream(origin)
    defer { client.cancel() }
    await fulfillment(of: [connected], timeout: 5)
    tunnel.networkChanged()
    let next = try openStream(origin)
    defer { next.cancel() }
    var opened = 0
    for await frame in relay.frames where frame.type == .open {
      opened += 1
      if opened == 2 { break }
    }
    XCTAssertEqual(opened, 2)
    XCTAssertEqual(relay.dials, 1)
    XCTAssertEqual(tunnel.queue.sync { reasons }, [])
    XCTAssertEqual(tunnel.queue.sync { tunnel.route }, .relay)
    await tunnel.stop()
  }
}
