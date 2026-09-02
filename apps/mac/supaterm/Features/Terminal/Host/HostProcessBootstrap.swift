import Foundation
import SupatermCLIShared
import SupatermHostClient

nonisolated struct HostProcessBootstrap: Sendable {
  struct Description: Equatable, Sendable {
    let protocolVersion: UInt16
    let build: HostBuildIdentity
    let stateRoot: String
    let socket: String
    let processRecord: String
  }

  private struct WireDescription: Decodable {
    let protocolVersion: UInt16
    let build: HostBuildIdentity
    let stateRoot: String
    let socket: String
    let processRecord: String
  }

  private struct WireProcessRecord: Decodable {
    let protocolVersion: UInt16
    let build: HostBuildIdentity
  }

  let executableURL: URL
  let environment: [String: String]

  static func bundled(
    bundle: Bundle = .main,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) throws -> HostProcessBootstrap {
    guard let appExecutable = bundle.executableURL,
      let host = SupatermBundleLayout.hostExecutableURL(nextTo: appExecutable)
    else {
      throw HostProcessBootstrapError.missingExecutable
    }
    return HostProcessBootstrap(executableURL: host, environment: environment)
  }

  func prepare() async throws -> Description {
    let output = try await run(["describe"])
    let wire = try HostWireCodec.decoder.decode(WireDescription.self, from: output)
    guard wire.protocolVersion == supatermHostProtocolVersion else {
      throw HostProcessBootstrapError.protocolMismatch
    }
    let description = Description(
      protocolVersion: wire.protocolVersion,
      build: wire.build,
      stateRoot: wire.stateRoot,
      socket: wire.socket,
      processRecord: wire.processRecord
    )
    if await isReady(description) {
      return description
    }
    _ = try await run(["replace"])
    _ = try await run(["serve"])
    for delay in 0..<50 {
      if await isReady(description) {
        return description
      }
      try await Task.sleep(for: .milliseconds(20 + delay * 2))
    }
    throw HostProcessBootstrapError.startFailed
  }

  func connection(clientID: HostClientID) async throws -> HostConnection {
    let description = try await prepare()
    return HostConnection(
      transport: HostUnixTransport(socketPath: description.socket),
      configuration: HostConnectionConfiguration(
        build: description.build,
        clientID: clientID
      )
    )
  }

  private func canConnect(to socket: String) async -> Bool {
    do {
      let link = try await HostUnixTransport(socketPath: socket).open()
      await link.close()
      return true
    } catch {
      return false
    }
  }

  private func isReady(_ description: Description) async -> Bool {
    guard
      let data = try? Data(contentsOf: URL(fileURLWithPath: description.processRecord)),
      let record = try? HostWireCodec.decoder.decode(WireProcessRecord.self, from: data),
      record.protocolVersion == description.protocolVersion,
      record.build == description.build
    else {
      return false
    }
    return await canConnect(to: description.socket)
  }

  private func run(_ arguments: [String]) async throws -> Data {
    try await Task.detached(priority: .userInitiated) {
      let process = Process()
      let output = Pipe()
      let error = Pipe()
      process.executableURL = executableURL
      process.arguments = arguments
      process.environment = environment
      process.standardInput = FileHandle.nullDevice
      process.standardOutput = output
      process.standardError = error
      try process.run()
      let outputData = output.fileHandleForReading.readDataToEndOfFile()
      let errorData = error.fileHandleForReading.readDataToEndOfFile()
      process.waitUntilExit()
      guard process.terminationReason == .exit, process.terminationStatus == 0 else {
        throw HostProcessBootstrapError.commandFailed(
          String(data: errorData, encoding: .utf8) ?? ""
        )
      }
      return outputData
    }.value
  }
}

nonisolated enum HostClientIdentity {
  private static let key = "hostClientID"

  static func load(defaults: UserDefaults = .standard) -> HostClientID {
    if let value = defaults.string(forKey: key), let id = UUID(uuidString: value) {
      return id
    }
    let id = UUID()
    defaults.set(id.uuidString, forKey: key)
    return id
  }
}

private enum HostProcessBootstrapError: Error {
  case commandFailed(String)
  case missingExecutable
  case protocolMismatch
  case startFailed
}
