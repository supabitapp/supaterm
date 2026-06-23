import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketPathTests {
  @Test
  func managedDirectoryURLPrefersXDGThenTMPDIRThenTmp() {
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "/run/user/501",
          "TMPDIR": "/tmp/ignored",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/run/user/501", isDirectory: true)
        .appendingPathComponent("supaterm", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "TMPDIR": "/tmp/SupatermTests"
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [:],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )
  }

  @Test
  func managedDirectoryURLIgnoresBlankEnvironmentValuesAndTrailingSlashes() {
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "   ",
          "TMPDIR": "/tmp/SupatermTests///",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": "   ",
          "TMPDIR": "   ",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )
  }

  @Test
  func managedDirectoryURLSkipsEnvironmentRootsThatCannotFitSocketPath() {
    let longRoot = "/private/tmp/" + String(repeating: "x", count: darwinSocketPathByteLimit())
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          "XDG_RUNTIME_DIR": longRoot,
          "TMPDIR": "/tmp/SupatermTests",
        ],
        userID: 501
      )
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )

    let socketPath = SupatermSocketPath.managedSocketURL(
      instanceName: "dev",
      processID: 90374,
      environment: [
        "TMPDIR": longRoot
      ],
      userID: 501
    ).path

    #expect(socketPath.hasPrefix("/private/tmp/supaterm-501/"))
    #expect(socketPath.utf8.count < darwinSocketPathByteLimit())
  }

  @Test
  func managedSocketURLFitsDarwinSocketLimit() {
    let path = SupatermSocketPath.managedSocketURL(
      instanceName: String(repeating: "very-long-instance-name", count: 12),
      processID: 99,
      userID: 501
    ).path

    #expect(path.utf8.count < darwinSocketPathByteLimit())
    #expect(URL(fileURLWithPath: path).lastPathComponent.hasSuffix("-pid-99"))
  }

  @Test
  func managedSocketURLTruncatesAgainstSunPathLimit() {
    let rootPrefix = "/private/tmp/"
    let rootByteCount =
      darwinSocketPathByteLimit()
      - "/supaterm-501".utf8.count
      - "instance-0123456789abcdef-pid-99".utf8.count
      - 8
    let rootDirectory = URL(
      fileURLWithPath: rootPrefix
        + String(repeating: "x", count: rootByteCount - rootPrefix.utf8.count),
      isDirectory: true
    )
    let path = SupatermSocketPath.managedSocketURL(
      instanceName: String(repeating: "very-long-instance-name", count: 12),
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
      userID: 501
    ).path

    #expect(path.utf8.count < darwinSocketPathByteLimit())
    #expect(URL(fileURLWithPath: path).lastPathComponent.hasSuffix("-pid-99"))
  }

  @Test
  func managedSocketURLUsesOverrideAsTempStyleRoot() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)
    let socketURL = SupatermSocketPath.managedSocketURL(
      instanceName: "main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [
        "XDG_RUNTIME_DIR": "/run/user/501",
        "TMPDIR": "/tmp/ignored",
      ],
      userID: 501
    )

    #expect(
      socketURL.deletingLastPathComponent()
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent("supaterm-501", isDirectory: true)
    )
    #expect(socketURL.lastPathComponent.hasPrefix("instance-main-"))
  }

  @Test
  func managedSocketURLUsesStableHashDisambiguatedInstanceName() {
    let rootDirectory = URL(fileURLWithPath: "/tmp/SupatermTests", isDirectory: true)
    let first = SupatermSocketPath.managedSocketURL(
      instanceName: "dev/main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
      userID: 501
    )
    let second = SupatermSocketPath.managedSocketURL(
      instanceName: "dev/main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
      userID: 501
    )
    let collidingStem = SupatermSocketPath.managedSocketURL(
      instanceName: "dev-main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
      userID: 501
    )

    #expect(first == second)
    #expect(first != collidingStem)
    #expect(first.lastPathComponent.hasPrefix("instance-dev-main-"))
    #expect(collidingStem.lastPathComponent.hasPrefix("instance-dev-main-"))
  }

  @Test
  func canonicalizedResolvesSymlinkedPaths() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let actualURL = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkURL = rootURL.appendingPathComponent("link", isDirectory: true)
    try FileManager.default.createDirectory(at: actualURL, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: actualURL)

    #expect(
      SupatermSocketPath.canonicalized(
        symlinkURL.appendingPathComponent("control.sock", isDirectory: false).path
      ) == actualURL.appendingPathComponent("control.sock", isDirectory: false).path
    )
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        rootDirectory: symlinkURL,
        environment: [:],
        userID: 501
      ) == actualURL.appendingPathComponent("supaterm-501", isDirectory: true)
    )
  }

  @Test
  func socketEndpointDisplayStringIncludesShortIDPidAndPath() {
    let endpoint = socketEndpoint(
      id: UUID(uuidString: "FC905729-0A5F-4D1D-8077-5E0E90529B86")!,
      name: "main",
      path: "/tmp/main.sock",
      pid: 77,
      startedAt: 3
    )

    #expect(endpoint.displayString == "main [FC905729] pid 77 socket /tmp/main.sock")
  }

  @Test
  func explicitPathResolutionPrefersExplicitPathThenEnvironment() {
    let environmentPath = "/tmp/supaterm.environment.sock"
    let explicitPath = "/tmp/supaterm.explicit.sock"

    #expect(
      SupatermSocketPath.resolveExplicitPath(
        explicitPath: explicitPath,
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath]
      ) == explicitPath
    )
    #expect(
      SupatermSocketPath.resolveExplicitPath(
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath]
      ) == environmentPath
    )
    #expect(SupatermSocketPath.resolveExplicitPath(environment: [:]) == nil)
  }

  @Test
  func processSocketEndpointUsesEnvironmentSelectedManagedPathAndInstanceName() {
    let endpointID = UUID(uuidString: "C46492BD-5A6E-4C73-8D0F-71AFBA7EF1DE")!
    let startedAt = Date(timeIntervalSince1970: 123)
    let environment = [
      "XDG_RUNTIME_DIR": "/run/user/501",
      SupatermCLIEnvironment.instanceNameKey: "dev",
    ]

    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: endpointID,
      processID: 99,
      startedAt: startedAt,
      userID: 501
    )

    #expect(
      endpoint
        == SupatermSocketEndpoint(
          id: endpointID,
          name: "dev",
          path: SupatermSocketPath.managedSocketURL(
            instanceName: "dev",
            processID: 99,
            environment: environment,
            userID: 501
          ).path,
          pid: 99,
          startedAt: startedAt
        )
    )
  }

  @Test
  func processSocketEndpointIgnoresInheritedSocketPath() {
    let endpointID = UUID(uuidString: "0DC934AE-CE34-4B47-B968-B70E0A1E8733")!
    let environment = [
      "TMPDIR": "/tmp/SupatermTests",
      SupatermCLIEnvironment.socketPathKey: "/tmp/override.sock",
      SupatermCLIEnvironment.instanceNameKey: "named",
    ]
    let endpoint = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: endpointID,
      processID: 7,
      startedAt: Date(timeIntervalSince1970: 456),
      userID: 501
    )

    #expect(
      endpoint?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "named",
          processID: 7,
          environment: environment,
          userID: 501
        ).path
    )
    #expect(endpoint?.name == "named")
  }

  @Test
  func processSocketEndpointPathDependsOnInstanceNameAndProcessID() {
    let environment = ["TMPDIR": "/tmp/SupatermTests", SupatermCLIEnvironment.instanceNameKey: "dev"]
    let first = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!,
      processID: 42,
      startedAt: Date(timeIntervalSince1970: 0),
      userID: 501
    )
    let second = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
      processID: 43,
      startedAt: Date(timeIntervalSince1970: 1),
      userID: 501
    )

    #expect(first?.path != second?.path)
    #expect(
      first?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "dev",
          processID: 42,
          environment: environment,
          userID: 501
        ).path
    )
    #expect(
      second?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "dev",
          processID: 43,
          environment: environment,
          userID: 501
        ).path
    )
  }

  @Test
  func isManagedSocketPathRecognizesXdgAndTempLayouts() {
    #expect(
      SupatermSocketPath.isManagedSocketPath(
        "/run/user/501/supaterm/control.sock",
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
        userID: 501
      )
    )
    #expect(
      SupatermSocketPath.isManagedSocketPath(
        "/private/tmp/SupatermTests/supaterm-501/control.sock",
        environment: ["TMPDIR": "/tmp/SupatermTests"],
        userID: 501
      )
    )
    #expect(
      !SupatermSocketPath.isManagedSocketPath(
        "/run/user/501/not-supaterm/control.sock",
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
        userID: 501
      )
    )
  }

  @Test
  func discoverManagedSocketPathsUsesEnvironmentSelectedDirectory() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgRuntimeDirectory = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let xdgManagedDirectory = xdgRuntimeDirectory.appendingPathComponent(
      "supaterm", isDirectory: true)
    let tmpDirectory = rootURL.appendingPathComponent("tmp", isDirectory: true)
    let tmpManagedDirectory =
      tmpDirectory
      .appendingPathComponent("supaterm-\(getuid())", isDirectory: true)
    try FileManager.default.createDirectory(
      at: xdgManagedDirectory, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(
      at: tmpManagedDirectory, withIntermediateDirectories: true)

    let xdgSocketURL = xdgManagedDirectory.appendingPathComponent("xdg.sock", isDirectory: false)
    let tmpSocketURL = tmpManagedDirectory.appendingPathComponent("tmp.sock", isDirectory: false)
    try createSocketNode(at: xdgSocketURL)
    try createSocketNode(at: tmpSocketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: [
          "XDG_RUNTIME_DIR": xdgRuntimeDirectory.path,
          "TMPDIR": tmpDirectory.path,
        ]
      ) == [xdgSocketURL.path]
    )
    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: ["TMPDIR": tmpDirectory.path]
      ) == [tmpSocketURL.path]
    )
  }

  @Test
  func discoverManagedSocketPathsCanonicalizesSymlinkedTmpDirectory() throws {
    let rootURL = try makeSocketProtocolTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let actualDirectory = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkDirectory = rootURL.appendingPathComponent("link", isDirectory: true)
    let managedDirectory =
      actualDirectory
      .appendingPathComponent("supaterm-\(getuid())", isDirectory: true)
    try FileManager.default.createDirectory(at: managedDirectory, withIntermediateDirectories: true)
    try FileManager.default.createSymbolicLink(
      at: symlinkDirectory, withDestinationURL: actualDirectory)

    let socketURL = managedDirectory.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: ["TMPDIR": symlinkDirectory.path]
      ) == [socketURL.path]
    )
  }

  @Test
  func socketTargetResolverHonorsPrecedenceAndAmbiguity() throws {
    let alpha = socketEndpoint(
      id: UUID(uuidString: "86DB92A0-7F32-4493-9217-F0B29D81B39C")!,
      name: "alpha",
      path: "/tmp/alpha.sock",
      pid: 1,
      startedAt: 2
    )
    let beta = socketEndpoint(
      id: UUID(uuidString: "4B337D2A-99A2-4FB2-BB72-C3C3A2AB62D2")!,
      name: "beta",
      path: "/tmp/beta.sock",
      pid: 2,
      startedAt: 1
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: "/tmp/explicit.sock",
        environmentPath: "/tmp/environment.sock",
        instance: "alpha",
        discoveredEndpoints: [alpha, beta]
      ) == SupatermResolvedSocketTarget(path: "/tmp/explicit.sock", source: .explicitPath)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: "/tmp/environment.sock",
        instance: "alpha",
        discoveredEndpoints: [alpha, beta]
      ) == SupatermResolvedSocketTarget(path: "/tmp/environment.sock", source: .environmentPath)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: alpha.id.uuidString,
        discoveredEndpoints: [alpha, beta]
      ) == SupatermResolvedSocketTarget(path: alpha.path, source: .explicitInstance)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: "beta",
        discoveredEndpoints: [alpha, beta]
      ) == SupatermResolvedSocketTarget(path: beta.path, source: .explicitInstance)
    )

    #expect(
      try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: alpha.id.uuidString.lowercased(),
        discoveredEndpoints: [alpha, beta]
      ) == SupatermResolvedSocketTarget(path: alpha.path, source: .explicitInstance)
    )

    do {
      _ = try SupatermSocketTargetResolver.resolve(
        explicitPath: nil,
        environmentPath: nil,
        instance: nil,
        discoveredEndpoints: [alpha, beta]
      )
      Issue.record("Expected ambiguous discovered instances.")
    } catch let error as SupatermSocketSelectionError {
      #expect(error == .ambiguousDiscoveredInstances([alpha, beta]))
    }
  }

  @Test
  func managedSocketDiscoveryRemovesOnlyStalePathsAndSortsEndpoints() {
    let older = socketEndpoint(
      id: UUID(uuidString: "99E743B9-198E-4109-A8D3-5DF618FF56AB")!,
      name: "older",
      path: "/tmp/older.sock",
      pid: 1,
      startedAt: 1
    )
    let newer = socketEndpoint(
      id: UUID(uuidString: "F20D93D7-D7E0-4667-A695-98620E4686C9")!,
      name: "newer",
      path: "/tmp/newer.sock",
      pid: 2,
      startedAt: 2
    )
    var removed: [String] = []

    let discovery = SupatermManagedSocketDiscovery.discover(
      candidatePaths: [older.path, "/tmp/ignored.sock", "/tmp/stale.sock", newer.path],
      probe: { path in
        switch path {
        case older.path:
          return .reachable(older)
        case newer.path:
          return .reachable(newer)
        case "/tmp/ignored.sock":
          return .ignored
        default:
          return .stale
        }
      },
      removeStalePath: { path in
        removed.append(path)
      }
    )

    #expect(discovery.reachableEndpoints == [newer, older])
    #expect(discovery.removedStalePaths == ["/tmp/stale.sock"])
    #expect(removed == ["/tmp/stale.sock"])
  }

}

private func socketEndpoint(
  id: UUID,
  name: String,
  path: String,
  pid: Int32,
  startedAt: TimeInterval
) -> SupatermSocketEndpoint {
  SupatermSocketEndpoint(
    id: id,
    name: name,
    path: path,
    pid: pid,
    startedAt: Date(timeIntervalSince1970: startedAt)
  )
}

private func makeSocketProtocolTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func darwinSocketPathByteLimit() -> Int {
  let address = sockaddr_un()
  return MemoryLayout.size(ofValue: address.sun_path)
}

private func createSocketNode(at url: URL) throws {
  _ = url.path.withCString(unlink)

  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  defer { Darwin.close(socketDescriptor) }

  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

  let path = url.path
  let maxLength = MemoryLayout.size(ofValue: address.sun_path)
  guard path.utf8.count < maxLength else {
    throw POSIXError(.ENAMETOOLONG)
  }

  path.withCString { pointer in
    withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
      let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
      strncpy(buffer, pointer, maxLength - 1)
    }
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
