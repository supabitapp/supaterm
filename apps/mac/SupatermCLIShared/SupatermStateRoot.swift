import Foundation

public enum SupatermStateRoot {
  public static func directoryURL(
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    if let stateHome = stateHomeURL(environment: environment) {
      return stateHome
    }
    return URL(fileURLWithPath: homeDirectoryPath, isDirectory: true)
      .appendingPathComponent(".config", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: true)
  }

  public static func fileURL(
    _ name: String,
    homeDirectoryPath: String = NSHomeDirectory(),
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL {
    directoryURL(
      homeDirectoryPath: homeDirectoryPath,
      environment: environment
    )
    .appendingPathComponent(name, isDirectory: false)
  }

  public static func stateHomeURL(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> URL? {
    guard let path = SupatermSocketPath.normalized(environment[SupatermCLIEnvironment.stateHomeKey]) else {
      return nil
    }
    return URL(
      fileURLWithPath: NSString(string: path).expandingTildeInPath,
      isDirectory: true
    )
    .standardizedFileURL
  }
}
