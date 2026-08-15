import Darwin
import Foundation

public enum SupatermHostEnvironment {
  public static let socketPathKey = "SUPATERM_HOST_SOCKET_PATH"
  public static let terminalIDKey = "SUPATERM_TERMINAL_ID"
}

public enum SupatermHostPathsError: Error, Equatable, LocalizedError, Sendable {
  case homeDirectoryNotSet
  case noRuntimeRootFits

  public var errorDescription: String? {
    switch self {
    case .homeDirectoryNotSet:
      "HOME is not set"
    case .noRuntimeRootFits:
      "No host runtime root fits the Unix socket path limit"
    }
  }
}

public struct SupatermHostPaths: Equatable, Sendable {
  private static let homeDirectoryKey = "HOME"
  private static let hostDirectoryPrefix = "host-"
  private static let hostSocketName = "host.sock"
  private static let socketPathCapacity = MemoryLayout.size(ofValue: sockaddr_un().sun_path)
  private static let temporaryDirectoryKey = "TMPDIR"
  private static let xdgRuntimeDirectoryKey = "XDG_RUNTIME_DIR"

  public let stateRoot: URL
  public let runtimeRoot: URL
  public let socket: URL

  public init(
    homeDirectoryPath: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    runtimeBase: URL? = nil,
    userID: uid_t = getuid()
  ) throws {
    let stateRootPath = try Self.stateRootPath(
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
    let stateHash = SupatermInstanceIdentity.stableHash(
      for: stateRootPath,
      hexDigitCount: 16
    )
    let runtimeRootPath =
      if let runtimeBase {
        Self.appending(
          "\(Self.hostDirectoryPrefix)\(stateHash)",
          to: runtimeBase.path
        )
      } else {
        try Self.defaultRuntimeRootPath(
          stateHash: stateHash,
          environment: environment,
          userID: userID
        )
      }
    let socketPath = Self.appending(Self.hostSocketName, to: runtimeRootPath)
    stateRoot = Self.fileURL(path: stateRootPath, isDirectory: true)
    runtimeRoot = Self.fileURL(path: runtimeRootPath, isDirectory: true)
    socket = Self.fileURL(path: socketPath, isDirectory: false)
  }

  private static func stateRootPath(
    homeDirectoryPath: String?,
    environment: [String: String]
  ) throws -> String {
    if let stateHome = SupatermSocketPath.normalized(
      environment[SupatermCLIEnvironment.stateHomeKey]
    ) {
      if stateHome == "~" {
        return standardizedAbsolutePath(
          try resolvedHomeDirectoryPath(
            homeDirectoryPath,
            environment: environment
          )
        )
      }
      if stateHome.hasPrefix("~/") {
        return standardizedAbsolutePath(
          appending(
            String(stateHome.dropFirst(2)),
            to: try resolvedHomeDirectoryPath(
              homeDirectoryPath,
              environment: environment
            )
          )
        )
      }
      return standardizedAbsolutePath(stateHome)
    }
    let homeDirectoryPath = try resolvedHomeDirectoryPath(
      homeDirectoryPath,
      environment: environment
    )
    return standardizedAbsolutePath(
      appending(
        "supaterm",
        to: appending(".config", to: homeDirectoryPath)
      )
    )
  }

  private static func resolvedHomeDirectoryPath(
    _ homeDirectoryPath: String?,
    environment: [String: String]
  ) throws -> String {
    let homeDirectoryPath =
      if let homeDirectoryPath {
        SupatermSocketPath.normalized(homeDirectoryPath)
      } else {
        SupatermSocketPath.normalized(environment[homeDirectoryKey])
      }
    guard let homeDirectoryPath else {
      throw SupatermHostPathsError.homeDirectoryNotSet
    }
    return homeDirectoryPath
  }

  private static func defaultRuntimeRootPath(
    stateHash: String,
    environment: [String: String],
    userID: uid_t
  ) throws -> String {
    let temporaryDirectoryName = "supaterm-\(userID)"
    var candidates: [String] = []
    if let xdgRuntimeDirectory = SupatermSocketPath.normalized(
      environment[xdgRuntimeDirectoryKey]
    ) {
      candidates.append(
        runtimeRootPath(
          rootPath: xdgRuntimeDirectory,
          directoryName: "supaterm",
          stateHash: stateHash
        )
      )
    }
    if let temporaryDirectory = SupatermSocketPath.normalized(
      environment[temporaryDirectoryKey]
    ) {
      candidates.append(
        runtimeRootPath(
          rootPath: temporaryDirectory,
          directoryName: temporaryDirectoryName,
          stateHash: stateHash
        )
      )
    }
    let fallback = runtimeRootPath(
      rootPath: "/tmp",
      directoryName: temporaryDirectoryName,
      stateHash: stateHash
    )
    candidates.append(fallback)
    guard let runtimeRootPath = candidates.first(where: socketFits) else {
      throw SupatermHostPathsError.noRuntimeRootFits
    }
    return runtimeRootPath
  }

  private static func runtimeRootPath(
    rootPath: String,
    directoryName: String,
    stateHash: String
  ) -> String {
    let managedDirectoryPath = appending(
      directoryName,
      to: canonicalizedExistingPrefix(rootPath)
    )
    return appending("\(hostDirectoryPrefix)\(stateHash)", to: managedDirectoryPath)
  }

  private static func socketFits(runtimeRootPath: String) -> Bool {
    appending(hostSocketName, to: runtimeRootPath).utf8.count < socketPathCapacity
  }

  private static func canonicalizedExistingPrefix(_ path: String) -> String {
    let absolutePath = standardizedAbsolutePath(path)
    var existingPath = absolutePath
    var suffix: [String] = []
    while true {
      if let canonicalPath = realpathString(existingPath) {
        return suffix.reversed().reduce(canonicalPath) { path, component in
          appending(component, to: path)
        }
      }
      let existingPathString = existingPath as NSString
      let name = existingPathString.lastPathComponent
      guard !name.isEmpty else {
        return absolutePath
      }
      suffix.append(name)
      let parent = existingPathString.deletingLastPathComponent
      guard parent != existingPath else {
        return absolutePath
      }
      existingPath = parent.isEmpty ? "/" : parent
    }
  }

  private static func standardizedAbsolutePath(_ path: String) -> String {
    let absolutePath =
      if (path as NSString).isAbsolutePath {
        path
      } else {
        appending(path, to: FileManager.default.currentDirectoryPath)
      }
    return (absolutePath as NSString).standardizingPath
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

  private static func appending(_ component: String, to path: String) -> String {
    path == "/" ? path + component : path + "/" + component
  }

  private static func fileURL(path: String, isDirectory: Bool) -> URL {
    path.withCString { pointer in
      URL(
        fileURLWithFileSystemRepresentation: pointer,
        isDirectory: isDirectory,
        relativeTo: nil
      )
    }
  }
}
