import CryptoKit
import Darwin
import Foundation

public enum SupatermInstanceIdentity {
  public static let defaultName = "default"

  public static func resolvedName(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    normalizedName(environment[SupatermCLIEnvironment.instanceNameKey])
  }

  public static func normalizedName(_ name: String?) -> String {
    SupatermSocketPath.normalized(name) ?? defaultName
  }

  public static func fileStem(for name: String) -> String {
    let allowed = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    let stem =
      name
      .unicodeScalars
      .map { allowed.contains($0) ? String($0) : "-" }
      .joined()
      .trimmingCharacters(in: CharacterSet(charactersIn: ".-_"))
    return stem.isEmpty ? defaultName : stem
  }

  public static func stableHash(for name: String, hexDigitCount: Int = 16) -> String {
    let digest = SHA256.hash(data: Data(name.utf8))
    return String(digest.map { String(format: "%02x", $0) }.joined().prefix(hexDigitCount))
  }
}

public enum SupatermSocketPath {
  public static let managedDirectoryPrefix = "supaterm-"
  private static let socketPathByteLimit: Int = {
    let address = sockaddr_un()
    return MemoryLayout.size(ofValue: address.sun_path) - 1
  }()
  private static let tmpPath = "/tmp"

  public static func managedDirectoryURL(
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid()
  ) -> URL {
    if let rootDirectory {
      return managedDirectoryURL(
        rootPath: rootDirectory.path,
        directoryName: tempManagedDirectoryName(userID: userID)
      )
    }

    if normalized(environment[SupatermCLIEnvironment.testHomeKey]) != nil,
      let testSocketRoot = normalized(environment[SupatermCLIEnvironment.testSocketRootKey])
    {
      return managedDirectoryURL(
        rootPath: testSocketRoot,
        directoryName: tempManagedDirectoryName(userID: userID)
      )
    }

    return managedDirectoryURL(
      rootPath: tmpPath,
      directoryName: tempManagedDirectoryName(userID: userID)
    )
  }

  public static func managedSocketURL(
    instanceName: String,
    processID: Int32,
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid()
  ) -> URL {
    let directoryURL = managedDirectoryURL(
      rootDirectory: rootDirectory,
      environment: environment,
      userID: userID
    )
    return directoryURL.appendingPathComponent(
      managedSocketFileName(
        forInstanceName: instanceName,
        processID: processID,
        directoryPath: directoryURL.path
      ),
      isDirectory: false
    )
  }

  public static func resolveExplicitPath(
    explicitPath: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String? {
    if let explicitPath = normalized(explicitPath) {
      return explicitPath
    }

    if let environmentPath = normalized(environment[SupatermCLIEnvironment.socketPathKey]) {
      return environmentPath
    }
    return nil
  }

  public static func discoverManagedSocketPaths(
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid(),
    fileManager: FileManager = .default
  ) -> [String] {
    let managedDirectoryURL = managedDirectoryURL(
      rootDirectory: rootDirectory,
      environment: environment,
      userID: userID
    )
    guard isPrivateDirectory(at: managedDirectoryURL.path, userID: userID) else {
      return []
    }
    guard
      let contents = try? fileManager.contentsOfDirectory(
        at: managedDirectoryURL,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
      )
    else {
      return []
    }

    return
      contents
      .filter { isOwnedSocketNode(at: $0.path, userID: userID) }
      .map { $0.path }
      .sorted()
  }

  public static func isManagedSocketPath(
    _ path: String,
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid()
  ) -> Bool {
    guard
      let canonicalPath = canonicalized(path)
    else {
      return false
    }

    let managedDirectoryURL = managedDirectoryURL(
      rootDirectory: rootDirectory,
      environment: environment,
      userID: userID
    )
    let canonicalManagedDirectoryPath =
      canonicalized(managedDirectoryURL.path) ?? managedDirectoryURL.path
    return
      URL(fileURLWithPath: canonicalPath)
      .deletingLastPathComponent()
      .path == canonicalManagedDirectoryPath
  }

  public static func isOwnedManagedSocketPath(
    _ path: String,
    rootDirectory: URL? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    userID: uid_t = getuid()
  ) -> Bool {
    let managedDirectoryURL = managedDirectoryURL(
      rootDirectory: rootDirectory,
      environment: environment,
      userID: userID
    )
    guard isPrivateDirectory(at: managedDirectoryURL.path, userID: userID) else {
      return false
    }
    guard
      isManagedSocketPath(
        path,
        rootDirectory: rootDirectory,
        environment: environment,
        userID: userID
      )
    else {
      return false
    }
    return isOwnedSocketNode(at: path, userID: userID)
  }

  public static func normalized(_ path: String?) -> String? {
    guard let path else { return nil }
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return trimmed
  }

  public static func canonicalized(_ path: String?) -> String? {
    guard let path = normalized(path) else { return nil }
    return canonicalizedExistingPrefix(of: URL(fileURLWithPath: path).standardizedFileURL.path)
  }

  static func isPrivateDirectory(at path: String, userID: uid_t) -> Bool {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }
    guard status == 0 else {
      return false
    }
    return isPrivateDirectory(fileStatus, userID: userID)
  }

