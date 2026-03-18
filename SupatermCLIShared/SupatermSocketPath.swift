import Foundation

public enum SupatermSocketPath {
  public static let directoryName = "Supaterm"
  public static let fileName = "supaterm.sock"

  public static func defaultURL(
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

    return
      resolvedAppSupportDirectory
      .appendingPathComponent(directoryName, isDirectory: true)
      .appendingPathComponent(fileName, isDirectory: false)
  }

  public static func resolve(
    explicitPath: String? = nil,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    appSupportDirectory: URL? = nil,
    fileManager: FileManager = .default
  ) -> String? {
    if let explicitPath = normalized(explicitPath) {
      return explicitPath
    }

    if let environmentPath = normalized(environment[SupatermCLIEnvironment.socketPathKey]) {
      return environmentPath
    }

    return defaultURL(
      appSupportDirectory: appSupportDirectory,
      fileManager: fileManager
    )?.path
  }

  public static func normalized(_ path: String?) -> String? {
    guard let path else { return nil }
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }
    return trimmed
  }
}
