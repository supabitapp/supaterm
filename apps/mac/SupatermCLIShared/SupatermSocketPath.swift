import Darwin
import Foundation

public enum SupatermSocketPath {
  public static let directoryName = "Supaterm"
  public static let managedDirectoryName = "sockets"
  public static let managedFileExtension = "sock"

  public static func applicationSupportDirectoryURL(
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> URL? {
    let resolvedAppSupportDirectory: URL
    if let appSupportDirectory {
      resolvedAppSupportDirectory = appSupportDirectory
    } else if let discovered = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first {
      resolvedAppSupportDirectory = discovered
    } else {
      return nil
    }

    return resolvedAppSupportDirectory
  }

  public static func managedDirectoryURL(
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> URL? {
    applicationSupportDirectoryURL(
      appSupportDirectory: appSupportDirectory,
      fileManager: fileManager
    )?
    .appendingPathComponent(directoryName, isDirectory: true)
    .appendingPathComponent(managedDirectoryName, isDirectory: true)
  }

  public static func managedSocketURL(
    endpointID: UUID,
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> URL? {
    managedDirectoryURL(
      appSupportDirectory: appSupportDirectory,
      fileManager: fileManager
    )?
    .appendingPathComponent(endpointID.uuidString, isDirectory: false)
    .appendingPathExtension(managedFileExtension)
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
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> [String] {
    guard
      let managedDirectoryURL = managedDirectoryURL(
        appSupportDirectory: appSupportDirectory,
        fileManager: fileManager
      ),
      let contents = try? fileManager.contentsOfDirectory(
        at: managedDirectoryURL,
        includingPropertiesForKeys: nil,
        options: [.skipsHiddenFiles]
      )
    else {
      return []
    }

    return contents
      .filter { $0.pathExtension == managedFileExtension && isSocketNode(at: $0.path) }
      .map { $0.path }
      .sorted()
  }

  public static func isManagedSocketPath(
    _ path: String,
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> Bool {
    guard
      let managedDirectoryPath = managedDirectoryURL(
        appSupportDirectory: appSupportDirectory,
        fileManager: fileManager
      )?.path,
      let normalizedPath = normalized(path)
    else {
      return false
    }

    let standardizedPath = URL(fileURLWithPath: normalizedPath).standardizedFileURL.path
    let standardizedManagedDirectoryPath = URL(fileURLWithPath: managedDirectoryPath).standardizedFileURL.path
    return standardizedPath.hasPrefix(standardizedManagedDirectoryPath + "/")
  }

  public static func normalized(_ path: String?) -> String? {
    guard let path else { return nil }
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return trimmed
  }

  private static func isSocketNode(at path: String) -> Bool {
    var fileStatus = stat()
    let status = path.withCString { pointer in
      lstat(pointer, &fileStatus)
    }
    guard status == 0 else {
      return false
    }
    return (fileStatus.st_mode & S_IFMT) == S_IFSOCK
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
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> SupatermSocketEndpoint? {
    let path =
      SupatermSocketPath.resolveExplicitPath(environment: environment)
      ?? SupatermSocketPath.managedSocketURL(
        endpointID: endpointID,
        appSupportDirectory: appSupportDirectory,
        fileManager: fileManager
      )?.path

    guard let path = SupatermSocketPath.normalized(path) else {
      return nil
    }

    let name =
      SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.instanceNameKey])
      ?? "pid-\(processID)"
    return .init(
      id: endpointID,
      name: name,
      path: path,
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
  public let endpoint: SupatermSocketEndpoint?
  public let path: String
  public let source: SupatermSocketSelectionSource

  public init(
    endpoint: SupatermSocketEndpoint?,
    path: String,
    source: SupatermSocketSelectionSource
  ) {
    self.endpoint = endpoint
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
      return .init(
        endpoint: nil,
        path: explicitPath,
        source: .explicitPath
      )
    }

    if let environmentPath = SupatermSocketPath.normalized(environmentPath) {
      return .init(
        endpoint: nil,
        path: environmentPath,
        source: .environmentPath
      )
    }

    if let instance = SupatermSocketPath.normalized(instance) {
      if let matchedByID = discoveredEndpoints.first(where: { $0.id.uuidString == instance }) {
        return .init(
          endpoint: matchedByID,
          path: matchedByID.path,
          source: .explicitInstance
        )
      }

      let matchedByName = discoveredEndpoints.filter { $0.name == instance }
      if matchedByName.count == 1, let endpoint = matchedByName.first {
        return .init(
          endpoint: endpoint,
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
      return .init(
        endpoint: endpoint,
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

public enum SupatermManagedSocketDiscovery {
  public static func discover(
    candidatePaths: [String],
    identify: (String) throws -> SupatermSocketEndpoint,
    removeStalePath: (String) -> Void
  ) -> SupatermManagedSocketDiscoveryResult {
    var reachableEndpoints: [SupatermSocketEndpoint] = []
    var removedStalePaths: [String] = []

    for candidatePath in candidatePaths {
      do {
        let endpoint = try identify(candidatePath)
        guard endpoint.path == candidatePath else {
          removeStalePath(candidatePath)
          removedStalePaths.append(candidatePath)
          continue
        }
        reachableEndpoints.append(endpoint)
      } catch {
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

    return .init(
      reachableEndpoints: reachableEndpoints,
      removedStalePaths: removedStalePaths
    )
  }
}
