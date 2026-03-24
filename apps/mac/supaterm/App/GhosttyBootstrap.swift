import Foundation
import GhosttyKit

enum GhosttyBootstrap {
  struct ConfigFileLocations: Equatable {
    let preferred: URL
    let candidates: [URL]
  }

  static let extraCLIArguments: [String] = []
  static let defaultConfigContents = """
    keybind = super+d=new_split:right
    keybind = chain=equalize_splits
    keybind = super+shift+d=new_split:down
    keybind = chain=equalize_splits
    keybind = super+shift+equal=equalize_splits
    keybind = opt+h=goto_split:left
    keybind = opt+j=goto_split:bottom
    keybind = opt+k=goto_split:top
    keybind = opt+l=goto_split:right

    theme = light:Zenbones Light,dark:Zenbones Dark
    """

  private static let argv: [UnsafeMutablePointer<CChar>?] = {
    var args: [UnsafeMutablePointer<CChar>?] = []
    let executable = CommandLine.arguments.first ?? "supaterm"
    args.append(strdup(executable))
    for argument in extraCLIArguments {
      args.append(strdup(argument))
    }
    args.append(nil)
    return args
  }()

  static func resourceDirectories(
    resourcesURL: URL?,
    fileManager: FileManager = .default
  ) -> (ghostty: URL, terminfo: URL)? {
    guard let resourcesURL else { return nil }

    let ghosttyURL = resourcesURL.appendingPathComponent("ghostty", isDirectory: true)
    let terminfoURL = resourcesURL.appendingPathComponent("terminfo", isDirectory: true)

    var isDirectory = ObjCBool(false)
    guard fileManager.fileExists(atPath: ghosttyURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return nil
    }

    isDirectory = ObjCBool(false)
    guard fileManager.fileExists(atPath: terminfoURL.path, isDirectory: &isDirectory),
      isDirectory.boolValue
    else {
      return nil
    }

    return (ghosttyURL, terminfoURL)
  }

  static func configFileLocations(
    bundleIdentifier: String?,
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> ConfigFileLocations? {
    guard let bundleIdentifier else { return nil }

    let appSupportDirectoryURL =
      homeDirectoryURL
      .appendingPathComponent("Library", isDirectory: true)
      .appendingPathComponent("Application Support", isDirectory: true)
      .appendingPathComponent(bundleIdentifier, isDirectory: true)
    let preferredURL = appSupportDirectoryURL.appendingPathComponent("config.ghostty", isDirectory: false)
    let xdgDirectoryURL = xdgConfigHomeURL(
      homeDirectoryURL: homeDirectoryURL,
      environment: environment
    ).appendingPathComponent("ghostty", isDirectory: true)

    return ConfigFileLocations(
      preferred: preferredURL,
      candidates: [
        preferredURL,
        appSupportDirectoryURL.appendingPathComponent("config", isDirectory: false),
        xdgDirectoryURL.appendingPathComponent("config.ghostty", isDirectory: false),
        xdgDirectoryURL.appendingPathComponent("config", isDirectory: false),
      ]
    )
  }

  static func seedDefaultConfigIfNeeded(
    bundleIdentifier: String? = Bundle.main.bundleIdentifier,
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default
  ) throws {
    guard
      let locations = configFileLocations(
        bundleIdentifier: bundleIdentifier,
        homeDirectoryURL: homeDirectoryURL,
        environment: environment
      )
    else {
      return
    }
    guard existingConfigFileURL(in: locations.candidates, fileManager: fileManager) == nil else {
      return
    }

    try fileManager.createDirectory(
      at: locations.preferred.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try defaultConfigContents.write(to: locations.preferred, atomically: true, encoding: .utf8)
  }

  static func existingConfigFileURL(
    in candidates: [URL],
    fileManager: FileManager = .default
  ) -> URL? {
    for candidate in candidates {
      var isDirectory = ObjCBool(false)
      if fileManager.fileExists(atPath: candidate.path, isDirectory: &isDirectory),
        !isDirectory.boolValue
      {
        return candidate
      }
    }
    return nil
  }

  static func initialize() {
    guard let resourceDirectories = resourceDirectories(resourcesURL: Bundle.main.resourceURL) else {
      assertionFailure("Missing bundled Ghostty resources")
      return
    }
    do {
      try seedDefaultConfigIfNeeded()
    } catch {
      assertionFailure("Failed to seed Ghostty config: \(error)")
    }
    setenv("GHOSTTY_RESOURCES_DIR", resourceDirectories.ghostty.path, 1)
    setenv("TERMINFO_DIRS", resourceDirectories.terminfo.path, 1)

    argv.withUnsafeBufferPointer { buffer in
      let argc = UInt(max(0, buffer.count - 1))
      let argv = UnsafeMutablePointer(mutating: buffer.baseAddress)
      if ghostty_init(argc, argv) != GHOSTTY_SUCCESS {
        preconditionFailure("ghostty_init failed")
      }
    }
  }

  private static func xdgConfigHomeURL(
    homeDirectoryURL: URL,
    environment: [String: String]
  ) -> URL {
    if let xdgConfigHome = environment["XDG_CONFIG_HOME"], !xdgConfigHome.isEmpty {
      return URL(fileURLWithPath: xdgConfigHome, isDirectory: true)
    }
    return homeDirectoryURL.appendingPathComponent(".config", isDirectory: true)
  }
}