  static func isPrivateDirectory(descriptor: Int32, userID: uid_t) -> Bool {
    var fileStatus = stat()
    guard fstat(descriptor, &fileStatus) == 0 else {
      return false
    }
    return isPrivateDirectory(fileStatus, userID: userID)
  }

  private static func managedDirectoryURL(
    rootPath: String,
    directoryName: String
  ) -> URL {
    return URL(
      fileURLWithPath: canonicalized(rootPath) ?? rootPath,
      isDirectory: true
    )
    .appendingPathComponent(directoryName, isDirectory: true)
  }

  private static func tempManagedDirectoryName(userID: uid_t) -> String {
    return "\(managedDirectoryPrefix)\(userID)"
  }

  private static func managedSocketFileName(
    forInstanceName instanceName: String,
    processID: Int32,
    directoryPath: String
  ) -> String {
    let normalizedInstanceName = SupatermInstanceIdentity.normalizedName(instanceName)
    let stem = SupatermInstanceIdentity.fileStem(for: normalizedInstanceName)
    let hash = SupatermInstanceIdentity.stableHash(for: normalizedInstanceName)
    let processSuffix = "-pid-\(processID)"
    let fullName = "instance-\(stem)-\(hash)\(processSuffix)"
    let maxFileNameByteCount = max(0, socketPathByteLimit - directoryPath.utf8.count - 1)
    guard fullName.utf8.count > maxFileNameByteCount else {
      return fullName
    }

    let prefix = "instance-"
    let minimumName = "\(prefix)\(hash)\(processSuffix)"
    let reservedByteCount = prefix.utf8.count + hash.utf8.count + processSuffix.utf8.count + 1
    let maxStemByteCount = maxFileNameByteCount - reservedByteCount
    guard maxStemByteCount > 0 else {
      return minimumName
    }
    return "\(prefix)\(String(stem.prefix(maxStemByteCount)))-\(hash)\(processSuffix)"
  }

  private static func isPrivateDirectory(_ fileStatus: stat, userID: uid_t) -> Bool {
    (fileStatus.st_mode & S_IFMT) == S_IFDIR
      && fileStatus.st_uid == userID
      && (fileStatus.st_mode & 0o777) == 0o700
  }

  private static func isOwnedSocketNode(at path: String, userID: uid_t) -> Bool {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }
    guard status == 0 else {
      return false
    }
    return (fileStatus.st_mode & S_IFMT) == S_IFSOCK && fileStatus.st_uid == userID
  }

  private static func canonicalizedExistingPrefix(of path: String) -> String {
    let pathComponents = (path as NSString).pathComponents
    guard !pathComponents.isEmpty else {
      return path
    }

    var resolvedPath = pathComponents.first == "/" ? "/" : ""
    var index = pathComponents.first == "/" ? 1 : 0

    while index < pathComponents.count {
      let candidatePath =
        resolvedPath == "/" || resolvedPath.isEmpty
        ? resolvedPath + pathComponents[index]
        : (resolvedPath as NSString).appendingPathComponent(pathComponents[index])
      var fileStatus = stat()
      let status = candidatePath.withCString { pointer in
        lstat(pointer, &fileStatus)
      }

      guard status == 0 else {
        let remainingPath = NSString.path(withComponents: Array(pathComponents[index...]))
        guard !remainingPath.isEmpty else {
          return resolvedPath.isEmpty ? candidatePath : resolvedPath
        }
        guard !resolvedPath.isEmpty else {
          return remainingPath
        }
        return resolvedPath == "/"
          ? resolvedPath + remainingPath
          : (resolvedPath as NSString).appendingPathComponent(remainingPath)
      }

      if (fileStatus.st_mode & S_IFMT) == S_IFLNK,
        let resolvedCandidatePath = realpathString(candidatePath)
      {
        resolvedPath = resolvedCandidatePath
      } else {
        resolvedPath = candidatePath
      }

      index += 1
    }

    return resolvedPath.isEmpty ? path : resolvedPath
  }

  private static func realpathString(_ path: String) -> String? {
    let resolvedPointer = path.withCString { pointer in
      realpath(pointer, nil)
    }
    guard let resolvedPointer else {
      return nil
    }
    defer { free(resolvedPointer) }
    return String(cString: resolvedPointer)
  }
}

public enum SupatermProcessSocketEndpoint {
  private static let cached = make(
    environment: ProcessInfo.processInfo.environment,
    processID: Int32(ProcessInfo.processInfo.processIdentifier),
    startedAt: Date()
  )

  public static func current() -> SupatermSocketEndpoint? {
    cached
  }

  public static func make(
    environment: [String: String],
    endpointID: UUID = UUID(),
    processID: Int32,
    startedAt: Date,
    rootDirectory: URL? = nil,
    userID: uid_t = getuid()
  ) -> SupatermSocketEndpoint? {
    let name =
      SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.instanceNameKey])
      ?? "default"
    return SupatermSocketEndpoint(
      id: endpointID,
      name: name,
      path: SupatermSocketPath.managedSocketURL(
        instanceName: name,
        processID: processID,
        rootDirectory: rootDirectory,
        environment: environment,
        userID: userID
      ).path,
      pid: processID,
      startedAt: startedAt
    )
  }
}

