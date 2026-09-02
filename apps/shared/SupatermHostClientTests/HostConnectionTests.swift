import Foundation
import SupatermHostClient
import Testing

@Suite(.serialized)
struct HostConnectionTests {
  @Test
  func correlatesRequestsAndReceivesPushedState() async throws {
    let transport = TestHostTransport()
    let build = HostBuildIdentity(version: "26.0.0", fingerprint: "test")
    let connection = HostConnection(
      transport: transport,
      configuration: HostConnectionConfiguration(
        build: build,
        clientID: UUID(uuidString: "11111111-1111-4111-8111-111111111111")
      )
    )
    var events = connection.events.makeAsyncIterator()

    await connection.start()
    #expect(await events.next() == .connecting)
    let hello = try await transport.frame(link: 0, index: 0)
    #expect(try json(hello.payload)["type"] as? String == "hello")

    let epoch = try #require(UUID(uuidString: "44444444-4444-4444-8444-444444444444"))
    try await transport.receive(
      link: 0,
      payload: try encoded(welcome(build: build, epoch: epoch)),
      includePreface: true
    )
    guard case .welcomed(let welcome) = await events.next() else {
      Issue.record("welcome event missing")
      return
    }
    #expect(welcome.epoch == epoch)

    let subscribe = try await transport.frame(link: 0, index: 1)
    let subscribeJSON = try json(subscribe.payload)
    let subscribeID = try #require(subscribeJSON["command_id"] as? String)
    let fixture = try stateFixture()
    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "result", "command_id": subscribeID,
        "result": fixture["subscription"] as Any,
      ])
    )
    guard case .subscription(.snapshot(let snapshot)) = await events.next() else {
      Issue.record("initial snapshot missing")
      return
    }
    #expect(snapshot.revision == 7)

    let first = Task { try await connection.request(method: "first") }
    let second = Task { try await connection.request(method: "second") }
    let firstFrame = try await transport.frame(link: 0, index: 2)
    let secondFrame = try await transport.frame(link: 0, index: 3)
    let firstJSON = try json(firstFrame.payload)
    let secondJSON = try json(secondFrame.payload)
    let requests = [firstJSON, secondJSON]
    let firstID = try #require(
      requests.first(where: { $0["method"] as? String == "first" })?["command_id"] as? String
    )
    let secondID = try #require(
      requests.first(where: { $0["method"] as? String == "second" })?["command_id"] as? String
    )
    try await transport.receive(
      link: 0,
      payload: try encoded(["type": "result", "command_id": secondID, "result": "two"])
    )
    try await transport.receive(
      link: 0,
      payload: try encoded(["type": "result", "command_id": firstID, "result": "one"])
    )
    #expect(try await first.value == .string("one"))
    #expect(try await second.value == .string("two"))

    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "state", "subscription": fixture["subscription"] as Any,
      ])
    )
    guard case .subscription(.snapshot(let pushed)) = await events.next() else {
      Issue.record("pushed snapshot missing")
      return
    }
    #expect(pushed.revision == 7)
    await connection.stop()
  }

  @Test
  func reconnectsAndReportsEpochChange() async throws {
    let transport = TestHostTransport()
    let build = HostBuildIdentity(version: "26.0.0", fingerprint: "test")
    let connection = HostConnection(
      transport: transport,
      configuration: HostConnectionConfiguration(build: build, clientID: UUID())
    )
    var events = connection.events.makeAsyncIterator()

    await connection.start()
    _ = await events.next()
    _ = try await transport.frame(link: 0, index: 0)
    let firstEpoch = UUID()
    try await transport.receive(
      link: 0,
      payload: try encoded(welcome(build: build, epoch: firstEpoch)),
      includePreface: true
    )
    _ = await events.next()
    let subscribe = try await transport.frame(link: 0, index: 1)
    let subscribeID = try #require(try json(subscribe.payload)["command_id"] as? String)
    let fixture = try stateFixture()
    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "result", "command_id": subscribeID,
        "result": fixture["subscription"] as Any,
      ])
    )
    _ = await events.next()
    await transport.finish(link: 0)

    var sawReconnect = false
    while !sawReconnect, let event = await events.next() {
      sawReconnect = event == .connecting
    }
    #expect(sawReconnect)
    _ = try await transport.frame(link: 1, index: 0)
    let secondEpoch = UUID()
    try await transport.receive(
      link: 1,
      payload: try encoded(welcome(build: build, epoch: secondEpoch)),
      includePreface: true
    )
    #expect(await events.next() == .epochChanged)
    guard case .welcomed(let secondWelcome) = await events.next() else {
      Issue.record("second welcome missing")
      return
    }
    #expect(secondWelcome.epoch == secondEpoch)
    await connection.stop()
  }

  @Test
  func ignoresOneLateResponseForACancelledRequest() async throws {
    let transport = TestHostTransport()
    let build = HostBuildIdentity(version: "26.0.0", fingerprint: "test")
    let connection = HostConnection(
      transport: transport,
      configuration: HostConnectionConfiguration(build: build, clientID: UUID())
    )
    var events = connection.events.makeAsyncIterator()

    await connection.start()
    _ = await events.next()
    _ = try await transport.frame(link: 0, index: 0)
    try await transport.receive(
      link: 0,
      payload: try encoded(welcome(build: build, epoch: UUID())),
      includePreface: true
    )
    _ = await events.next()
    let subscribe = try await transport.frame(link: 0, index: 1)
    let subscribeID = try #require(try json(subscribe.payload)["command_id"] as? String)
    let fixture = try stateFixture()
    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "result", "command_id": subscribeID,
        "result": fixture["subscription"] as Any,
      ])
    )
    _ = await events.next()

    let cancelled = Task { try await connection.request(method: "cancelled") }
    let frame = try await transport.frame(link: 0, index: 2)
    let commandID = try #require(try json(frame.payload)["command_id"] as? String)
    cancelled.cancel()
    await #expect(throws: CancellationError.self) {
      try await cancelled.value
    }
    try await transport.receive(
      link: 0,
      payload: try encoded(["type": "result", "command_id": commandID, "result": true])
    )

    let next = Task { try await connection.request(method: "next") }
    let nextFrame = try await transport.frame(link: 0, index: 3)
    let nextID = try #require(try json(nextFrame.payload)["command_id"] as? String)
    try await transport.receive(
      link: 0,
      payload: try encoded(["type": "result", "command_id": nextID, "result": "ok"])
    )
    #expect(try await next.value == .string("ok"))
    #expect(await connection.isConnected)
    await connection.stop()
  }

  @Test
  func answersHostCapabilityRequestsOnTheSameConnection() async throws {
    let transport = TestHostTransport()
    let build = HostBuildIdentity(version: "26.0.0", fingerprint: "test")
    let connection = HostConnection(
      transport: transport,
      configuration: HostConnectionConfiguration(
        build: build,
        clientID: UUID(),
        capabilities: ["semantic_state", "native_focus"],
        capabilityHandler: { request in
          #expect(request.capability == "native_focus")
          #expect(request.method == "native.focus")
          return request.params
        }
      )
    )
    var events = connection.events.makeAsyncIterator()

    await connection.start()
    _ = await events.next()
    _ = try await transport.frame(link: 0, index: 0)
    try await transport.receive(
      link: 0,
      payload: try encoded(welcome(build: build, epoch: UUID())),
      includePreface: true
    )
    _ = await events.next()
    let subscribe = try await transport.frame(link: 0, index: 1)
    let subscribeID = try #require(try json(subscribe.payload)["command_id"] as? String)
    let fixture = try stateFixture()
    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "result", "command_id": subscribeID,
        "result": fixture["subscription"] as Any,
      ])
    )
    _ = await events.next()

    let requestID = UUID()
    try await transport.receive(
      link: 0,
      payload: try encoded([
        "type": "capability_request",
        "request_id": requestID.uuidString,
        "capability": "native_focus",
        "method": "native.focus",
        "params": ["pane_id": "pane"],
      ])
    )
    let response = try await transport.frame(link: 0, index: 2)
    let responseJSON = try json(response.payload)
    #expect(responseJSON["type"] as? String == "capability_result")
    #expect(responseJSON["request_id"] as? String == requestID.uuidString)
    #expect((responseJSON["result"] as? [String: String])?["pane_id"] == "pane")
    await connection.stop()
  }

  private func stateFixture() throws -> [String: Any] {
    let url = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appending(path: "supaterm-host/tests/fixtures/protocol-v1-state.json")
    return try #require(
      JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
    )
  }

  private func welcome(
    build: HostBuildIdentity,
    epoch: UUID
  ) -> [String: Any] {
    [
      "type": "welcome",
      "protocol_version": 1,
      "build": ["version": build.version, "fingerprint": build.fingerprint],
      "host_id": "33333333-3333-4333-8333-333333333333",
      "epoch": epoch.uuidString,
      "revision": 0,
      "structure_revision": 0,
      "capabilities": ["semantic_state", "terminal_snapshot"],
      "limits": [
        "maximum_snapshot_bytes": 67_108_864,
        "maximum_continuation_bytes": 16_777_216,
      ],
    ]
  }

  private func json(_ data: Data) throws -> [String: Any] {
    try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
  }

  private func encoded(_ json: [String: Any]) throws -> Data {
    try JSONSerialization.data(withJSONObject: json, options: [.sortedKeys])
  }
}

