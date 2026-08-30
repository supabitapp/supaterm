import Foundation
import System

public nonisolated enum SupatermWorkingDirectory {
  public static func normalizedPath(_ path: String) -> String {
    FilePath(path).string
  }

  public static func normalizedPath(_ url: URL) -> String {
    normalizedPath(url.path(percentEncoded: false))
  }

  public static func existingDirectoryURL(
    for path: String,
    fileManager: FileManager = .default
  ) -> URL? {
    let path = normalizedPath(path)
    var isDirectory = ObjCBool(false)
    guard fileManager.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else {
      return nil
    }
    return URL(fileURLWithPath: path, isDirectory: true)
  }
}
