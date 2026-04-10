import Foundation

enum GhosttySupport {
  struct ConfigFileLocations: Equatable {
    let preferred: URL
  }

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

    font-size = 15
    theme = light:Zenbones Light,dark:Zenbones Dark
    cursor-style = block
    """

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

  nonisolated static func bundledCommandDirectory(resourcesURL: URL?) -> URL? {
    resourcesURL?.appendingPathComponent("bin", isDirectory: true)
  }

  nonisolated static func bundledCLIPath(resourcesURL: URL?) -> String? {
    bundledCommandDirectory(resourcesURL: resourcesURL)?
      .appendingPathComponent("sp", isDirectory: false)
      .path
  }

  static func configFileLocations(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> ConfigFileLocations {
    let preferredURL = xdgConfigHomeURL(
      homeDirectoryURL: homeDirectoryURL,
      environment: environment
    )
    .appendingPathComponent("ghostty", isDirectory: true)
    .appendingPathComponent("config", isDirectory: false)

    return ConfigFileLocations(
      preferred: preferredURL
    )
  }

  static func seedDefaultConfigIfNeeded(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    environment: [String: String] = ProcessInfo.processInfo.environment,
    fileManager: FileManager = .default
  ) throws {
    let locations = configFileLocations(
      homeDirectoryURL: homeDirectoryURL,
      environment: environment
    )
    guard !fileManager.fileExists(atPath: locations.preferred.path) else {
      return
    }

    try fileManager.createDirectory(
      at: locations.preferred.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try defaultConfigContents.write(to: locations.preferred, atomically: true, encoding: .utf8)
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

extension Notification.Name {
  static let ghosttyRuntimeReloadRequested = Notification.Name("ghosttyRuntimeReloadRequested")
}
