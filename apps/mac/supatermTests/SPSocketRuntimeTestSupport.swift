import Darwin
import Foundation
import SupatermCLIShared

@testable import SupatermSocketFeature

func withSocketRuntime(
  replying reply:
    @escaping @Sendable (
      SupatermSocketRequest,
      SupatermSocketEndpoint
    ) async throws -> SupatermSocketResponse?,
  run body: (SupatermSocketEndpoint) throws -> Void
) async throws {
  let rootURL = try makeSocketClientTemporaryDirectory()
  let socketURL = rootURL.appendingPathComponent("control.sock", isDirectory: false)
  let endpoint = socketClientEndpoint(path: socketURL.path)
  let runtime = SocketControlRuntime(endpointProvider: { endpoint })
  let responder = try await startSocketResponder(runtime: runtime, endpoint: endpoint, replying: reply)

  do {
    try body(endpoint)
    responder.cancel()
    await runtime.stop()
    try? FileManager.default.removeItem(at: rootURL)
  } catch {
    responder.cancel()
    await runtime.stop()
    try? FileManager.default.removeItem(at: rootURL)
    throw error
  }
}

@discardableResult
func startSocketResponder(
  runtime: SocketControlRuntime,
  endpoint: SupatermSocketEndpoint,
  replying reply:
    @escaping @Sendable (
      SupatermSocketRequest,
      SupatermSocketEndpoint
    ) async throws -> SupatermSocketResponse?
) async throws -> Task<Void, Never> {
  _ = try await runtime.start()
  return Task.detached(priority: .utility) {
    let stream = await runtime.requests()
    for await request in stream {
      if Task.isCancelled {
        return
      }
      if let response = try? await reply(request.payload, endpoint) {
        await runtime.reply(response, to: request.handle)
      }
    }
  }
}

func makeSocketClientTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

nonisolated func socketClientEndpoint(path: String) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: UUID(uuidString: "F46D3E0B-B0C0-46CC-B14F-7C32B433179A")!,
    name: "test",
    path: path,
    pid: 1,
    startedAt: Date(timeIntervalSince1970: 0)
  )
}

nonisolated final class SPSocketRequestLog: @unchecked Sendable {
  private let lock = NSLock()
  private var storage: [SupatermSocketRequest] = []

  func record(_ request: SupatermSocketRequest) {
    lock.lock()
    storage.append(request)
    lock.unlock()
  }

  var requests: [SupatermSocketRequest] {
    lock.lock()
    defer { lock.unlock() }
    return storage
  }
}

nonisolated final class LockedCounter: @unchecked Sendable {
  private let lock = NSLock()
  private var value = 0

  func increment() -> Int {
    lock.lock()
    defer { lock.unlock() }
    value += 1
    return value
  }

  var count: Int {
    lock.lock()
    defer { lock.unlock() }
    return value
  }
}
