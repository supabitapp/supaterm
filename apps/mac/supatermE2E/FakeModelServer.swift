import Darwin
import Foundation

/// Controls an isolated aimock process. Provider protocols and streaming live in aimock.
nonisolated final class FakeModelServer: @unchecked Sendable {
  private let process = Process()
  private let input = Pipe()
  private let output = Pipe()
  private let lock = NSLock()
  private var buffer = Data()
  private var failure: String?
  private(set) var baseURL = ""

  init(script: [FakeModelExchange]) throws {
    let environment = ProcessInfo.processInfo.environment
    guard let node = environment["AIMOCK_E2E_NODE"],
      FileManager.default.isExecutableFile(atPath: node),
      let server = environment["AIMOCK_E2E_SCRIPT"],
      FileManager.default.fileExists(atPath: server)
    else {
      throw SupatermE2EError("Missing aimock runtime. Run through make mac-test-e2e.")
    }
    process.executableURL = URL(fileURLWithPath: node)
    process.arguments = [server]
    process.standardInput = input
    process.standardOutput = output
    process.standardError = FileHandle.standardError
    try process.run()
    do {
      let command = StartCommand(action: "start", script: script)
      let state = try send(JSONEncoder().encode(command))
      guard let url = state.baseURL else {
        throw SupatermE2EError(state.failure ?? "aimock did not return its URL.")
      }
      self.baseURL = url
    } catch {
      stop()
      throw error
    }
  }

  var responsesBaseURL: String {
    baseURL + "/v1"
  }

  func stop() {
    lock.withLock {
      try? input.fileHandleForWriting.close()
      if process.isRunning {
        process.terminate()
        process.waitUntilExit()
      }
      try? output.fileHandleForReading.close()
    }
  }

  deinit {
    stop()
  }

  func verifyComplete() throws {
    try lock.withLock {
      let state = try command("status")
      if let failure = failure ?? state.failure {
        throw SupatermE2EError(failure)
      }
      guard state.remaining == 0 else {
        throw SupatermE2EError("aimock has \(state.remaining ?? -1) unused responses.")
      }
      guard state.pending == 0, state.releases == 0 else {
        throw SupatermE2EError("aimock has an unmatched response release.")
      }
    }
  }

  var recordedFailure: String? {
    lock.withLock {
      do {
        return try failure ?? command("status").failure
      } catch {
        return "aimock control failed: \(error)"
      }
    }
  }

  func releaseNextResponse() {
    lock.withLock {
      do {
        let state = try command("release")
        failure = failure ?? state.failure
      } catch {
        failure = failure ?? "aimock release failed: \(error)"
      }
    }
  }

  private func command(_ action: String) throws -> State {
    try send(JSONEncoder().encode(["action": action]))
  }

  private func send(_ data: Data) throws -> State {
    guard process.isRunning else { throw SupatermE2EError("aimock exited unexpectedly.") }
    try input.fileHandleForWriting.write(contentsOf: data + Data([10]))
    let deadline = Date().addingTimeInterval(10)
    while !buffer.contains(10) {
      let timeout = max(0, deadline.timeIntervalSinceNow * 1000)
      var descriptor = pollfd(fd: output.fileHandleForReading.fileDescriptor, events: Int16(POLLIN), revents: 0)
      let result = poll(&descriptor, 1, Int32(timeout))
      if result < 0, errno == EINTR { continue }
      guard result > 0 else { throw SupatermE2EError("Timed out waiting for aimock control.") }
      let chunk = output.fileHandleForReading.availableData
      guard !chunk.isEmpty else { throw SupatermE2EError("aimock closed its control pipe.") }
      buffer.append(chunk)
    }
    let end = buffer.firstIndex(of: 10)!
    let line = buffer[..<end]
    let state = try JSONDecoder().decode(State.self, from: line)
    buffer.removeSubrange(...end)
    return state
  }

  private struct StartCommand: Encodable {
    let action: String
    let script: [FakeModelExchange]
  }

  private struct State: Decodable {
    let baseURL: String?
    let remaining: Int?
    let pending: Int?
    let releases: Int?
    let failure: String?
  }
}
