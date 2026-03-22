import Darwin
import Foundation
import SupatermCLIShared

actor SocketControlRuntime {
  enum RuntimeError: Equatable, LocalizedError {
    case bindFailed(String)
    case createDirectoryFailed(String)
    case existingPathIsNotSocket(String)
    case listenFailed(String)
    case pathAlreadyInUse(String)
    case missingSocketPath
    case pathTooLong(String)
    case socketCreationFailed
    case unlinkFailed(String)

    var errorDescription: String? {
      switch self {
      case .bindFailed(let path):
        return "Failed to bind the Supaterm socket at \(path)."
      case .createDirectoryFailed(let path):
        return "Failed to create the Supaterm socket directory at \(path)."
      case .existingPathIsNotSocket(let path):
        return "Supaterm socket path is already occupied by a non-socket file: \(path)"
      case .listenFailed(let path):
        return "Failed to listen on the Supaterm socket at \(path)."
      case .pathAlreadyInUse(let path):
        return "Supaterm socket path is already in use: \(path)"
      case .missingSocketPath:
        return "Unable to resolve a Supaterm socket path."
      case .pathTooLong(let path):
        return "Supaterm socket path is too long: \(path)"
      case .socketCreationFailed:
        return "Failed to create the Supaterm socket server."
      case .unlinkFailed(let path):
        return "Failed to remove the stale Supaterm socket at \(path)."
      }
    }
  }

  private struct PendingReply: Sendable {
    let clientSocket: Int32
  }

  static let shared = SocketControlRuntime()

  private let endpointProvider: @Sendable () -> SupatermSocketEndpoint?
  private var bufferedRequests: [SocketControlClient.Request] = []
  private var endpoint: SupatermSocketEndpoint?
  private var listenerTask: Task<Void, Never>?
  private var pendingReplies: [UUID: PendingReply] = [:]
  private var requestsContinuation: AsyncStream<SocketControlClient.Request>.Continuation?
  private var serverSocket: Int32 = -1

  init(
    endpointProvider: @escaping @Sendable () -> SupatermSocketEndpoint? = {
      SupatermProcessSocketEndpoint.current()
    }
  ) {
    self.endpointProvider = endpointProvider
  }

  func currentEndpoint() -> SupatermSocketEndpoint? {
    endpoint
  }

  func requests() -> AsyncStream<SocketControlClient.Request> {
    requestsContinuation?.finish()
    let (stream, continuation) = AsyncStream.makeStream(of: SocketControlClient.Request.self)
    requestsContinuation = continuation
    if !bufferedRequests.isEmpty {
      let pending = bufferedRequests
      bufferedRequests.removeAll()
      for request in pending {
        continuation.yield(request)
      }
    }
    return stream
  }

  func start() throws -> SupatermSocketEndpoint {
    if let endpoint {
      return endpoint
    }

    guard let endpoint = endpointProvider() else {
      throw RuntimeError.missingSocketPath
    }
    let socketPath = endpoint.path

    let socketURL = URL(fileURLWithPath: socketPath)
    let directoryURL = socketURL.deletingLastPathComponent()
    do {
      try FileManager.default.createDirectory(
        at: directoryURL,
        withIntermediateDirectories: true,
        attributes: [.posixPermissions: 0o700]
      )
    } catch {
      throw RuntimeError.createDirectoryFailed(directoryURL.path)
    }

    try Self.prepareSocketPathForBinding(socketPath)

    let serverSocket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard serverSocket >= 0 else {
      throw RuntimeError.socketCreationFailed
    }

    do {
      var address = try Self.socketAddress(path: socketPath)
      let bindResult = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          Darwin.bind(serverSocket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard bindResult == 0 else {
        throw RuntimeError.bindFailed(socketPath)
      }

      try FileManager.default.setAttributes(
        [.posixPermissions: 0o600],
        ofItemAtPath: socketPath
      )

      guard listen(serverSocket, 16) == 0 else {
        throw RuntimeError.listenFailed(socketPath)
      }

      self.serverSocket = serverSocket
      self.endpoint = endpoint

      let runtime = self
      listenerTask = Task.detached(priority: .utility) {
        Self.acceptLoop(serverSocket: serverSocket, runtime: runtime)
      }

      return endpoint
    } catch {
      Darwin.close(serverSocket)
      Self.removeSocketIfPresent(at: socketPath)
      throw error
    }
  }

  func stop() {
    let listenerTask = listenerTask
    self.listenerTask = nil
    listenerTask?.cancel()

    if serverSocket >= 0 {
      Darwin.close(serverSocket)
      serverSocket = -1
    }

    for pendingReply in pendingReplies.values {
      Darwin.close(pendingReply.clientSocket)
    }
    pendingReplies.removeAll()
    bufferedRequests.removeAll()
    requestsContinuation?.finish()
    requestsContinuation = nil

    if let endpoint {
      Self.removeSocketIfPresent(at: endpoint.path)
    }
    endpoint = nil
  }

  func reply(_ response: SupatermSocketResponse, to handle: UUID) {
    guard let pendingReply = pendingReplies.removeValue(forKey: handle) else { return }
    Self.writeResponse(response, to: pendingReply.clientSocket)
  }

  private func handleRequestLine(_ requestLine: String?, clientSocket: Int32) {
    guard
      let requestLine = requestLine?.trimmingCharacters(in: .whitespacesAndNewlines),
      !requestLine.isEmpty
    else {
      Darwin.close(clientSocket)
      return
    }

    guard let requestData = requestLine.data(using: .utf8) else {
      Self.writeResponse(
        .error(code: "invalid_request", message: "Request must be valid UTF-8 JSON."),
        to: clientSocket
      )
      return
    }

    let decoder = JSONDecoder()
    guard let request = try? decoder.decode(SupatermSocketRequest.self, from: requestData) else {
      Self.writeResponse(
        .error(code: "invalid_request", message: "Request must be a valid Supaterm socket payload."),
        to: clientSocket
      )
      return
    }

    let handle = UUID()
    pendingReplies[handle] = PendingReply(clientSocket: clientSocket)
    emit(.init(handle: handle, payload: request))
  }

  private func emit(_ request: SocketControlClient.Request) {
    guard let requestsContinuation else {
      bufferedRequests.append(request)
      return
    }
    requestsContinuation.yield(request)
  }

  private nonisolated static func acceptLoop(
    serverSocket: Int32,
    runtime: SocketControlRuntime
  ) {
    while !Task.isCancelled {
      let clientSocket = Darwin.accept(serverSocket, nil, nil)
      guard clientSocket >= 0 else {
        if errno == EBADF || errno == EINVAL {
          return
        }
        continue
      }

      Task.detached(priority: .utility) {
        let requestLine = Self.readLine(from: clientSocket)
        await runtime.handleRequestLine(requestLine, clientSocket: clientSocket)
      }
    }
  }

  private nonisolated static func socketAddress(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    memset(&address, 0, MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)

    let maxLength = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < maxLength else {
      throw RuntimeError.pathTooLong(path)
    }

    path.withCString { pointer in
      withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
        let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
        strncpy(buffer, pointer, maxLength - 1)
      }
    }

    return address
  }

  private nonisolated static func removeExistingSocket(at path: String) throws {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }
    guard status == 0 else {
      if errno == ENOENT {
        return
      }
      throw RuntimeError.unlinkFailed(path)
    }

    guard (fileStatus.st_mode & S_IFMT) == S_IFSOCK else {
      throw RuntimeError.existingPathIsNotSocket(path)
    }

    let unlinkResult = path.withCString(unlink)
    guard unlinkResult == 0 else {
      throw RuntimeError.unlinkFailed(path)
    }
  }

  private nonisolated static func prepareSocketPathForBinding(_ path: String) throws {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }
    guard status == 0 else {
      if errno == ENOENT {
        return
      }
      throw RuntimeError.unlinkFailed(path)
    }

    guard (fileStatus.st_mode & S_IFMT) == S_IFSOCK else {
      throw RuntimeError.existingPathIsNotSocket(path)
    }

    if Self.canConnect(to: path) {
      throw RuntimeError.pathAlreadyInUse(path)
    }

    let unlinkResult = path.withCString(unlink)
    guard unlinkResult == 0 else {
      throw RuntimeError.unlinkFailed(path)
    }
  }

  private nonisolated static func removeSocketIfPresent(at path: String) {
    try? removeExistingSocket(at: path)
  }

  private nonisolated static func canConnect(to path: String) -> Bool {
    let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socket >= 0 else {
      return false
    }
    defer { Darwin.close(socket) }

    guard var address = try? socketAddress(path: path) else {
      return false
    }

    let result = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.connect(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    return result == 0
  }

  private nonisolated static func readLine(from socket: Int32) -> String? {
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

  private nonisolated static func writeResponse(
    _ response: SupatermSocketResponse,
    to socket: Int32
  ) {
    let encoder = JSONEncoder()
    guard let encoded = try? encoder.encode(response) else {
      Darwin.close(socket)
      return
    }
    let data = encoded + Data([0x0A])

    data.withUnsafeBytes { buffer in
      guard let baseAddress = buffer.baseAddress else { return }
      var offset = 0
      while offset < buffer.count {
        let bytesWritten = Darwin.write(
          socket,
          baseAddress.advanced(by: offset),
          buffer.count - offset
        )
        guard bytesWritten > 0 else { return }
        offset += bytesWritten
      }
    }

    Darwin.close(socket)
  }
}
