import Darwin
import Foundation
import SupatermCLIShared

struct SPSocketClient {
  private enum SocketClientError: LocalizedError {
    case connectFailed(String)
    case invalidResponse
    case pathIsNotSocket(String)
    case pathNotOwnedByCurrentUser(String)
    case pathTooLong(String)
    case readFailed
    case socketCreationFailed
    case writeFailed

    var errorDescription: String? {
      switch self {
      case .connectFailed(let path):
        return "Failed to connect to Supaterm at \(path)."
      case .invalidResponse:
        return "Supaterm returned an invalid socket response."
      case .pathIsNotSocket(let path):
        return "Supaterm socket path is occupied by a non-socket file: \(path)"
      case .pathNotOwnedByCurrentUser(let path):
        return "Supaterm socket path is not owned by the current user: \(path)"
      case .pathTooLong(let path):
        return "Supaterm socket path is too long: \(path)"
      case .readFailed:
        return "Failed to read a response from Supaterm."
      case .socketCreationFailed:
        return "Failed to create a local socket client."
      case .writeFailed:
        return "Failed to write a request to Supaterm."
      }
    }
  }

  private let path: String
  private let decoder = JSONDecoder()
  private let encoder = JSONEncoder()
  private let connectRetryInterval: TimeInterval
  private let connectRetryTimeout: TimeInterval
  private let responseTimeout: TimeInterval

  init(
    path: String,
    connectRetryInterval: TimeInterval = 0.1,
    connectRetryTimeout: TimeInterval = 2,
    responseTimeout: TimeInterval = 5
  ) throws {
    guard let normalized = SupatermSocketPath.normalized(path) else {
      throw SocketClientError.connectFailed(path)
    }
    self.path = normalized
    self.connectRetryInterval = connectRetryInterval
    self.connectRetryTimeout = connectRetryTimeout
    self.responseTimeout = responseTimeout
  }

  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse {
    let socket = try openSocket()
    defer { Darwin.close(socket) }

    return try send(request, over: socket)
  }

  func probeIdentity() -> SupatermManagedSocketCandidateStatus {
    let socket: Int32
    do {
      socket = try openSocket()
    } catch let error as SocketClientError {
      switch error {
      case .connectFailed:
        return .stale
      default:
        return .ignored
      }
    } catch {
      return .ignored
    }
    defer { Darwin.close(socket) }

    do {
      let response = try send(.identity(), over: socket)
      guard response.ok else {
        return .ignored
      }
      let endpoint = try response.decodeResult(SupatermSocketEndpoint.self)
      guard
        SupatermSocketPath.canonicalized(endpoint.path)
          == SupatermSocketPath.canonicalized(path)
      else {
        return .ignored
      }
      return .reachable(endpoint)
    } catch {
      return .ignored
    }
  }

  private func openSocket() throws -> Int32 {
    let deadline = Date().addingTimeInterval(connectRetryTimeout)

    while true {
      try validateTargetPath()

      let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
      guard socket >= 0 else {
        throw SocketClientError.socketCreationFailed
      }

      let address: sockaddr_un
      do {
        address = try socketAddress(path: path)
      } catch {
        Darwin.close(socket)
        throw error
      }

      var mutableAddress = address
      let result = withUnsafePointer(to: &mutableAddress) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          Darwin.connect(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      if result == 0 {
        return socket
      }

      let connectError = errno
      Darwin.close(socket)

      guard shouldRetryConnect(after: connectError), Date() < deadline else {
        throw SocketClientError.connectFailed(path)
      }

      Thread.sleep(forTimeInterval: connectRetryInterval)
    }
  }

  private func send(
    _ request: SupatermSocketRequest,
    over socket: Int32
  ) throws -> SupatermSocketResponse {
    var receiveTimeout = socketTimeout(responseTimeout)
    _ = setsockopt(
      socket,
      SOL_SOCKET,
      SO_RCVTIMEO,
      &receiveTimeout,
      socklen_t(MemoryLayout<timeval>.size)
    )

    let requestData = try encoder.encode(request) + Data([0x0A])
    try writeAll(requestData, to: socket)

    guard let responseLine = readLine(from: socket) else {
      throw SocketClientError.readFailed
    }
    guard let responseData = responseLine.data(using: .utf8) else {
      throw SocketClientError.invalidResponse
    }
    return try decoder.decode(SupatermSocketResponse.self, from: responseData)
  }

  private func socketAddress(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    memset(&address, 0, MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)

    let maxLength = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < maxLength else {
      throw SocketClientError.pathTooLong(path)
    }

    path.withCString { pointer in
      withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
        let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
        strncpy(buffer, pointer, maxLength - 1)
      }
    }

    return address
  }