public enum SupatermSocketSelectionSource: String, Equatable, Sendable, Codable {
  case explicitPath
  case environmentPath
  case explicitInstance
  case discoveredSingleton
}

public struct SupatermResolvedSocketTarget: Equatable, Sendable {
  public let path: String
  public let source: SupatermSocketSelectionSource

  public init(
    path: String,
    source: SupatermSocketSelectionSource
  ) {
    self.path = path
    self.source = source
  }
}

public enum SupatermSocketSelectionError: Error, Equatable, LocalizedError {
  case ambiguousDiscoveredInstances([SupatermSocketEndpoint])
  case ambiguousInstanceName(String, [SupatermSocketEndpoint])
  case instanceNotFound(String)
  case missingTarget

  public var errorDescription: String? {
    switch self {
    case .ambiguousDiscoveredInstances:
      return "Multiple Supaterm instances are reachable. Provide --instance or --socket."
    case .ambiguousInstanceName(let name, _):
      return "More than one Supaterm instance is named '\(name)'. Provide an endpoint ID or --socket."
    case .instanceNotFound(let name):
      return "No reachable Supaterm instance matches '\(name)'."
    case .missingTarget:
      return "No reachable Supaterm instance was found."
    }
  }
}

public enum SupatermSocketTargetResolver {
  public static func resolve(
    explicitPath: String?,
    environmentPath: String?,
    instance: String?,
    discoveredEndpoints: [SupatermSocketEndpoint]
  ) throws -> SupatermResolvedSocketTarget {
    if let explicitPath = SupatermSocketPath.normalized(explicitPath) {
      return SupatermResolvedSocketTarget(
        path: explicitPath,
        source: .explicitPath
      )
    }

    if let environmentPath = SupatermSocketPath.normalized(environmentPath) {
      return SupatermResolvedSocketTarget(
        path: environmentPath,
        source: .environmentPath
      )
    }

    if let instance = SupatermSocketPath.normalized(instance) {
      if let instanceID = UUID(uuidString: instance),
        let matchedByID = discoveredEndpoints.first(where: { $0.id == instanceID })
      {
        return SupatermResolvedSocketTarget(
          path: matchedByID.path,
          source: .explicitInstance
        )
      }

      let matchedByName = discoveredEndpoints.filter { $0.name == instance }
      if matchedByName.count == 1, let endpoint = matchedByName.first {
        return SupatermResolvedSocketTarget(
          path: endpoint.path,
          source: .explicitInstance
        )
      }
      if matchedByName.count > 1 {
        throw SupatermSocketSelectionError.ambiguousInstanceName(instance, matchedByName)
      }
      throw SupatermSocketSelectionError.instanceNotFound(instance)
    }

    if discoveredEndpoints.count == 1, let endpoint = discoveredEndpoints.first {
      return SupatermResolvedSocketTarget(
        path: endpoint.path,
        source: .discoveredSingleton
      )
    }

    if discoveredEndpoints.isEmpty {
      throw SupatermSocketSelectionError.missingTarget
    }

    throw SupatermSocketSelectionError.ambiguousDiscoveredInstances(discoveredEndpoints)
  }
}

public struct SupatermManagedSocketDiscoveryResult: Equatable, Sendable {
  public let reachableEndpoints: [SupatermSocketEndpoint]
  public let removedStalePaths: [String]

  public init(
    reachableEndpoints: [SupatermSocketEndpoint],
    removedStalePaths: [String]
  ) {
    self.reachableEndpoints = reachableEndpoints
    self.removedStalePaths = removedStalePaths
  }
}

public enum SupatermManagedSocketCandidateStatus: Equatable, Sendable {
  case ignored
  case reachable(SupatermSocketEndpoint)
  case stale
}

public enum SupatermManagedSocketDiscovery {
  public static func discover(
    candidatePaths: [String],
    probe: (String) -> SupatermManagedSocketCandidateStatus,
    removeStalePath: (String) -> Void
  ) -> SupatermManagedSocketDiscoveryResult {
    var reachableEndpoints: [SupatermSocketEndpoint] = []
    var removedStalePaths: [String] = []

    for candidatePath in candidatePaths {
      switch probe(candidatePath) {
      case .ignored:
        continue

      case .reachable(let endpoint):
        reachableEndpoints.append(endpoint)

      case .stale:
        removeStalePath(candidatePath)
        removedStalePaths.append(candidatePath)
      }
    }

    reachableEndpoints.sort {
      if $0.startedAt != $1.startedAt {
        return $0.startedAt > $1.startedAt
      }
      if $0.name != $1.name {
        return $0.name < $1.name
      }
      return $0.path < $1.path
    }

    return SupatermManagedSocketDiscoveryResult(
      reachableEndpoints: reachableEndpoints,
      removedStalePaths: removedStalePaths
    )
  }
}
