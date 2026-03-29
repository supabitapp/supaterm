import Darwin
import Foundation
import OSLog

actor ShareServerRuntime {
  static let shared = ShareServerRuntime()
  private static let logger = Logger(subsystem: "app.supabit.supaterm", category: "ShareServer")

  private let listenAddress = "0.0.0.0"
  private let defaultPort = 7681
  private var continuations: [UUID: AsyncStream<ShareServerSnapshot>.Continuation] = [:]
  private var snapshot = ShareServerSnapshot()
  private var currentPort: Int?
  private var server: ShareServerNativeServer?
  private var observationTask: Task<Void, Never>?
  private var bridge: ShareServerBridge?

  func observe() -> AsyncStream<ShareServerSnapshot> {
    let id = UUID()
    return AsyncStream { continuation in
      continuations[id] = continuation
      continuation.yield(snapshot)
      continuation.onTermination = { [weak self] _ in
        Task {
          await self?.removeContinuation(id: id)
        }
      }
    }
  }

  func start(port: Int) async {
    guard let bridge else {
      publish(.failed(message: "Native share bridge is not configured."))
      return
    }
    await start(port: port, bridge: bridge)
  }

  func start(port: Int, bridge: ShareServerBridge) async {
    if case .running(let connection) = snapshot.phase, connection.port == port {
      return
    }

    await stop()
    self.bridge = bridge

    guard let webDist = webDistPath() else {
      publish(.failed(message: "Missing bundled web assets."))
      return
    }

    currentPort = port
    publish(.starting(port: port))

    do {
      let server = ShareServerNativeServer(
        port: port,
        webRoot: URL(fileURLWithPath: webDist, isDirectory: true),
        bridge: bridge
      )
      try await server.start()
      self.server = server
      publish(
        .running(
          ShareServerConnection(
            listenAddress: listenAddress,
            port: port,
            accessURLs: accessURLs(port: port)
          )
        )
      )
      startObservationLoop(server: server, bridge: bridge)
    } catch {
      Self.logger.error("native share start failed: \(error.localizedDescription, privacy: .public)")
      publish(.failed(message: error.localizedDescription))
    }
  }

  func stop() async {
    observationTask?.cancel()
    observationTask = nil
    await server?.stop()
    server = nil
    currentPort = nil
    publish(.stopped)
  }

  private func startObservationLoop(server: ShareServerNativeServer, bridge: ShareServerBridge) {
    observationTask?.cancel()
    observationTask = Task {
      var lastSnapshot = await bridge.snapshot()
      await server.broadcastSync(lastSnapshot)
      while !Task.isCancelled {
        try? await Task.sleep(for: .milliseconds(200))
        let nextSnapshot = await bridge.snapshot()
        guard nextSnapshot != lastSnapshot else { continue }
        lastSnapshot = nextSnapshot
        await server.broadcastSync(nextSnapshot)
      }
    }
  }

  private func accessURLs(port: Int) -> [ShareServerAccessURL] {
    var urls: [ShareServerAccessURL] = [
      .init(
        label: "Local",
        urlString: shareURL(host: "127.0.0.1", port: port)
      )
    ]

    for address in localNetworkAddresses() {
      urls.append(
        .init(
          label: address,
          urlString: shareURL(host: address, port: port)
        )
      )
    }

    return urls
  }

  private func shareURL(host: String, port: Int) -> String {
    "http://\(host):\(port)/"
  }

  private func publish(_ phase: ShareServerPhase) {
    snapshot = ShareServerSnapshot(phase: phase)
    for continuation in continuations.values {
      continuation.yield(snapshot)
    }
  }

  private func removeContinuation(id: UUID) {
    continuations.removeValue(forKey: id)
  }

  private func webDistPath() -> String? {
    if let resourceURL = Bundle.main.resourceURL {
      let bundled = resourceURL.appendingPathComponent("web", isDirectory: true)
      let index = bundled.appendingPathComponent("index.html", isDirectory: false)
      if FileManager.default.fileExists(atPath: index.path) {
        return bundled.path
      }
    }

    guard
      let localDist = localCheckoutPath(
        components: ["packages", "web", "dist", "index.html"],
        exists: { FileManager.default.fileExists(atPath: $0.path) }
      )
    else {
      return nil
    }

    return URL(fileURLWithPath: localDist, isDirectory: false).deletingLastPathComponent().path
  }

  private func localCheckoutPath(
    components: [String],
    exists: (URL) -> Bool
  ) -> String? {
    for root in localCheckoutSearchRoots() {
      var candidateRoot = root.standardizedFileURL
      while true {
        let candidate = components.reduce(candidateRoot) { partialResult, component in
          partialResult.appendingPathComponent(component, isDirectory: false)
        }
        if exists(candidate) {
          return candidate.path
        }

        let parent = candidateRoot.deletingLastPathComponent()
        if parent.path == candidateRoot.path {
          break
        }
        candidateRoot = parent
      }
    }

    return nil
  }

  private func localCheckoutSearchRoots() -> [URL] {
    [
      URL(fileURLWithPath: FileManager.default.currentDirectoryPath, isDirectory: true),
      Bundle.main.bundleURL,
    ]
  }

  private func localNetworkAddresses() -> [String] {
    var addresses: [String] = []
    var pointer: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&pointer) == 0, let first = pointer else {
      return []
    }
    defer { freeifaddrs(pointer) }

    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let interface = cursor {
      defer { cursor = interface.pointee.ifa_next }
      let flags = Int32(interface.pointee.ifa_flags)
      let isUp = (flags & IFF_UP) != 0
      let isLoopback = (flags & IFF_LOOPBACK) != 0
      guard isUp, !isLoopback else { continue }
      guard let address = interface.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else {
        continue
      }

      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      let length = socklen_t(address.pointee.sa_len)
      if getnameinfo(address, length, &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        let value = String(decoding: host.prefix { $0 != 0 }.map(UInt8.init(bitPattern:)), as: UTF8.self)
        if !value.isEmpty, !addresses.contains(value) {
          addresses.append(value)
        }
      }
    }

    return addresses.sorted()
  }
}