private actor TestHostTransport: HostTransport {
  private struct Link {
    var decoder = HostFrameDecoder(direction: .clientToHost)
    var frames: [HostFrame] = []
    let incoming: AsyncThrowingStream<Data, any Error>.Continuation
  }

  private var links: [Link] = []

  func open() async throws -> HostTransportLink {
    await Task.yield()
    let pair = AsyncThrowingStream<Data, any Error>.makeStream()
    let index = links.count
    links.append(Link(incoming: pair.continuation))
    return HostTransportLink(
      incoming: pair.stream,
      send: { [weak self] data in
        try await self?.sent(data, link: index)
      },
      close: { [weak self] in
        await self?.finish(link: index)
      }
    )
  }

  func frame(link: Int, index: Int) async throws -> HostFrame {
    for _ in 0..<500 {
      if links.indices.contains(link), links[link].frames.indices.contains(index) {
        return links[link].frames[index]
      }
      try await Task.sleep(for: .milliseconds(10))
    }
    throw TestHostTransportError.timedOut
  }

  func receive(
    link: Int,
    payload: Data,
    includePreface: Bool = false
  ) throws {
    let frame = try HostFrame(kind: .hostControl, streamID: 0, payload: payload)
    links[link].incoming.yield(frame.encoded(includePreface: includePreface))
  }

  func finish(link: Int) {
    guard links.indices.contains(link) else { return }
    links[link].incoming.finish()
  }

  private func sent(_ data: Data, link: Int) throws {
    let frames = try links[link].decoder.append(data)
    links[link].frames.append(contentsOf: frames)
  }
}

private enum TestHostTransportError: Error {
  case timedOut
}
