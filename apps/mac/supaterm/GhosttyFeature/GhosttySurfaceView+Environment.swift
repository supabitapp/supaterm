import Foundation
import SupatermCLIShared
import SupatermSupport

extension GhosttySurfaceView {
  public static func normalizedWorkingDirectoryPath(_ path: String) -> String {
    var normalized = path
    while normalized.count > 1 && normalized.hasSuffix("/") {
      normalized.removeLast()
    }
    return normalized
  }

  public static func cliDirectory(_ cliPath: String?) -> String? {
    guard let cliPath else { return nil }
    let trimmedPath = cliPath.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPath.isEmpty else { return nil }
    return URL(fileURLWithPath: trimmedPath).deletingLastPathComponent().path
  }

  public static func prependedPath(
    _ directory: String,
    currentPath: String?
  ) -> String {
    let trimmedDirectory = directory.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedDirectory.isEmpty else {
      return currentPath?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    var components =
      currentPath?
      .split(separator: ":")
      .map { String($0) }
      .filter { !$0.isEmpty && $0 != trimmedDirectory } ?? []
    components.insert(trimmedDirectory, at: 0)
    return components.joined(separator: ":")
  }

  public static func titleOverride(from title: String) -> String? {
    title.isEmpty ? nil : title
  }

  public static func supatermEnvironmentVariables(
    surfaceID: UUID,
    tabID: UUID,
    socketPath: String?,
    cliPath: String?,
    processEnvironment: [String: String] = ProcessInfo.processInfo.environment,
    zmxSessionsEnabled: Bool = true
  ) -> [SupatermCLIEnvironmentVariable] {
    var environmentVariables = SupatermCLIContext(
      surfaceID: surfaceID,
      tabID: tabID
    ).environmentVariables
    if let socketPath {
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: SupatermCLIEnvironment.socketPathKey,
          value: socketPath
        )
      )
    }
    if let cliPath {
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: SupatermCLIEnvironment.cliPathKey,
          value: cliPath
        )
      )
    }
    if let stateHome = SupatermStateRoot.stateHomeURL(environment: processEnvironment) {
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: SupatermCLIEnvironment.stateHomeKey,
          value: stateHome.path
        )
      )
    }
    if zmxSessionsEnabled {
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: ZmxEnvironment.directoryKey,
          value: ZmxSocketBudget.socketDir()
        )
      )
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: ZmxEnvironment.sessionKey,
          value: ""
        )
      )
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: ZmxEnvironment.sessionPrefixKey,
          value: ""
        )
      )
    }
    let path = prependedPath(
      cliDirectory(cliPath) ?? "",
      currentPath: processEnvironment["PATH"]
    )
    if !path.isEmpty {
      environmentVariables.append(
        SupatermCLIEnvironmentVariable(
          key: "PATH",
          value: path
        )
      )
    }
    return environmentVariables
  }
}
