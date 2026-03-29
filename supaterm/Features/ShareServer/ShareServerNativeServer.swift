import CryptoKit
import Darwin
import Foundation
import Network
import SupatermCLIShared

private nonisolated enum ZmxProtocol {
  static let headerSize = 8
  static let headerLengthOffset = 1
  static let historyFormatVT: UInt8 = 1
}

private enum ZmxMessageTag: UInt8 {
  case input = 0
  case output = 1
  case resize = 2
  case detach = 3
  case kill = 5
  case initialize = 7
  case history = 8
}

enum ShareServerNativeError: Error, Equatable, LocalizedError {
  case invalidPort
  case listenerFailed(String)
  case missingWebAssets
  case paneNotFound
  case unauthorized
  case zmxConnectFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidPort:
      return "Invalid share server port."
    case .listenerFailed(let message):
      return message
    case .missingWebAssets:
      return "Missing bundled web assets."
    case .paneNotFound:
      return "Requested pane was not found."
    case .unauthorized:
      return "Unauthorized."
    case .zmxConnectFailed(let message):
      return message
    }
  }
}

enum ShareServerNativeBridge {
  nonisolated static func sendResize(
    sessionName: String,
    cols: Int,
    rows: Int
  ) throws {
    let connection = try ShareServerZMXSession(
      sessionName: sessionName,
      cols: cols,
      rows: rows
    )
    defer { connection.close(detach: true) }
    try connection.sendResize(cols: cols, rows: rows)
  }

  nonisolated static func sessionSocketPath(sessionName: String) -> String {
    let environment = ProcessInfo.processInfo.environment
    if let explicitDirectory = environment["ZMX_DIR"], !explicitDirectory.isEmpty {
      return URL(fileURLWithPath: explicitDirectory, isDirectory: true)
        .appendingPathComponent(sessionName, isDirectory: false)
        .path
    }

    if let runtimeDirectory = environment["XDG_RUNTIME_DIR"], !runtimeDirectory.isEmpty {
      return URL(fileURLWithPath: runtimeDirectory, isDirectory: true)
        .appendingPathComponent("zmx", isDirectory: true)
        .appendingPathComponent(sessionName, isDirectory: false)
        .path
    }

    let uid = getuid()
    let tmpDirectory = (environment["TMPDIR"]?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).flatMap {
      $0.isEmpty ? nil : "/\($0)"
    } ?? "/tmp"
    return "\(tmpDirectory)/zmx-\(uid)/\(sessionName)"
  }
}

private final class ShareServerZMXSession: @unchecked Sendable {
  private let socketFD: Int32
  private nonisolated(unsafe) var readSource: DispatchSourceRead?
  private nonisolated(unsafe) var readBuffer = Data()
  private nonisolated(unsafe) var isClosed = false

