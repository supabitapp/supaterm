import Darwin
import Foundation
import SupatermHostClient

nonisolated struct HostUnixTransport: HostTransport {
  let socketPath: String

  func open() async throws -> HostTransportLink {
    let socket = try await HostUnixSocket.connect(path: socketPath)
    return HostTransportLink(
      incoming: socket.incoming,
      send: { data in try await socket.send(data) },
      close: { await socket.close() }
    )
  }
}

private actor HostUnixSocket {
  nonisolated let incoming: AsyncThrowingStream<Data, any Error>

  private let continuation: AsyncThrowingStream<Data, any Error>.Continuation
  private var descriptor: Int32
  private var reader: Task<Void, Never>?
  private var closing = false

  private init(descriptor: Int32) {
    self.descriptor = descriptor
    let pair = AsyncThrowingStream<Data, any Error>.makeStream(
      bufferingPolicy: .bufferingNewest(256)
    )
    incoming = pair.stream
    continuation = pair.continuation
  }

  static func connect(path: String) async throws -> HostUnixSocket {
    let descriptor = try await Task.detached(priority: .userInitiated) {
      try openDescriptor(path: path)
    }.value
    let socket = HostUnixSocket(descriptor: descriptor)
    await socket.startReader()
    return socket
  }

  func send(_ data: Data) throws {
    guard !closing else { throw HostUnixTransportError.closed }
    try data.withUnsafeBytes { bytes in
      guard let baseAddress = bytes.baseAddress else { return }
      var offset = 0
      while offset < bytes.count {
        let written = Darwin.write(
          descriptor,
          baseAddress.advanced(by: offset),
          bytes.count - offset
        )
        if written > 0 {
          offset += written
        } else if written < 0 && errno == EINTR {
          continue
        } else {
          throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
        }
      }
    }
  }

  func close() async {
    guard !closing else { return }
    closing = true
    let descriptor = descriptor
    _ = Darwin.shutdown(descriptor, SHUT_RDWR)
    await reader?.value
    reader = nil
    Darwin.close(descriptor)
    self.descriptor = -1
    continuation.finish()
  }

  private func startReader() {
    let descriptor = descriptor
    let continuation = continuation
    reader = Task.detached(priority: .userInitiated) {
      var buffer = [UInt8](repeating: 0, count: 64 * 1024)
      while !Task.isCancelled {
        let count = Darwin.read(descriptor, &buffer, buffer.count)
        if count > 0 {
          if case .terminated = continuation.yield(Data(buffer.prefix(count))) {
            return
          }
        } else if count == 0 {
          continuation.finish()
          return
        } else if errno != EINTR {
          continuation.finish(
            throwing: POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
          )
          return
        }
      }
    }
  }

  private nonisolated static func openDescriptor(path: String) throws -> Int32 {
    try validate(path: path)
    let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard descriptor >= 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    do {
      let address = try address(path: path)
      var mutableAddress = address
      let connected = withUnsafePointer(to: &mutableAddress) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
          Darwin.connect(
            descriptor,
            $0,
            socklen_t(MemoryLayout<sockaddr_un>.size)
          )
        }
      }
      guard connected == 0 else {
        throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
      }
      _ = fcntl(descriptor, F_SETFD, FD_CLOEXEC)
      var noSignal: Int32 = 1
      _ = setsockopt(
        descriptor,
        SOL_SOCKET,
        SO_NOSIGPIPE,
        &noSignal,
        socklen_t(MemoryLayout<Int32>.size)
      )
      return descriptor
    } catch {
      Darwin.close(descriptor)
      throw error
    }
  }

  private nonisolated static func validate(path: String) throws {
    var status = stat()
    guard lstat(path, &status) == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .ENOENT)
    }
    guard status.st_mode & S_IFMT == S_IFSOCK else {
      throw HostUnixTransportError.notSocket
    }
    guard status.st_uid == getuid() else {
      throw HostUnixTransportError.wrongOwner
    }
  }

  private nonisolated static func address(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let maximumLength = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < maximumLength else {
      throw HostUnixTransportError.pathTooLong
    }
    path.withCString { source in
      withUnsafeMutablePointer(to: &address.sun_path) { pointer in
        let destination = UnsafeMutableRawPointer(pointer).assumingMemoryBound(to: CChar.self)
        strncpy(destination, source, maximumLength - 1)
      }
    }
    return address
  }
}

private enum HostUnixTransportError: Error {
  case closed
  case notSocket
  case pathTooLong
  case wrongOwner
}
