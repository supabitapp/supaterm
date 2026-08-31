import Darwin
import Foundation
import SupatermCLIShared

struct SPSocketClient {
  static let defaultConnectRetryTimeout: TimeInterval = 2

  private enum SocketClientError: LocalizedError {
    case connectFailed(String)
    case deadlineExceeded
    case invalidResponse
    case pathIsNotSocket(String)
    case pathNotOwnedByCurrentUser(String)
    case pathTooLong(String)
    case readFailed
    case requestTooLarge
    case socketConfigurationFailed
    case socketCreationFailed
    case writeFailed

    var errorDescription: String? {
      switch self {
      case .connectFailed(let path):
        return "Failed to connect to Supaterm at \(path)."
      case .deadlineExceeded:
        return "Supaterm socket request timed out."
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
      case .requestTooLarge:
        return "Supaterm socket request exceeds \(SupatermSocketRequest.maximumEncodedBytes) bytes."
      case .socketConfigurationFailed:
        return "Failed to configure a local socket client."
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
  private let deadline: Date?
  private let responseTimeout: TimeInterval

  init(
    path: String,
    connectRetryInterval: TimeInterval = 0.1,
    connectRetryTimeout: TimeInterval = SPSocketClient.defaultConnectRetryTimeout,
    responseTimeout: TimeInterval = 5,
    deadline: Date? = nil
  ) throws {
    guard let normalized = SupatermSocketPath.normalized(path) else {
      throw SocketClientError.connectFailed(path)
    }
    self.path = normalized
    self.connectRetryInterval = connectRetryInterval
    self.connectRetryTimeout = connectRetryTimeout
    self.deadline = deadline
    self.responseTimeout = responseTimeout
  }

  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse {
    try validateDeadline()
    let requestData = try encodedRequest(request)
    let socket = try openSocket()
    defer { Darwin.close(socket) }

    return try send(requestData, over: socket)
  }

  func probeIdentity() -> SupatermManagedSocketCandidateStatus {
    do {
      let response = try send(.identity())
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
    } catch SocketClientError.connectFailed {
      return managedSocketOwnerProcessID(path).map(processIsProvablyDead) == true
        ? .stale : .ignored
    } catch {
      return .ignored
    }
  }

  static func isConnectionFailure(_ error: any Error) -> Bool {
    guard let error = error as? SocketClientError else { return false }
    guard case .connectFailed = error else { return false }
    return true
  }

  private func openSocket() throws -> Int32 {
    let retryDeadline = Date().addingTimeInterval(connectRetryTimeout)

    while true {
      try validateDeadline()
      try validateTargetPath()

      let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
      guard socket >= 0 else {
        throw SocketClientError.socketCreationFailed
      }
      var noSigPipe: Int32 = 1
      guard
        setsockopt(
          socket,
          SOL_SOCKET,
          SO_NOSIGPIPE,
          &noSigPipe,
          socklen_t(MemoryLayout<Int32>.size)
        ) == 0
      else {
        Darwin.close(socket)
        throw SocketClientError.socketConfigurationFailed
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

      let now = Date()
      try validateDeadline(now: now)
      guard shouldRetryConnect(after: connectError), now < retryDeadline else {
        throw SocketClientError.connectFailed(path)
      }

      Thread.sleep(
        forTimeInterval: min(
          connectRetryInterval,
          min(
            retryDeadline.timeIntervalSince(now),
            deadline?.timeIntervalSince(now) ?? connectRetryInterval
          )
        )
      )
    }
  }

  private func send(
    _ requestData: Data,
    over socket: Int32
  ) throws -> SupatermSocketResponse {
    let responseDeadline = try operationDeadline(after: responseTimeout)

    try setSocketTimeout(SO_RCVTIMEO, on: socket, deadline: responseDeadline)
    try writeAll(requestData, to: socket, deadline: responseDeadline)

    guard let responseLine = try readLine(from: socket, deadline: responseDeadline) else {
      throw SocketClientError.readFailed
    }
    guard let responseData = responseLine.data(using: .utf8) else {
      throw SocketClientError.invalidResponse
    }
    return try decoder.decode(SupatermSocketResponse.self, from: responseData)
  }

  private func encodedRequest(_ request: SupatermSocketRequest) throws -> Data {
    let data = try encoder.encode(request)
    guard data.count <= SupatermSocketRequest.maximumEncodedBytes else {
      throw SocketClientError.requestTooLarge
    }
    return data + Data([0x0A])
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

  private func writeAll(
    _ data: Data,
    to socket: Int32,
    deadline: Date
  ) throws {
    try data.withUnsafeBytes { buffer in
      guard let baseAddress = buffer.baseAddress else { return }
      var offset = 0
      while offset < buffer.count {
        try setSocketTimeout(SO_SNDTIMEO, on: socket, deadline: deadline)
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
    let totalMicroseconds = max(1, Int64((interval * 1_000_000).rounded(.up)))
    return timeval(
      tv_sec: __darwin_time_t(totalMicroseconds / 1_000_000),
      tv_usec: __darwin_suseconds_t(totalMicroseconds % 1_000_000)
    )
  }

  private func readLine(from socket: Int32, deadline: Date) throws -> String? {
    var data = Data()
    var buffer = [UInt8](repeating: 0, count: 1024)

    while true {
      try setSocketTimeout(
        SO_RCVTIMEO,
        on: socket,
        deadline: deadline,
        toleratingClosedPeer: true
      )
      let bytesRead = Darwin.read(socket, &buffer, buffer.count)
      guard bytesRead >= 0 else { throw SocketClientError.readFailed }
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

  private func operationDeadline(after timeout: TimeInterval) throws -> Date {
    let now = Date()
    try validateDeadline(now: now)
    let timeoutDeadline = now.addingTimeInterval(max(0, timeout))
    return deadline.map { min($0, timeoutDeadline) } ?? timeoutDeadline
  }

  private func setSocketTimeout(
    _ option: Int32,
    on socket: Int32,
    deadline: Date,
    toleratingClosedPeer: Bool = false
  ) throws {
    let remainingTime = deadline.timeIntervalSinceNow
    guard remainingTime > 0 else { throw SocketClientError.deadlineExceeded }
    var timeout = socketTimeout(remainingTime)
    let result = setsockopt(
      socket,
      SOL_SOCKET,
      option,
      &timeout,
      socklen_t(MemoryLayout<timeval>.size)
    )
    guard result == 0 || (toleratingClosedPeer && errno == EINVAL) else {
      throw SocketClientError.socketConfigurationFailed
    }
  }

  private func validateDeadline(now: Date = Date()) throws {
    guard deadline.map({ now < $0 }) != false else {
      throw SocketClientError.deadlineExceeded
    }
  }
}

func managedSocketOwnerProcessID(_ path: String) -> Int32? {
  let fileName = URL(fileURLWithPath: path).lastPathComponent
  guard let marker = fileName.range(of: "-pid-", options: .backwards) else { return nil }
  let suffix = fileName[marker.upperBound...]
  guard !suffix.isEmpty, suffix.allSatisfy(\.isNumber) else { return nil }
  return Int32(String(suffix)).flatMap { $0 > 0 ? $0 : nil }
}

func processIsProvablyDead(_ processID: Int32) -> Bool {
  guard kill(processID, 0) != 0 else { return false }
  return errno == ESRCH
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

struct SPSocketEndpointDiscoveryResult {
  let endpoints: [SupatermSocketEndpoint]
  let removedStalePaths: [String]
  let isComplete: Bool
}

enum SPSocketDiscoveryPolicy {
  case whenNeeded
  case always
}

struct SPSocketResolutionStrategy: Equatable {
  let environmentPath: String?
  let discoversManagedSockets: Bool

  static func make(
    explicitSocketPath: String?,
    environmentSocketPath: String?,
    environmentPathStatus: SupatermManagedSocketCandidateStatus?,
    discoveryPolicy: SPSocketDiscoveryPolicy
  ) -> Self {
    Self(
      environmentPath: resolvedEnvironmentPath(
        explicitSocketPath: explicitSocketPath,
        environmentSocketPath: environmentSocketPath,
        environmentPathStatus: environmentPathStatus
      ),
      discoversManagedSockets: discoversManagedSockets(
        explicitSocketPath: explicitSocketPath,
        environmentPathStatus: environmentPathStatus,
        discoveryPolicy: discoveryPolicy
      )
    )
  }

  private static func resolvedEnvironmentPath(
    explicitSocketPath: String?,
    environmentSocketPath: String?,
    environmentPathStatus: SupatermManagedSocketCandidateStatus?
  ) -> String? {
    guard explicitSocketPath == nil else {
      return nil
    }
    guard case .reachable = environmentPathStatus else {
      return nil
    }
    return environmentSocketPath
  }

  private static func discoversManagedSockets(
    explicitSocketPath: String?,
    environmentPathStatus: SupatermManagedSocketCandidateStatus?,
    discoveryPolicy: SPSocketDiscoveryPolicy
  ) -> Bool {
    switch discoveryPolicy {
    case .always:
      return true
    case .whenNeeded:
      guard explicitSocketPath == nil else {
        return false
      }
      guard case .reachable = environmentPathStatus else {
        return true
      }
      return false
    }
  }
}

enum SPSocketSelection {
  private static let discoveryConnectRetryInterval: TimeInterval = 0.05
  private static let discoveryConnectRetryTimeout: TimeInterval = 0.25
  private static let discoveryResponseTimeout: TimeInterval = 0.25
  private static let environmentResponseTimeout: TimeInterval = 1

  static func resolve(
    explicitPath: String?,
    instance: String?,
    discoveryPolicy: SPSocketDiscoveryPolicy = .whenNeeded,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> SPSocketSelectionDiagnostics {
    let explicitSocketPath = SupatermSocketPath.normalized(explicitPath)
    let environmentSocketPath = SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.socketPathKey])
    let environmentPathStatus =
      explicitSocketPath == nil
      ? environmentSocketPath.map {
        probeEndpoint(
          at: $0,
          connectRetryTimeout: SPSocketClient.defaultConnectRetryTimeout,
          responseTimeout: environmentResponseTimeout
        )
      }
      : nil
    let strategy = SPSocketResolutionStrategy.make(
      explicitSocketPath: explicitSocketPath,
      environmentSocketPath: environmentSocketPath,
      environmentPathStatus: environmentPathStatus,
      discoveryPolicy: discoveryPolicy
    )

    let discovery: SPSocketEndpointDiscoveryResult
    if strategy.discoversManagedSockets {
      discovery = discoverManagedEndpoints(
        connectRetryInterval: discoveryConnectRetryInterval,
        connectRetryTimeout: discoveryConnectRetryTimeout,
        responseTimeout: discoveryResponseTimeout,
        deadline: nil,
        environment: environment,
        rootDirectory: rootDirectory,
        fileManager: fileManager
      )
    } else {
      discovery = SPSocketEndpointDiscoveryResult(
        endpoints: [],
        removedStalePaths: [],
        isComplete: true
      )
    }

    do {
      let resolvedTarget = try SupatermSocketTargetResolver.resolve(
        explicitPath: explicitSocketPath,
        environmentPath: strategy.environmentPath,
        instance: instance,
        discoveredEndpoints: discovery.endpoints
      )
      return SPSocketSelectionDiagnostics(
        explicitSocketPath: explicitSocketPath,
        environmentSocketPath: environmentSocketPath,
        requestedInstance: SupatermSocketPath.normalized(instance),
        discoveredEndpoints: discovery.endpoints,
        removedStalePaths: discovery.removedStalePaths,
        resolvedTarget: resolvedTarget,
        errorMessage: nil
      )
    } catch {
      return SPSocketSelectionDiagnostics(
        explicitSocketPath: explicitSocketPath,
        environmentSocketPath: environmentSocketPath,
        requestedInstance: SupatermSocketPath.normalized(instance),
        discoveredEndpoints: discovery.endpoints,
        removedStalePaths: discovery.removedStalePaths,
        resolvedTarget: nil,
        errorMessage: formatResolutionError(
          error,
          discoveredEndpoints: discovery.endpoints
        )
      )
    }
  }

  static func discoverManagedEndpoints(
    connectRetryInterval: TimeInterval,
    connectRetryTimeout: TimeInterval,
    responseTimeout: TimeInterval,
    deadline: Date?,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    rootDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> SPSocketEndpointDiscoveryResult {
    guard deadline.map({ Date() < $0 }) != false else {
      return SPSocketEndpointDiscoveryResult(
        endpoints: [],
        removedStalePaths: [],
        isComplete: false
      )
    }

    let candidatePaths = SupatermSocketPath.discoverManagedSocketPaths(
      rootDirectory: rootDirectory,
      environment: environment,
      fileManager: fileManager
    )
    var isComplete = true
    let discovery = SupatermManagedSocketDiscovery.discover(
      candidatePaths: candidatePaths,
      probe: { path in
        let status = probeEndpoint(
          at: path,
          connectRetryInterval: connectRetryInterval,
          connectRetryTimeout: connectRetryTimeout,
          responseTimeout: responseTimeout,
          deadline: deadline
        )
        if case .ignored = status {
          isComplete = false
        }
        return status
      },
      removeStalePath: { path in
        removeManagedSocketPath(
          path,
          rootDirectory: rootDirectory,
          environment: environment
        )
      }
    )
    return SPSocketEndpointDiscoveryResult(
      endpoints: discovery.reachableEndpoints,
      removedStalePaths: discovery.removedStalePaths,
      isComplete: isComplete
    )
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

  private static func probeEndpoint(
    at path: String,
    connectRetryInterval: TimeInterval = discoveryConnectRetryInterval,
    connectRetryTimeout: TimeInterval,
    responseTimeout: TimeInterval,
    deadline: Date? = nil
  ) -> SupatermManagedSocketCandidateStatus {
    guard
      let client = try? SPSocketClient(
        path: path,
        connectRetryInterval: connectRetryInterval,
        connectRetryTimeout: connectRetryTimeout,
        responseTimeout: responseTimeout,
        deadline: deadline
      )
    else {
      return .ignored
    }
    return client.probeIdentity()
  }

  @discardableResult
  static func removeManagedSocketPath(
    _ path: String,
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid()
  ) -> Bool {
    guard
      let processID = managedSocketOwnerProcessID(path),
      processIsProvablyDead(processID),
      SupatermSocketPath.isOwnedManagedSocketPath(
        path,
        rootDirectory: rootDirectory,
        environment: environment,
        userID: userID
      )
    else {
      return false
    }
    return path.withCString(unlink) == 0
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