  nonisolated init(
    sessionName: String,
    cols: Int,
    rows: Int
  ) throws {
    let socketPath = ShareServerNativeBridge.sessionSocketPath(sessionName: sessionName)
    let socketFD = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socketFD >= 0 else {
      throw ShareServerNativeError.zmxConnectFailed("Failed to create zmx socket.")
    }

    do {
      var address = try Self.socketAddress(path: socketPath)
      let result = withUnsafePointer(to: &address) { pointer in
        pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
          Darwin.connect(socketFD, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
      }
      guard result == 0 else {
        throw ShareServerNativeError.zmxConnectFailed("Failed to connect to pane session.")
      }
      self.socketFD = socketFD
      try send(tag: .initialize, payload: Self.resizePayload(cols: cols, rows: rows))
      try send(tag: .history, payload: Data([ZmxProtocol.historyFormatVT]))
    } catch {
      Darwin.close(socketFD)
      throw error
    }
  }

  nonisolated func start(
    onRenderablePayload: @escaping @Sendable (Data) -> Void,
    onClosed: @escaping @Sendable () -> Void
  ) {
    let source = DispatchSource.makeReadSource(fileDescriptor: socketFD, queue: .global(qos: .userInitiated))
    source.setEventHandler { [weak self] in
      guard let self else { return }
      var buffer = [UInt8](repeating: 0, count: 65_536)
      let count = Darwin.read(self.socketFD, &buffer, buffer.count)
      if count <= 0 {
        self.close(detach: false)
        onClosed()
        return
      }
      self.readBuffer.append(buffer, count: count)
      self.drainFrames(onRenderablePayload: onRenderablePayload)
    }
    source.setCancelHandler { [weak self] in
      guard let self, !self.isClosed else { return }
      Darwin.close(self.socketFD)
      self.isClosed = true
    }
    readSource = source
    source.resume()
  }

  nonisolated func sendInput(_ data: Data) throws {
    try send(tag: .input, payload: data)
  }

  nonisolated func sendResize(cols: Int, rows: Int) throws {
    try send(tag: .resize, payload: Self.resizePayload(cols: cols, rows: rows))
  }

  nonisolated func close(detach: Bool) {
    if detach {
      try? send(tag: .detach, payload: Data())
    }
    readSource?.cancel()
    readSource = nil
    if !isClosed {
      Darwin.close(socketFD)
      isClosed = true
    }
  }

  private nonisolated func drainFrames(onRenderablePayload: @escaping @Sendable (Data) -> Void) {
    while readBuffer.count >= ZmxProtocol.headerSize {
      let payloadLength = Int(readBuffer.withUnsafeBytes { buffer in
        buffer.loadUnaligned(fromByteOffset: ZmxProtocol.headerLengthOffset, as: UInt32.self)
      })
      let totalLength = ZmxProtocol.headerSize + payloadLength
      guard readBuffer.count >= totalLength else { return }
      let tag = readBuffer[0]
      let payload = readBuffer.subdata(in: ZmxProtocol.headerSize..<totalLength)
      readBuffer.removeSubrange(0..<totalLength)
      if tag == ZmxMessageTag.output.rawValue || tag == ZmxMessageTag.history.rawValue {
        onRenderablePayload(payload)
      }
    }
  }

  private nonisolated func send(tag: ZmxMessageTag, payload: Data) throws {
    var message = Data(count: ZmxProtocol.headerSize)
    message[0] = tag.rawValue
    let length = UInt32(payload.count)
    withUnsafeBytes(of: length.littleEndian) { bytes in
      message.replaceSubrange(ZmxProtocol.headerLengthOffset..<(ZmxProtocol.headerLengthOffset + 4), with: bytes)
    }
    message.append(payload)
    try Self.writeAll(message, to: socketFD)
  }

  private nonisolated static func resizePayload(cols: Int, rows: Int) -> Data {
    var payload = Data(count: 4)
    let rowValue = UInt16(max(1, min(Int(UInt16.max), rows)))
    let colValue = UInt16(max(1, min(Int(UInt16.max), cols)))
    withUnsafeBytes(of: rowValue.littleEndian) { payload.replaceSubrange(0..<2, with: $0) }
    withUnsafeBytes(of: colValue.littleEndian) { payload.replaceSubrange(2..<4, with: $0) }
    return payload
  }

  private nonisolated static func writeAll(_ data: Data, to socket: Int32) throws {
    try data.withUnsafeBytes { rawBuffer in
      guard let baseAddress = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else { return }
      var written = 0
      while written < data.count {
        let result = Darwin.write(socket, baseAddress.advanced(by: written), data.count - written)
        guard result > 0 else {
          throw ShareServerNativeError.zmxConnectFailed("Failed to write to pane session.")
        }
        written += result
      }
    }
  }

  private nonisolated static func socketAddress(path: String) throws -> sockaddr_un {
    var address = sockaddr_un()
    memset(&address, 0, MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)
    let maxLength = MemoryLayout.size(ofValue: address.sun_path)
    guard path.utf8.count < maxLength else {
      throw ShareServerNativeError.zmxConnectFailed("Pane socket path is too long.")
    }
    path.withCString { pointer in
      withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
        let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
        strncpy(buffer, pointer, maxLength - 1)
      }
    }
    return address
  }
}