  private func writeAll(_ data: Data, to socket: Int32) throws {
    try data.withUnsafeBytes { buffer in
      guard let baseAddress = buffer.baseAddress else { return }
      var offset = 0
      while offset < buffer.count {
        let bytesWritten = Darwin.write(
          socket,
          baseAddress.advanced(by: offset),
          buffer.count - offset
        )
        guard bytesWritten > 0 else {
          throw SocketClientError.writeFailed
        }
        offset += bytesWritten
      }
    }
  }

  private func validateTargetPath() throws {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }

    guard status == 0 else {
      if errno == ENOENT {
        return
      }
      throw SocketClientError.connectFailed(path)
    }

    guard (fileStatus.st_mode & S_IFMT) == S_IFSOCK else {
      throw SocketClientError.pathIsNotSocket(path)
    }

    guard fileStatus.st_uid == getuid() else {
      throw SocketClientError.pathNotOwnedByCurrentUser(path)
    }
  }

  private func shouldRetryConnect(after errorNumber: Int32) -> Bool {
    switch errorNumber {
    case ENOENT, ECONNREFUSED, EAGAIN, EINTR:
      return true
    default:
      return false
    }
  }

  private func socketTimeout(_ interval: TimeInterval) -> timeval {
    let clampedInterval = max(0, interval)
    let seconds = __darwin_time_t(clampedInterval.rounded(.down))
    let microseconds = __darwin_suseconds_t(((clampedInterval - Double(seconds)) * 1_000_000).rounded())
    return timeval(tv_sec: seconds, tv_usec: microseconds)
  }

  private func readLine(from socket: Int32) -> String? {
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)

    while true {
      let bytesRead = Darwin.read(socket, &buffer, buffer.count)
      guard bytesRead >= 0 else { return nil }
      guard bytesRead > 0 else { break }

      data.append(buffer, count: bytesRead)
      if let newlineIndex = data.firstIndex(of: 0x0A) {
        data = Data(data[..<newlineIndex])
        break
      }
    }

    guard !data.isEmpty else { return nil }
    return String(data: data, encoding: .utf8)
  }
}

struct SPSocketSelectionDiagnostics {
  let explicitSocketPath: String?
  let environmentSocketPath: String?
  let requestedInstance: String?
  let discoveredEndpoints: [SupatermSocketEndpoint]
  let removedStalePaths: [String]
  let resolvedTarget: SupatermResolvedSocketTarget?
  let errorMessage: String?
}

enum SPSocketSelection {
  private static let discoveryConnectRetryInterval: TimeInterval = 0.05
  private static let discoveryConnectRetryTimeout: TimeInterval = 0.25
  private static let discoveryResponseTimeout: TimeInterval = 0.25

  static func resolve(
    explicitPath: String?,
    instance: String?,
    alwaysDiscover: Bool = false,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> SPSocketSelectionDiagnostics {
    let explicitSocketPath = SupatermSocketPath.normalized(explicitPath)
    let environmentSocketPath = SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.socketPathKey])
    let shouldDiscover = alwaysDiscover || explicitSocketPath == nil && environmentSocketPath == nil

