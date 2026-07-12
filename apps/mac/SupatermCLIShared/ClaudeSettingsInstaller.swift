import Foundation

public struct ClaudeSettingsInstaller {
  let homeDirectoryURL: URL
  let fileManager: FileManager
  let runAvailabilityCommand: @Sendable () throws -> CodingAgentCommandResult

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      runAvailabilityCommand: {
        try CodingAgentCommandRunner.run(arguments: Self.availabilityCommandArguments())
      }
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    runAvailabilityCommand: @escaping @Sendable () throws -> CodingAgentCommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.runAvailabilityCommand = runAvailabilityCommand
  }

  public func installSupatermHooks() throws {
    try fileInstaller.install(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL),
      hookGroupsByEvent: try SupatermClaudeHookSettings.hookGroupsByEvent()
    )
  }

  public func integrationHealth() throws -> CodingAgentIntegrationHealth {
    let settingsHealth = try fileInstaller.integrationHealth(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL),
      hookGroupsByEvent: SupatermClaudeHookSettings.hookGroupsByEvent()
    )
    guard try runAvailabilityCommand().status == 0 else {
      return settingsHealth == .absent ? .unavailable : .unavailableInstalled
    }
    return settingsHealth
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

  static func availabilityCommandArguments() -> [String] {
    LoginShellCommandAvailability.commandArguments(for: ["claude", "claude-code"])
  }

  private var fileInstaller: AgentHookSettingsFileInstaller {
    AgentHookSettingsFileInstaller(
      fileManager: fileManager,
      errors: AgentHookSettingsFileInstaller.Errors(
        invalidEventHooks: { ClaudeSettingsInstallerError.invalidEventHooks($0) },
        invalidHooksObject: { ClaudeSettingsInstallerError.invalidHooksObject },
        invalidJSON: { ClaudeSettingsInstallerError.invalidJSON },
        invalidRootObject: { ClaudeSettingsInstallerError.invalidRootObject }
      )
    )
  }
}

enum ClaudeSettingsInstallerError: Error, Equatable, LocalizedError {
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject

  var errorDescription: String? {
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