private final class ShareWebSocketConnection: @unchecked Sendable {
  private let connection: NWConnection
  private nonisolated(unsafe) var receiveBuffer = Data()
  private nonisolated(unsafe) var isClosed = false

  nonisolated init(connection: NWConnection) {
    self.connection = connection
  }

  nonisolated func start(
    onText: @escaping @Sendable (String) -> Void,
    onBinary: @escaping @Sendable (Data) -> Void,
    onClose: @escaping @Sendable () -> Void
  ) {
    receiveLoop(onText: onText, onBinary: onBinary, onClose: onClose)
  }

  nonisolated func sendText(_ text: String) {
    guard let data = text.data(using: .utf8) else { return }
    send(opcode: 0x1, payload: data)
  }

  nonisolated func sendBinary(_ data: Data) {
    send(opcode: 0x2, payload: data)
  }

  nonisolated func close() {
    guard !isClosed else { return }
    isClosed = true
    send(opcode: 0x8, payload: Data())
    connection.cancel()
  }

  private nonisolated func receiveLoop(
    onText: @escaping @Sendable (String) -> Void,
    onBinary: @escaping @Sendable (Data) -> Void,
    onClose: @escaping @Sendable () -> Void
  ) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] content, _, isComplete, _ in
      guard let self else { return }
      if let content, !content.isEmpty {
        self.receiveBuffer.append(content)
        self.drainFrames(onText: onText, onBinary: onBinary, onClose: onClose)
      }
      if isComplete {
        self.close()
        onClose()
        return
      }
      if !self.isClosed {
        self.receiveLoop(onText: onText, onBinary: onBinary, onClose: onClose)
      }
    }
  }

  private nonisolated func drainFrames(
    onText: @escaping @Sendable (String) -> Void,
    onBinary: @escaping @Sendable (Data) -> Void,
    onClose: @escaping @Sendable () -> Void
  ) {
    while let frame = nextFrame() {
      switch frame.opcode {
      case 0x1:
        if let text = String(data: frame.payload, encoding: .utf8) {
          onText(text)
        }
      case 0x2:
        onBinary(frame.payload)
      case 0x8:
        close()
        onClose()
        return
      case 0x9:
        send(opcode: 0xA, payload: frame.payload)
      default:
        continue
      }
    }
  }

  private nonisolated func nextFrame() -> (opcode: UInt8, payload: Data)? {
    guard receiveBuffer.count >= 2 else { return nil }
    let bytes = [UInt8](receiveBuffer.prefix(2))
    let masked = (bytes[1] & 0x80) != 0
    var payloadLength = Int(bytes[1] & 0x7F)
    var offset = 2

    if payloadLength == 126 {
      guard receiveBuffer.count >= offset + 2 else { return nil }
      payloadLength = Int(receiveBuffer.subdata(in: offset..<(offset + 2)).withUnsafeBytes {
        UInt16(bigEndian: $0.load(as: UInt16.self))
      })
      offset += 2
    } else if payloadLength == 127 {
      guard receiveBuffer.count >= offset + 8 else { return nil }
      payloadLength = Int(receiveBuffer.subdata(in: offset..<(offset + 8)).withUnsafeBytes {
        UInt64(bigEndian: $0.load(as: UInt64.self))
      })
      offset += 8
    }

    var maskingKey = [UInt8]()
    if masked {
      guard receiveBuffer.count >= offset + 4 else { return nil }
      maskingKey = Array(receiveBuffer[offset..<(offset + 4)])
      offset += 4
    }

    guard receiveBuffer.count >= offset + payloadLength else { return nil }
    var payload = Data(receiveBuffer[offset..<(offset + payloadLength)])
    receiveBuffer.removeSubrange(0..<(offset + payloadLength))

    if masked {
      payload = Data(payload.enumerated().map { index, byte in
        byte ^ maskingKey[index % 4]
      })
    }

    return (opcode: bytes[0] & 0x0F, payload: payload)
  }

  private nonisolated func send(opcode: UInt8, payload: Data) {
    guard !isClosed else { return }
    var frame = Data()
    frame.append(0x80 | opcode)
    if payload.count < 126 {
      frame.append(UInt8(payload.count))
    } else if payload.count <= Int(UInt16.max) {
      frame.append(126)
      var length = UInt16(payload.count).bigEndian
      withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    } else {
      frame.append(127)
      var length = UInt64(payload.count).bigEndian
      withUnsafeBytes(of: &length) { frame.append(contentsOf: $0) }
    }
    frame.append(payload)
    connection.send(content: frame, completion: .contentProcessed { _ in })
  }
}