    let discovery: SupatermManagedSocketDiscoveryResult
    if shouldDiscover {
      let candidatePaths = SupatermSocketPath.discoverManagedSocketPaths(
        rootDirectory: rootDirectory,
        fileManager: fileManager
      )
      discovery = SupatermManagedSocketDiscovery.discover(
        candidatePaths: candidatePaths,
        probe: probeEndpoint,
        removeStalePath: { path in
          removeManagedSocketPath(path)
        }
      )
    } else {
      discovery = .init(reachableEndpoints: [], removedStalePaths: [])
    }

    do {
      let resolvedTarget = try SupatermSocketTargetResolver.resolve(
        explicitPath: explicitSocketPath,
        environmentPath: environmentSocketPath,
        instance: instance,
        discoveredEndpoints: discovery.reachableEndpoints
      )
      return .init(
        explicitSocketPath: explicitSocketPath,
        environmentSocketPath: environmentSocketPath,
        requestedInstance: SupatermSocketPath.normalized(instance),
        discoveredEndpoints: discovery.reachableEndpoints,
        removedStalePaths: discovery.removedStalePaths,
        resolvedTarget: resolvedTarget,
        errorMessage: nil
      )
    } catch {
      return .init(
        explicitSocketPath: explicitSocketPath,
        environmentSocketPath: environmentSocketPath,
        requestedInstance: SupatermSocketPath.normalized(instance),
        discoveredEndpoints: discovery.reachableEndpoints,
        removedStalePaths: discovery.removedStalePaths,
        resolvedTarget: nil,
        errorMessage: formatResolutionError(
          error,
          discoveredEndpoints: discovery.reachableEndpoints
        )
      )
    }
  }

  static func selectionSourceDescription(_ source: SupatermSocketSelectionSource?) -> String? {
    switch source {
    case .explicitPath:
      return "explicit --socket"
    case .environmentPath:
      return "SUPATERM_SOCKET_PATH"
    case .explicitInstance:
      return "explicit --instance"
    case .discoveredSingleton:
      return "single discovered instance"
    case nil:
      return nil
    }
  }

  static func formatEndpoint(_ endpoint: SupatermSocketEndpoint) -> String {
    endpoint.displayString
  }

  private static func probeEndpoint(at path: String) -> SupatermManagedSocketCandidateStatus {
    guard let client = try? SPSocketClient(
      path: path,
      connectRetryInterval: discoveryConnectRetryInterval,
      connectRetryTimeout: discoveryConnectRetryTimeout,
      responseTimeout: discoveryResponseTimeout
    ) else {
      return .ignored
    }
    return client.probeIdentity()
  }

  private static func removeManagedSocketPath(_ path: String) {
    _ = path.withCString(unlink)
  }

  private static func formatResolutionError(
    _ error: Error,
    discoveredEndpoints: [SupatermSocketEndpoint]
  ) -> String {
    guard let error = error as? SupatermSocketSelectionError else {
      return error.localizedDescription
    }

    switch error {
    case .ambiguousDiscoveredInstances(let endpoints):
      return [
        error.localizedDescription,
        availableInstancesLine(for: endpoints),
      ]
      .compactMap { $0 }
      .joined(separator: "\n")

    case .ambiguousInstanceName(_, let endpoints):
      return [
        error.localizedDescription,
        availableInstancesLine(for: endpoints),
      ]
      .compactMap { $0 }
      .joined(separator: "\n")

    case .instanceNotFound:
      return [
        error.localizedDescription,
        availableInstancesLine(for: discoveredEndpoints),
      ]
      .compactMap { $0 }
      .joined(separator: "\n")

    case .missingTarget:
      return [
        error.localizedDescription,
        availableInstancesLine(for: discoveredEndpoints),
      ]
      .compactMap { $0 }
      .joined(separator: "\n")
    }
  }

  private static func availableInstancesLine(for endpoints: [SupatermSocketEndpoint]) -> String? {
    guard !endpoints.isEmpty else { return nil }
    let formatted = endpoints.map(formatEndpoint).joined(separator: "\n- ")
    return "Available instances:\n- \(formatted)"
  }
}
