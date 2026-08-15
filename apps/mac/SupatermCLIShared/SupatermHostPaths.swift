import Darwin
import Foundation

public enum SupatermHostEnvironment {
  public static let socketPathKey = "SUPATERM_HOST_SOCKET_PATH"
  public static let terminalIDKey = "SUPATERM_TERMINAL_ID"
}

public struct SupatermHostPaths: Equatable, Sendable {
  public let stateRoot: URL
  public let runtimeRoot: URL
  public let socket: URL

  public init(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment,
    runtimeBase: URL? = nil,
    userID: uid_t = getuid()
  ) {
    let stateRoot = SupatermStateRoot.directoryURL(
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    ).standardizedFileURL
    let runtimeBase =
      runtimeBase
      ?? SupatermSocketPath.managedDirectoryURL(
        environment: environment,
        userID: userID
      )
    let stateHash = SupatermInstanceIdentity.stableHash(for: stateRoot.path)
    let runtimeRoot = runtimeBase.appendingPathComponent(
      "host-\(stateHash)",
      isDirectory: true
    )
    self.stateRoot = stateRoot
    self.runtimeRoot = runtimeRoot
    socket = runtimeRoot.appendingPathComponent("host.sock", isDirectory: false)
  }
}
