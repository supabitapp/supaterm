import Darwin
import Foundation
import SupatermCLIShared

struct SPSocketClient {
  private enum SocketClientError: LocalizedError {
    case connectFailed(String)
    case invalidResponse
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

  init(path: String) throws {
    guard let normalized = SupatermSocketPath.normalized(path) else {
      throw SocketClientError.connectFailed(path)
    }
    self.path = normalized
  }

  func send(_ request: SupatermSocketRequest) throws -> SupatermSocketResponse {
    let socket = try openSocket()
    defer { Darwin.close(socket) }

    let timeout = timeval(tv_sec: 5, tv_usec: 0)
    var receiveTimeout = timeout
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

  private func openSocket() throws -> Int32 {
    let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socket >= 0 else {
      throw SocketClientError.socketCreationFailed
    }

    do {
      var address = try socketAddress(path: path)
      let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          Darwin.connect(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard result == 0 else {
        throw SocketClientError.connectFailed(path)
      }
      return socket
    } catch {
      Darwin.close(socket)
      throw error
    }
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
