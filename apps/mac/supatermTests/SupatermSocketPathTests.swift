import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketPathTests {
  @Test
  func managedDirectoryURLUsesDarwinUserTemporaryDirectory() throws {
    let expected = try darwinUserTemporaryDirectoryURL()
      .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)
    let appEnvironment = [
      "XDG_RUNTIME_DIR": "/run/app/501",
      "TMPDIR": "/tmp/app",
    ]
    let hostEnvironment = [
      "XDG_RUNTIME_DIR": "/run/host/501",
      "TMPDIR": "/tmp/host",
    ]

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: appEnvironment,
      ) == expected
    )
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: hostEnvironment,
      ) == expected
    )
  }

  @Test
  func managedDirectoryURLRequiresTestHomeForTestSocketRoot() throws {
    let productionURL = try darwinUserTemporaryDirectoryURL()
      .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)
    let testURL = URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
      .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)

    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          SupatermCLIEnvironment.testSocketRootKey: "/tmp/SupatermTests"
        ],
      ) == productionURL
    )
    #expect(
      SupatermSocketPath.managedDirectoryURL(
        environment: [
          SupatermCLIEnvironment.testHomeKey: "/tmp/test-home",
          SupatermCLIEnvironment.testSocketRootKey: "/tmp/SupatermTests",
        ],
      ) == testURL
    )
  }

  @Test
  func managedSocketURLHandlesOverlongInjectedRoots() {
    let longRoot = "/private/tmp/" + String(repeating: "x", count: darwinSocketPathByteLimit())
    let explicitRootPath = SupatermSocketPath.managedSocketURL(
      instanceName: "dev",
      processID: 90374,
      rootDirectory: URL(fileURLWithPath: longRoot, isDirectory: true),
    ).path
    let testRootPath = SupatermSocketPath.managedSocketURL(
      instanceName: "dev",
      processID: 90374,
      environment: [
        SupatermCLIEnvironment.testHomeKey: "/tmp/test-home",
        SupatermCLIEnvironment.testSocketRootKey: longRoot,
      ],
    ).path

    #expect(URL(fileURLWithPath: explicitRootPath).lastPathComponent.hasSuffix("-pid-90374"))
    #expect(URL(fileURLWithPath: testRootPath).lastPathComponent.hasSuffix("-pid-90374"))
  }

  @Test
  func managedSocketURLFitsDarwinSocketLimit() {
    let path = SupatermSocketPath.managedSocketURL(
      instanceName: String(repeating: "very-long-instance-name", count: 12),
      processID: Int32.max,
    ).path

    #expect(path.utf8.count < darwinSocketPathByteLimit())
    #expect(URL(fileURLWithPath: path).lastPathComponent.hasSuffix("-pid-\(Int32.max)"))
  }

  @Test
  func managedSocketURLTruncatesAgainstSunPathLimit() {
    let rootPrefix = "/private/tmp/"
    let rootByteCount =
      darwinSocketPathByteLimit()
      - "/supaterm".utf8.count
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
    )

    #expect(
      socketURL.deletingLastPathComponent()
        == URL(fileURLWithPath: "/private/tmp/SupatermTests", isDirectory: true)
        .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)
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
    )
    let second = SupatermSocketPath.managedSocketURL(
      instanceName: "dev/main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
    )
    let collidingStem = SupatermSocketPath.managedSocketURL(
      instanceName: "dev-main",
      processID: 99,
      rootDirectory: rootDirectory,
      environment: [:],
    )

    #expect(first == second)
    #expect(first != collidingStem)
    #expect(first.lastPathComponent.hasPrefix("instance-dev-main-"))
    #expect(collidingStem.lastPathComponent.hasPrefix("instance-dev-main-"))
  }

  @Test
  func canonicalizedResolvesSymlinkedPaths() throws {
    let rootURL = try makeSocketPathTemporaryDirectory()
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
      )
        == actualURL.appendingPathComponent(
          SupatermSocketPath.managedDirectoryName,
          isDirectory: true
        )
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
  func processSocketEndpointUsesManagedPathAndInstanceName() throws {
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
          ).path,
          pid: 99,
          startedAt: startedAt
        )
    )
    #expect(
      endpoint?.path.hasPrefix(
        try darwinUserTemporaryDirectoryURL()
          .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)
          .path + "/"
      ) == true
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
    )

    #expect(
      endpoint?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "named",
          processID: 7,
          environment: environment,
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
    )
    let second = SupatermProcessSocketEndpoint.make(
      environment: environment,
      endpointID: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!,
      processID: 43,
      startedAt: Date(timeIntervalSince1970: 1),
    )

    #expect(first?.path != second?.path)
    #expect(
      first?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "dev",
          processID: 42,
          environment: environment,
        ).path
    )
    #expect(
      second?.path
        == SupatermSocketPath.managedSocketURL(
          instanceName: "dev",
          processID: 43,
          environment: environment,
        ).path
    )
  }

  @Test
  func isManagedSocketPathRecognizesOnlyTheResolvedManagedDirectory() {
    let productionSocketPath = SupatermSocketPath.managedDirectoryURL(
      environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
    )
    .appendingPathComponent("control.sock", isDirectory: false)
    .path

    #expect(
      SupatermSocketPath.isManagedSocketPath(
        productionSocketPath,
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
      )
    )
    #expect(
      SupatermSocketPath.isManagedSocketPath(
        "/private/tmp/SupatermTests/supaterm/control.sock",
        environment: [
          SupatermCLIEnvironment.testHomeKey: "/tmp/test-home",
          SupatermCLIEnvironment.testSocketRootKey: "/tmp/SupatermTests",
        ],
      )
    )
    #expect(
      !SupatermSocketPath.isManagedSocketPath(
        "/run/user/501/supaterm/control.sock",
        environment: ["XDG_RUNTIME_DIR": "/run/user/501"],
      )
    )
  }

  @Test
  func discoverManagedSocketPathsIgnoresConflictingRuntimeEnvironment() throws {
    let rootURL = try makeSocketPathTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(
      environment: [
        SupatermCLIEnvironment.testHomeKey: "/tmp/app-home",
        SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
      ]
    )
    try createPrivateSocketDirectory(at: managedDirectoryURL)
    let socketURL = managedDirectoryURL.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: [
          "XDG_RUNTIME_DIR": rootURL.appendingPathComponent("app-xdg").path,
          "TMPDIR": rootURL.appendingPathComponent("app-tmp").path,
          SupatermCLIEnvironment.testHomeKey: "/tmp/app-home",
          SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
        ]
      ) == [socketURL.path]
    )
    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        environment: [
          "XDG_RUNTIME_DIR": rootURL.appendingPathComponent("host-xdg").path,
          "TMPDIR": rootURL.appendingPathComponent("host-tmp").path,
          SupatermCLIEnvironment.testHomeKey: "/tmp/host-home",
          SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
        ]
      ) == [socketURL.path]
    )
  }

  @Test
  func discoverManagedSocketPathsCanonicalizesSymlinkedExplicitRoot() throws {
    let rootURL = try makeSocketPathTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let actualDirectory = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkDirectory = rootURL.appendingPathComponent("link", isDirectory: true)
    let managedDirectory =
      actualDirectory
      .appendingPathComponent(SupatermSocketPath.managedDirectoryName, isDirectory: true)
    try createPrivateSocketDirectory(at: managedDirectory)
    try FileManager.default.createSymbolicLink(
      at: symlinkDirectory, withDestinationURL: actualDirectory)

    let socketURL = managedDirectory.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(
        rootDirectory: symlinkDirectory,
        environment: [:]
      ) == [socketURL.path]
    )
  }

  @Test
  func discoverManagedSocketPathsRejectsSymlinkedManagedDirectory() throws {
    let rootURL = try makeSocketPathTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let targetURL = rootURL.appendingPathComponent("target", isDirectory: true)
    try createPrivateSocketDirectory(at: targetURL)
    let socketURL = targetURL.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)
    try FileManager.default.createSymbolicLink(
      at: managedDirectoryURL,
      withDestinationURL: targetURL
    )

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(rootDirectory: rootURL).isEmpty
    )
  }

  @Test
  func discoverManagedSocketPathsRejectsSharedManagedDirectory() throws {
    let rootURL = try makeSocketPathTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let managedDirectoryURL = SupatermSocketPath.managedDirectoryURL(rootDirectory: rootURL)
    try createPrivateSocketDirectory(at: managedDirectoryURL)
    let socketURL = managedDirectoryURL.appendingPathComponent("control.sock", isDirectory: false)
    try createSocketNode(at: socketURL)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: managedDirectoryURL.path
    )

    #expect(
      SupatermSocketPath.discoverManagedSocketPaths(rootDirectory: rootURL).isEmpty
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

private func makeSocketPathTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func darwinUserTemporaryDirectoryURL() throws -> URL {
  let byteCount = confstr(_CS_DARWIN_USER_TEMP_DIR, nil, 0)
  guard byteCount > 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  var buffer = [CChar](repeating: 0, count: byteCount)
  guard confstr(_CS_DARWIN_USER_TEMP_DIR, &buffer, byteCount) > 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  guard
    let path = String(
      bytes: buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) },
      encoding: .utf8
    )
  else {
    throw POSIXError(.EILSEQ)
  }
  return URL(
    fileURLWithPath: SupatermSocketPath.canonicalized(path) ?? path,
    isDirectory: true
  )
}

private func darwinSocketPathByteLimit() -> Int {
  let address = sockaddr_un()
  return MemoryLayout.size(ofValue: address.sun_path)
}

private func createPrivateSocketDirectory(at url: URL) throws {
  try FileManager.default.createDirectory(
    at: url,
    withIntermediateDirectories: true,
    attributes: [.posixPermissions: 0o700]
  )
  guard chmod(url.path, 0o700) == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
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
