import Darwin
import Dispatch
import Foundation
import Network
import Testing

@testable import SupatermCLIShared

nonisolated enum SupatermHostTerminalLookup: CaseIterable, Sendable {
  case list
  case get
}

nonisolated struct SupatermHostCanceledAttachFixture: Sendable {
  let activeTerminal: SupatermHostTerminalInfo
  let activeAttachmentID: AttachmentID
  let orphanTerminal: SupatermHostTerminalInfo
  let orphanAttachmentID: AttachmentID
}

nonisolated func serveCanceledAttachCleanup(
  _ socket: Int32,
  sentFirstReplay: AsyncStream<Void>.Continuation,
  allowFinal: DispatchSemaphore,
  fixture: SupatermHostCanceledAttachFixture
) throws -> [SupatermHostClientEnvelope] {
  try serveHello(socket)
  let activeAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: activeAttach.requestID,
      body: .attached(
        terminal: fixture.activeTerminal,
        attachmentID: fixture.activeAttachmentID,
        boundarySequence: 0,
        nextInputSequence: 0
      )
    )
  )
  let orphanAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attachReplay(
        attachmentID: fixture.orphanAttachmentID,
        segment: .vt,
        data: Data("partial".utf8)
      )
    )
  )
  sentFirstReplay.yield()
  guard allowFinal.wait(timeout: .now() + 2) == .success else {
    throw SupatermHostWireTestError.timeout
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attachReplay(
        attachmentID: fixture.orphanAttachmentID,
        segment: .continuation,
        data: Data("ignored".utf8)
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: orphanAttach.requestID,
      body: .attached(
        terminal: fixture.orphanTerminal,
        attachmentID: fixture.orphanAttachmentID,
        boundarySequence: 8,
        nextInputSequence: 2
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: fixture.orphanTerminal.id,
        attachmentID: fixture.orphanAttachmentID,
        sequence: 8,
        data: Data([9])
      )
    )
  )
  let cleanup = try readClientEnvelope(socket)
  guard
    case .detach(let terminalID, let attachmentID) = cleanup.body,
    terminalID == fixture.orphanTerminal.id,
    attachmentID == fixture.orphanAttachmentID
  else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: fixture.activeTerminal.id,
        attachmentID: fixture.activeAttachmentID,
        sequence: 0,
        data: Data([7])
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: cleanup.requestID, body: .ack)
  )
  let list = try readClientEnvelope(socket)
  guard case .list = list.body else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
  )
  return [activeAttach, orphanAttach, cleanup, list]
}

nonisolated func serveResyncIsolation(
  _ socket: Int32,
  revokedTerminal: SupatermHostTerminalInfo,
  revokedAttachmentID: AttachmentID,
  activeTerminal: SupatermHostTerminalInfo,
  activeAttachmentID: AttachmentID
) throws -> [SupatermHostClientEnvelope] {
  try serveHello(socket)
  let revokedAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: revokedAttach.requestID,
      body: .attached(
        terminal: revokedTerminal,
        attachmentID: revokedAttachmentID,
        boundarySequence: 4,
        nextInputSequence: 1
      )
    )
  )
  let activeAttach = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: activeAttach.requestID,
      body: .attached(
        terminal: activeTerminal,
        attachmentID: activeAttachmentID,
        boundarySequence: 20,
        nextInputSequence: 7
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .output(
        terminalID: revokedTerminal.id,
        attachmentID: revokedAttachmentID,
        sequence: 4,
        data: Data("queued".utf8)
      )
    )
  )
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: nil,
      body: .resyncRequired(
        terminalID: revokedTerminal.id,
        attachmentID: revokedAttachmentID
      )
    )
  )
  let list = try readClientEnvelope(socket)
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(requestID: list.requestID, body: .terminals([]))
  )
  let input = try readClientEnvelope(socket)
  guard case .input(_, _, 7, let data) = input.body, data == Data([1]) else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: input.requestID,
      body: .inputCommitted(nextInputSequence: 8)
    )
  )
  return [revokedAttach, activeAttach, list, input]
}

nonisolated struct SupatermHostWireTestServer: Sendable {
  let root: URL
  let socketURL: URL
  let listener: Int32
  let result: Task<[SupatermHostClientEnvelope], any Error>

  init(
    script: @escaping @Sendable (Int32) throws -> [SupatermHostClientEnvelope]
  ) throws {
    let identifier = UUID().uuidString.prefix(8)
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent("sth-wire-\(identifier)", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: false)
    guard chmod(root.path, 0o700) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    let socketURL = root.appendingPathComponent("host.sock")
    let listener = try bindHostWireSocket(at: socketURL)
    self.root = root
    self.socketURL = socketURL
    self.listener = listener
    result = Task.detached {
      let socket = Darwin.accept(listener, nil, nil)
      guard socket >= 0 else {
        throw SupatermHostWireTestError.system(errno)
      }
      defer { Darwin.close(socket) }
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
        throw SupatermHostWireTestError.system(errno)
      }
      return try script(socket)
    }
  }

  func destroy() {
    result.cancel()
    Darwin.close(listener)
    try? FileManager.default.removeItem(at: root)
  }
}

