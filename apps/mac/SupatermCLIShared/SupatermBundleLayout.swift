import Foundation

public nonisolated enum SupatermBundleLayout {
  public static func spExecutableURL(
    nextTo executableURL: URL,
    fileManager: FileManager = .default
  ) -> URL? {
    regularExecutableURL(
      executableURL
        .deletingLastPathComponent()
        .appendingPathComponent("sp", isDirectory: false),
      fileManager: fileManager
    )
  }

  public static func zmxExecutableURL(
    nextTo executableURL: URL,
    fileManager: FileManager = .default
  ) -> URL? {
    regularExecutableURL(
      contentsDirectoryURL(nextTo: executableURL)
        .appendingPathComponent("Helpers", isDirectory: true)
        .appendingPathComponent("zmx", isDirectory: false),
      fileManager: fileManager
    )
  }

  public static func resourcesDirectoryURL(nextTo executableURL: URL) -> URL {
    contentsDirectoryURL(nextTo: executableURL)
      .appendingPathComponent("Resources", isDirectory: true)
  }

  private static func regularExecutableURL(
    _ executableURL: URL,
    fileManager: FileManager
  ) -> URL? {
    guard
      let attributes = try? fileManager.attributesOfItem(atPath: executableURL.path),
      (attributes[.type] as? FileAttributeType) == .typeRegular,
      fileManager.isExecutableFile(atPath: executableURL.path)
    else {
      return nil
    }
    return executableURL
  }

  private static func contentsDirectoryURL(nextTo executableURL: URL) -> URL {
    executableURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }
}