actor ShareServerNativeServer {
  private let bridge: ShareServerBridge
  private let port: Int
  private let webRoot: URL

  private var listener: NWListener?
  private var controlClients: [UUID: ShareWebSocketConnection] = [:]
  private var ptySessions: [UUID: (websocket: ShareWebSocketConnection, session: ShareServerZMXSession)] = [:]

  init(
    port: Int,
    webRoot: URL,
    bridge: ShareServerBridge
  ) {
    self.port = port
    self.webRoot = webRoot
    self.bridge = bridge
  }

  func start() throws {
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    let listener = try NWListener(using: parameters, on: NWEndpoint.Port(rawValue: UInt16(port))!)
    listener.newConnectionHandler = { [weak self] connection in
      Task { await self?.accept(connection: connection) }
    }
    listener.stateUpdateHandler = { state in
      if case .failed(let error) = state {
        print("ShareServerNativeServer failed:", error)
      }
    }
    self.listener = listener
    listener.start(queue: .global(qos: .userInitiated))
  }

  func stop() {
    for (_, client) in controlClients {
      client.close()
    }
    controlClients.removeAll()
    for (_, binding) in ptySessions {
      binding.session.close(detach: true)
      binding.websocket.close()
    }
    ptySessions.removeAll()
    listener?.cancel()
    listener = nil
  }

  private func unregisterControlClient(_ clientID: UUID) {
    controlClients.removeValue(forKey: clientID)
  }

  private func forwardBinaryToPty(_ data: Data, paneID: UUID) {
    try? ptySessions[paneID]?.session.sendInput(data)
  }

  func broadcastSync(_ state: ShareWorkspaceState) {
    guard let data = try? JSONEncoder().encode(ShareSyncMessage(state: state)),
      let text = String(data: data, encoding: .utf8)
    else {
      return
    }
    for client in controlClients.values {
      client.sendText(text)
    }
  }

  private func accept(connection: NWConnection) async {
    connection.start(queue: .global(qos: .userInitiated))
    do {
      let request = try await Self.readHTTPRequest(connection: connection)
      switch request.path {
      case "/api/health":
        try await writeHealthResponse(on: connection)
      case "/control":
        try await upgradeControl(connection: connection, request: request)
      default:
        if request.path.hasPrefix("/pty/") {
          try await upgradePty(connection: connection, request: request)
        } else {
          try await serveStatic(request: request, on: connection)
        }
      }
    } catch {
      connection.cancel()
    }
  }

  private func writeHealthResponse(on connection: NWConnection) async throws {
    struct HealthPayload: Codable {
      var ok: Bool
    }
    let body = try JSONEncoder().encode(HealthPayload(ok: true))
    let headers = [
      "HTTP/1.1 200 OK",
      "Content-Type: application/json",
      "Content-Length: \(body.count)",
      "Connection: close",
      "",
      "",
    ].joined(separator: "\r\n")
    try await Self.send(data: Data(headers.utf8) + body, on: connection)
    connection.cancel()
  }

  private func serveStatic(request: HTTPRequest, on connection: NWConnection) async throws {
    let relativePath = request.path == "/" ? "/index.html" : request.path
    let fileURL = webRoot.appendingPathComponent(String(relativePath.dropFirst()), isDirectory: false)
    let targetURL = FileManager.default.fileExists(atPath: fileURL.path)
      ? fileURL
      : webRoot.appendingPathComponent("index.html", isDirectory: false)
    let body = try Data(contentsOf: targetURL)
    let headers = [
      "HTTP/1.1 200 OK",
      "Content-Type: \(Self.contentType(for: targetURL))",
      "Content-Length: \(body.count)",
      "Connection: close",
      "",
      "",
    ].joined(separator: "\r\n")
    try await Self.send(data: Data(headers.utf8) + body, on: connection)
    connection.cancel()
  }

  private func upgradeControl(connection: NWConnection, request: HTTPRequest) async throws {
    let websocket = try await Self.upgradeWebSocket(connection: connection, request: request)
    let clientID = UUID()
    controlClients[clientID] = websocket
    websocket.sendText(String(data: try JSONEncoder().encode(ShareSyncMessage(state: await bridge.snapshot())), encoding: .utf8)!)
    websocket.start(
      onText: { [weak self] text in
        Task {
          await self?.handleControlText(text, clientID: clientID)
        }
      },
      onBinary: { _ in },
      onClose: { [weak self] in
        Task {
          await self?.unregisterControlClient(clientID)
        }
      }
    )
  }

  private func upgradePty(connection: NWConnection, request: HTTPRequest) async throws {
    let paneIDString = String(request.path.dropFirst("/pty/".count))
    guard let paneID = UUID(uuidString: paneIDString), let runtime = await bridge.paneRuntime(paneID) else {
      throw ShareServerNativeError.paneNotFound
    }
    let websocket = try await Self.upgradeWebSocket(connection: connection, request: request)
    let zmxSession = try ShareServerZMXSession(
      sessionName: runtime.sessionName,
      cols: runtime.cols,
      rows: runtime.rows
    )
    ptySessions[paneID] = (websocket, zmxSession)
    zmxSession.start(
      onRenderablePayload: { payload in
        websocket.sendBinary(payload)
      },
      onClosed: { [weak self] in
        Task {
          await self?.removePtySession(for: paneID)
        }
      }
    )
    websocket.start(
      onText: { [weak self] text in
        Task {
          await self?.handlePtyText(text, paneID: paneID)
        }
      },
      onBinary: { [weak self] data in
        Task {
          await self?.forwardBinaryToPty(data, paneID: paneID)
        }
      },
      onClose: { [weak self] in
        Task {
          await self?.removePtySession(for: paneID)
        }
      }
    )
  }

  private func removePtySession(for paneID: UUID) {
    guard let binding = ptySessions.removeValue(forKey: paneID) else { return }
    binding.session.close(detach: true)
    binding.websocket.close()
  }

  private func handleControlText(_ text: String, clientID: UUID) async {
    guard let data = text.data(using: .utf8) else { return }
    do {
      let message = try ShareClientMessage(data: data)
      switch message {
      case .sync, .resume:
        if let client = controlClients[clientID],
          let body = try? JSONEncoder().encode(ShareSyncMessage(state: await bridge.snapshot())),
          let text = String(data: body, encoding: .utf8)
        {
          client.sendText(text)
        }
      case .resizePane(let paneID, let cols, let rows):
        try await bridge.resizePane(paneID, cols, rows)
      default:
        try await bridge.handleMessage(message)
      }
      let snapshot = await bridge.snapshot()
      broadcastSync(snapshot)
    } catch {
      if let client = controlClients[clientID],
        let body = try? JSONEncoder().encode(
          ShareErrorMessage(
            code: "command_failed",
            message: error.localizedDescription
          )
        ),
        let text = String(data: body, encoding: .utf8)
      {
        client.sendText(text)
      }
    }
  }

  private func handlePtyText(_ text: String, paneID: UUID) async {
    guard let binding = ptySessions[paneID] else { return }
    if let data = text.data(using: .utf8),
      let value = try? JSONDecoder().decode(JSONValue.self, from: data),
      case .object(let object) = value,
      let type = object["type"]?.stringValue
    {
      switch type {
      case "input":
        if let input = object["data"]?.stringValue {
          try? binding.session.sendInput(Data(input.utf8))
          return
        }
      case "resize":
        if let cols = object["cols"]?.intValue, let rows = object["rows"]?.intValue {
          try? binding.session.sendResize(cols: cols, rows: rows)
          return
        }
      default:
        break
      }
    }
    try? binding.session.sendInput(Data(text.utf8))
  }

  private static func upgradeWebSocket(
    connection: NWConnection,
    request: HTTPRequest
  ) async throws -> ShareWebSocketConnection {
    guard let webSocketKey = request.headers["sec-websocket-key"] else {
      throw ShareServerNativeError.unauthorized
    }
    let accept = Data(Insecure.SHA1.hash(data: Data((webSocketKey + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").utf8))).base64EncodedString()
    let response = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Accept: \(accept)",
      "",
      "",
    ].joined(separator: "\r\n")
    try await send(data: Data(response.utf8), on: connection)
    return ShareWebSocketConnection(connection: connection)
  }

  private struct HTTPRequest {
    var path: String
    var query: [String: String]
    var headers: [String: String]
  }

  private static func readHTTPRequest(connection: NWConnection) async throws -> HTTPRequest {
    var buffer = Data()
    while true {
      let data = try await receive(connection: connection)
      guard let data else { throw ShareServerNativeError.listenerFailed("Connection closed.") }
      buffer.append(data)
      if let delimiterRange = buffer.range(of: Data("\r\n\r\n".utf8)) {
        let headerData = buffer.subdata(in: 0..<delimiterRange.lowerBound)
        guard let headerString = String(data: headerData, encoding: .utf8) else {
          throw ShareServerNativeError.listenerFailed("Invalid request headers.")
        }
        let lines = headerString.components(separatedBy: "\r\n")
        guard let requestLine = lines.first else {
          throw ShareServerNativeError.listenerFailed("Invalid request line.")
        }
        let parts = requestLine.split(separator: " ")
        guard parts.count >= 2 else {
          throw ShareServerNativeError.listenerFailed("Invalid request line.")
        }
        let url = URL(string: "http://localhost" + String(parts[1]))!
        var headers: [String: String] = [:]
        for line in lines.dropFirst() {
          let pieces = line.split(separator: ":", maxSplits: 1)
          guard pieces.count == 2 else { continue }
          headers[String(pieces[0]).lowercased()] = String(pieces[1]).trimmingCharacters(in: .whitespaces)
        }
        var query: [String: String] = [:]
        URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.forEach {
          query[$0.name] = $0.value ?? ""
        }
        return HTTPRequest(path: url.path, query: query, headers: headers)
      }
    }
  }

  private static func receive(connection: NWConnection) async throws -> Data? {
    try await withCheckedThrowingContinuation { continuation in
      connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { data, _, isComplete, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        if let data, !data.isEmpty {
          continuation.resume(returning: data)
          return
        }
        if isComplete {
          continuation.resume(returning: nil)
          return
        }
        continuation.resume(returning: Data())
      }
    }
  }

  private static func send(data: Data, on connection: NWConnection) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      connection.send(content: data, completion: .contentProcessed { error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      })
    }
  }

  private static func contentType(for url: URL) -> String {
    switch url.pathExtension {
    case "html":
      return "text/html; charset=utf-8"
    case "js":
      return "application/javascript; charset=utf-8"
    case "css":
      return "text/css; charset=utf-8"
    case "svg":
      return "image/svg+xml"
    case "json":
      return "application/json; charset=utf-8"
    case "woff2":
      return "font/woff2"
    default:
      return "application/octet-stream"
    }
  }
}