nonisolated enum SupatermHostWireTestError: Error {
  case closed
  case pathLength
  case system(Int32)
  case timeout
  case unexpectedRequest
}

nonisolated func bindHostWireSocket(at socketURL: URL) throws -> Int32 {
  let descriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard descriptor >= 0 else {
    throw SupatermHostWireTestError.system(errno)
  }
  do {
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let path = socketURL.path
    let capacity = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < capacity else {
      throw SupatermHostWireTestError.pathLength
    }
    _ = path.withCString { source in
      withUnsafeMutablePointer(to: &address.sun_path) { destination in
        strncpy(
          UnsafeMutableRawPointer(destination).assumingMemoryBound(to: CChar.self),
          source,
          capacity - 1
        )
      }
    }
    var mutableAddress = address
    let bindResult = withUnsafePointer(to: &mutableAddress) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
      }
    }
    guard bindResult == 0, Darwin.listen(descriptor, 1) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    guard chmod(socketURL.path, 0o600) == 0 else {
      throw SupatermHostWireTestError.system(errno)
    }
    return descriptor
  } catch {
    Darwin.close(descriptor)
    throw error
  }
}

nonisolated func readClientEnvelope(_ socket: Int32) throws
  -> SupatermHostClientEnvelope
{
  let header = try readHostWireBytes(socket, count: MemoryLayout<UInt32>.size)
  let codec = SupatermHostFrameCodec()
  let length = try codec.decodePayloadLength(header)
  let payload = try readHostWireBytes(socket, count: length)
  return try codec.decodePayload(SupatermHostClientEnvelope.self, from: payload)
}

nonisolated func writeHostEnvelope(
  _ socket: Int32,
  _ envelope: SupatermHostEnvelope,
  fragmented: Bool = false
) throws {
  let frame = try SupatermHostFrameCodec().encode(envelope)
  if fragmented {
    for byte in frame {
      try writeHostWireBytes(socket, data: Data([byte]))
    }
  } else {
    try writeHostWireBytes(socket, data: frame)
  }
}

nonisolated func serveHello(_ socket: Int32) throws {
  let hello = try readClientEnvelope(socket)
  guard case .hello = hello.body else {
    throw SupatermHostWireTestError.unexpectedRequest
  }
  try writeHostEnvelope(
    socket,
    SupatermHostEnvelope(
      requestID: hello.requestID,
      body: .hello(
        machineID: testMachineID("123e4567-e89b-12d3-a456-426614174004"),
        bootID: testBootID("123e4567-e89b-12d3-a456-426614174005")
      )
    )
  )
}

nonisolated func readHostWireBytes(_ socket: Int32, count: Int) throws -> Data {
  var data = Data(count: count)
  var offset = 0
  while offset < count {
    let readCount = data.withUnsafeMutableBytes { buffer in
      Darwin.read(socket, buffer.baseAddress?.advanced(by: offset), count - offset)
    }
    if readCount < 0, errno == EINTR {
      continue
    }
    guard readCount > 0 else {
      throw readCount == 0
        ? SupatermHostWireTestError.closed
        : SupatermHostWireTestError.system(errno)
    }
    offset += readCount
  }
  return data
}

nonisolated func writeHostWireBytes(_ socket: Int32, data: Data) throws {
  try data.withUnsafeBytes { buffer in
    var offset = 0
    while offset < buffer.count {
      let written = Darwin.write(
        socket,
        buffer.baseAddress?.advanced(by: offset),
        buffer.count - offset
      )
      if written < 0, errno == EINTR {
        continue
      }
      guard written > 0 else {
        throw SupatermHostWireTestError.system(errno)
      }
      offset += written
    }
  }
}

nonisolated func testTerminalInfo(
  id: TerminalID,
  bootID: BootID = testBootID("123e4567-e89b-12d3-a456-426614174005"),
  status: SupatermHostTerminalStatus = .running,
  inputState: SupatermHostInputState = .ready
) -> SupatermHostTerminalInfo {
  SupatermHostTerminalInfo(
    id: id,
    bootID: bootID,
    argv: ["/bin/sh"],
    cwd: "/tmp",
    size: SupatermHostTerminalSize(),
    status: status,
    inputState: inputState
  )
}

nonisolated func testTerminalID(_ value: String) -> TerminalID {
  TerminalID(rawValue: testUUID(value))
}

nonisolated func testAttachmentID(_ value: String) -> AttachmentID {
  AttachmentID(rawValue: testUUID(value))
}

nonisolated func testMachineID(_ value: String) -> MachineID {
  MachineID(rawValue: testUUID(value))
}

nonisolated func testBootID(_ value: String) -> BootID {
  BootID(rawValue: testUUID(value))
}

nonisolated func testUUID(_ value: String) -> UUID {
  guard let result = UUID(uuidString: value) else {
    preconditionFailure("invalid test UUID")
  }
  return result
}
