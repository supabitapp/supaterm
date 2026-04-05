import Foundation

public struct ClaudeSettingsInstaller {
  let homeDirectoryURL: URL
  let fileManager: FileManager

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
  }

  public func installSupatermHooks() throws {
    try fileInstaller.install(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL),
      hookGroupsByEvent: try SupatermClaudeHookSettings.hookGroupsByEvent()
    )
  }

  public func hasSupatermHooks() throws -> Bool {
    try fileInstaller.hasSupatermHooks(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    )
  }

  public func removeSupatermHooks() throws {
    try fileInstaller.removeSupatermHooks(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    )
  }

  public static func settingsURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".claude", isDirectory: true)
      .appendingPathComponent("settings.json", isDirectory: false)
  }

  private var fileInstaller: AgentHookSettingsFileInstaller {
    AgentHookSettingsFileInstaller(
      fileManager: fileManager,
      errors: .init(
        invalidEventHooks: { ClaudeSettingsInstallerError.invalidEventHooks($0) },
        invalidHooksObject: { ClaudeSettingsInstallerError.invalidHooksObject },
        invalidJSON: { ClaudeSettingsInstallerError.invalidJSON },
        invalidRootObject: { ClaudeSettingsInstallerError.invalidRootObject }
      )
    )
  }
}

public enum ClaudeSettingsInstallerError: Error, Equatable, LocalizedError {
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject

  public var errorDescription: String? {
    switch self {
    case .invalidEventHooks(let event):
      return "Claude settings use an unsupported hooks shape for \(event)."
    case .invalidHooksObject:
      return "Claude settings use an unsupported hooks shape."
    case .invalidJSON:
      return "Claude settings must be valid JSON before Supaterm can install hooks."
    case .invalidRootObject:
      return "Claude settings must be a JSON object before Supaterm can install hooks."
    }
  }
}
