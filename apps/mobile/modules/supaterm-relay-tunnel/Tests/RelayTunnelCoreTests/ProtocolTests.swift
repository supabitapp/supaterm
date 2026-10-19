import Darwin
import XCTest
import CryptoKit
import Network
@testable import RelayTunnelCore

final class ProtocolTests: XCTestCase {
  struct Vectors: Decodable {
    let address: String; let clientSecret: String; let hello: String; let welcome: String
    let transcript: String; let plain: String; let clientRecords: [String]; let hostRecords: [String]
  }
  func vectors() throws -> Vectors {
    try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: Bundle.module.url(forResource: "vectors", withExtension: "json")!))
  }
  func testTypeScriptKnownAnswersAndStrictOrdering() throws {
    let vector = try vectors()
    let handshake = try RelayHandshake(identity: RelayIdentity(address: vector.address), secret: Data(hex: vector.clientSecret)!)
    XCTAssertEqual(handshake.hello, vector.hello)
    let host = try JSONSerialization.jsonObject(with: Data(vector.welcome.utf8)) as! [String: Any]
    XCTAssertEqual(handshake.transcript(host: Data(base64URL: host["key"] as! String)!).hex, vector.transcript)
    let cipher = try handshake.finish(vector.welcome)
    let plain = Data(hex: vector.plain)!
    XCTAssertEqual(try cipher.seal(plain).hex, vector.clientRecords[0])
    XCTAssertEqual(try cipher.seal(plain).hex, vector.clientRecords[1])
    XCTAssertThrowsError(try cipher.open(Data(hex: vector.hostRecords[1])!))
    XCTAssertEqual(try cipher.open(Data(hex: vector.hostRecords[0])!), plain)
    XCTAssertThrowsError(try cipher.open(Data(hex: vector.hostRecords[0])!))
    var bad = Data(hex: vector.hostRecords[1])!; bad[10] ^= 1
    XCTAssertThrowsError(try cipher.open(bad))
    XCTAssertEqual(try cipher.open(Data(hex: vector.hostRecords[1])!), plain)
    XCTAssertThrowsError(try handshake.finish(vector.welcome.replacingOccurrences(of: "\"version\":2", with: "\"version\":1")))
    var object = host; object["signature"] = Data(repeating: 0, count: 64).base64URL
    XCTAssertThrowsError(try handshake.finish(String(data: JSONSerialization.data(withJSONObject: object), encoding: .utf8)!))
  }
  func testEveryKeepaliveHostAndChunkedBody() throws {
    var guardHTTP = HTTPHostGuard(authority: "127.0.0.1:40000")
    let first = Data("POST /upload HTTP/1.1\r\nHost: 127.0.0.1:40000\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n".utf8)
    var result = Data()
    for byte in first { result.append(try guardHTTP.feed(Data([byte]))) }
    XCTAssertEqual(result, first)
    XCTAssertThrowsError(try guardHTTP.feed(Data("GET /next HTTP/1.1\r\nHost: elsewhere.invalid\r\n\r\n".utf8)))
    var malformed = HTTPHostGuard(authority: "127.0.0.1:40000")
    XCTAssertThrowsError(try malformed.feed(Data("POST /upload HTTP/1.1\r\nHost: 127.0.0.1:40000\r\nTransfer-Encoding: chunked\r\n\r\n\r\n".utf8)))
  }
  func testLoopbackPortCollisionAndResume() async throws {
    let address = try vectors().address
    let first = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: address)
    let second = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: address)
    let origin = try await first.start(port: 0)
    let port = UInt16(URL(string: origin)!.port!)
    let fallback = try await second.start(port: port)
    XCTAssertNotEqual(origin, fallback)
    first.suspend()
    let rebound = try await first.resume()
    XCTAssertEqual(rebound, origin)
    await first.stop(); await second.stop()
  }
  func testStartWhileSuspendedRejectsUntilResume() async throws {
    let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origin = try await tunnel.start(port: 0)
    tunnel.suspend()
    do {
      _ = try await tunnel.start()
      XCTFail("Suspended tunnel restarted")
    } catch {
      XCTAssertEqual("\(error)", "Relay tunnel is suspended while the app is in the background")
    }
    XCTAssertNotNil(tunnel.listener)
    let resumed = try await tunnel.resume()
    XCTAssertEqual(resumed, origin)
    let started = try await tunnel.start()
    XCTAssertEqual(started, origin)
    await tunnel.stop()
  }
  func testSuspensionKeepsThePublishedPortUntilResumeRebindsIt() async throws {
    let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origin = try await tunnel.start(port: 0)
    let listener = try XCTUnwrap(tunnel.listener)
    let port = UInt16(URL(string: origin)!.port!)
    tunnel.suspend()
    tunnel.queue.sync {}
    XCTAssertTrue(tunnel.listener === listener)

    let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
    XCTAssertGreaterThanOrEqual(socket, 0)
    defer { Darwin.close(socket) }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = port.bigEndian
    inet_pton(AF_INET, "127.0.0.1", &address.sin_addr)
    let bindPort = {
      withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
      }
    }
    XCTAssertEqual(bindPort(), -1)
    XCTAssertEqual(errno, EADDRINUSE)
    let resumed = try await tunnel.resume()
    XCTAssertEqual(resumed, origin)
    XCTAssertFalse(tunnel.listener === listener)
    await tunnel.stop()
    XCTAssertEqual(bindPort(), 0)
  }
  func testListenerFailureAfterReadyRebindsOnNextStart() async throws {
    let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origin = try await tunnel.start(port: 0)
    let failed = try XCTUnwrap(tunnel.listener)
    tunnel.queue.sync { failed.stateUpdateHandler?(.failed(.posix(.ENETDOWN))) }
    let rebound = try await tunnel.start()
    XCTAssertEqual(rebound, origin)
    XCTAssertFalse(tunnel.listener === failed)
    await tunnel.stop()
  }
  func testResumeRebindsAListenerReclaimedWithoutAStateUpdate() async throws {
    let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origin = try await tunnel.start(port: 0)
    let reclaimed = try XCTUnwrap(tunnel.listener)
    let reportState = reclaimed.stateUpdateHandler
    let cancelled = expectation(description: "listening socket reclaimed")
    tunnel.queue.sync {
      reclaimed.stateUpdateHandler = { state in
        if case .cancelled = state { cancelled.fulfill() }
      }
      reclaimed.cancel()
    }
    await fulfillment(of: [cancelled], timeout: 5)
    tunnel.suspend()
    let resumed = try await tunnel.resume()
    XCTAssertEqual(resumed, origin)

    let connected = expectation(description: "published relay port accepts connections")
    let port = try XCTUnwrap(NWEndpoint.Port(rawValue: UInt16(URL(string: origin)!.port!)))
    let client = NWConnection(host: "127.0.0.1", port: port, using: .tcp)
    defer { client.cancel() }
    client.stateUpdateHandler = { state in
      switch state {
      case .ready: connected.fulfill()
      case .failed(let error), .waiting(let error):
        XCTFail("Relay port is unreachable: \(error)")
        client.stateUpdateHandler = nil
        connected.fulfill()
      default: break
      }
    }
    client.start(queue: .global())
    await fulfillment(of: [connected], timeout: 5)
    client.stateUpdateHandler = nil
    tunnel.queue.sync { reportState?(.cancelled) }
    await tunnel.stop()
  }
  func testStableIdentityAndInvalidAddresses() throws {
    let vector = try vectors()
    let identity = try RelayIdentity(address: vector.address + "pair#token=secret")
    XCTAssertEqual(identity.address, vector.address)
    let legacy = try RelayIdentity(address: vector.address.replacingOccurrences(of: ".alt/", with: ".invalid/"))
    XCTAssertEqual(legacy.key, identity.key)
    XCTAssertEqual(legacy.address, vector.address)
    XCTAssertTrue((40000..<60000).contains(Int(identity.stablePort)))
    XCTAssertThrowsError(try RelayIdentity(address: vector.address.replacingOccurrences(of: "https", with: "http")))
    XCTAssertThrowsError(try RelayIdentity(address: "https://aa.relay.supaterm.alt/"))
  }
  func testConcurrentStartsShareOneListener() async throws {
    let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origins = try await withThrowingTaskGroup(of: String.self) { group in
      for _ in 0..<32 { group.addTask { try await tunnel.start(port: 0) } }
      var result: [String] = []
      for try await origin in group { result.append(origin) }
      return result
    }
    XCTAssertEqual(Set(origins).count, 1)
    await tunnel.stop()
    do {
      _ = try await tunnel.start()
      XCTFail("Stopped tunnel restarted")
    } catch {}
    let replacement = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
    let origin = try await replacement.start(port: UInt16(URL(string: origins[0])!.port!))
    XCTAssertEqual(origin, origins[0])
    await replacement.stop()
  }
  func testStopDuringListenerStartupReleasesPort() async throws {
    for _ in 0..<16 {
      let tunnel = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
      let starting = Task { try await tunnel.start() }
      await tunnel.stop()
      _ = try? await starting.value
      let replacement = try RelayTunnel(relayURL: "ws://127.0.0.1:9", hostAddress: vectors().address)
      let origin = try await replacement.start()
      XCTAssertEqual(URL(string: origin)!.port!, Int(replacement.identity.stablePort))
      await replacement.stop()
    }
  }
}
