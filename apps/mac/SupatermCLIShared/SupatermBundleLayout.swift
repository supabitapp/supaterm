import Foundation

public nonisolated enum SupatermBundleLayout {
  public static let sessionHostExecutableName = "supaterm-host"

  public static func spExecutableURL(
    nextTo executableURL: URL,
    fileManager: FileManager = .default
  ) -> URL? {
    regularExecutableURL(
      contentsDirectoryURL(nextTo: executableURL)
        .appendingPathComponent("MacOS", isDirectory: true)
        .appendingPathComponent("sp", isDirectory: false),
      fileManager: fileManager
    )
  }

  public static func sessionHostExecutableURL(
    nextTo executableURL: URL,
    fileManager: FileManager = .default
  ) -> URL? {
    remoteSessionHostExecutableURL(
      nextTo: executableURL,
      platform: .macOSAArch64,
      fileManager: fileManager
    )
  }

  public static func remoteSessionHostExecutableURL(
    nextTo executableURL: URL,
    platform: SupatermSessionHostPlatform,
    fileManager: FileManager = .default
  ) -> URL? {
    regularExecutableURL(
      resourcesDirectoryURL(nextTo: executableURL)
        .appendingPathComponent("supaterm-host", isDirectory: true)
        .appendingPathComponent(platform.rawValue, isDirectory: true)
        .appendingPathComponent(sessionHostExecutableName, isDirectory: false),
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
    var directoryURL = executableURL.deletingLastPathComponent()
    while directoryURL.path != "/" {
      if directoryURL.lastPathComponent == "Contents",
        directoryURL.deletingLastPathComponent().pathExtension == "app"
      {
        return directoryURL
      }
      directoryURL.deleteLastPathComponent()
    }
    return
      executableURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }
}

public nonisolated enum SupatermSessionHostPlatform: String, CaseIterable, Sendable {
  case linuxAArch64 = "linux-aarch64"
  case linuxX86_64 = "linux-x86_64"
  case macOSAArch64 = "macos-aarch64"
  case macOSX86_64 = "macos-x86_64"

  public init?(operatingSystem: String, architecture: String) {
    switch (operatingSystem.lowercased(), architecture.lowercased()) {
    case ("linux", "aarch64"), ("linux", "arm64"):
      self = .linuxAArch64
    case ("linux", "amd64"), ("linux", "x86_64"):
      self = .linuxX86_64
    case ("darwin", "aarch64"), ("darwin", "arm64"):
      self = .macOSAArch64
    case ("darwin", "amd64"), ("darwin", "x86_64"):
      self = .macOSX86_64
    default:
      return nil
    }
  }
}
