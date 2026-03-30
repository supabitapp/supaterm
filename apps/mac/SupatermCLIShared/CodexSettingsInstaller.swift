import Darwin
import Foundation

public struct CodexSettingsInstaller {
  struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardError: String
  }

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let runEnableHooksCommand: @Sendable () throws -> CommandResult

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      runEnableHooksCommand: Self.runEnableHooksCommand
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    runEnableHooksCommand: @escaping @Sendable () throws -> CommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.runEnableHooksCommand = runEnableHooksCommand
  }

  public func installSupatermHooks() throws {
    let commandResult = try runEnableHooksCommand()
    guard commandResult.status == 0 else {
      throw CodexSettingsInstallerError.enableHooksFailed(commandResult.standardError)
    }

    try fileInstaller.install(
      settingsURL: Self.settingsURL(homeDirectoryURL: homeDirectoryURL),
      hookGroupsByEvent: try SupatermCodexHookSettings.hookGroupsByEvent()
    )
  }

  public static func settingsURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".codex", isDirectory: true)
      .appendingPathComponent("hooks.json", isDirectory: false)
  }

  static func runEnableHooksCommand() throws -> CommandResult {
    let process = Process()
    process.executableURL = loginShellURL()
    process.arguments = enableHooksCommandArguments()

    let errorPipe = Pipe()
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    let standardError =
      String(
        bytes: errorPipe.fileHandleForReading.readDataToEndOfFile(),
        encoding: .utf8
      ) ?? ""
    let status = process.terminationStatus
    if status == 127 {
      throw CodexSettingsInstallerError.codexUnavailable
    }
    return .init(
      status: status,
      standardError: standardError.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  static func loginShellURL(
    environment: [String: String] = ProcessInfo.processInfo.environment,
    currentUserShellPath: String? = currentUserShellPath()
  ) -> URL {
    let shellPath =
      normalizedShellPath(currentUserShellPath)
      ?? normalizedShellPath(environment["SHELL"])
      ?? "/bin/zsh"
    return URL(fileURLWithPath: shellPath)
  }

  static func enableHooksCommandArguments() -> [String] {
    [
      "-l",
      "-c",
      "codex features enable codex_hooks",
    ]
  }

  private static func currentUserShellPath() -> String? {
    guard let entry = getpwuid(getuid()), let shell = entry.pointee.pw_shell else {
      return nil
    }
    return String(cString: shell)
  }

  private static func normalizedShellPath(_ path: String?) -> String? {
    guard let path = path?.trimmingCharacters(in: .whitespacesAndNewlines), !path.isEmpty else {
      return nil
    }
    return path
  }

  private var fileInstaller: AgentHookSettingsFileInstaller {
    AgentHookSettingsFileInstaller(
      fileManager: fileManager,
      errors: .init(
        invalidEventHooks: { CodexSettingsInstallerError.invalidEventHooks($0) },
        invalidHooksObject: { CodexSettingsInstallerError.invalidHooksObject },
        invalidJSON: { CodexSettingsInstallerError.invalidJSON },
        invalidRootObject: { CodexSettingsInstallerError.invalidRootObject }
      )
    )
  }
}

public enum CodexSettingsInstallerError: Error, Equatable, LocalizedError {
  case codexUnavailable
  case enableHooksFailed(String)
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject

  public var errorDescription: String? {
    switch self {
    case .codexUnavailable:
      return "Codex must be installed and available in your login shell before Supaterm can install hooks."
    case .enableHooksFailed(let details):
      if details.isEmpty {
        return "Supaterm could not enable the Codex hooks feature."
      }
      return "Supaterm could not enable the Codex hooks feature: \(details)"
    case .invalidEventHooks(let event):
      return "Codex hooks use an unsupported shape for \(event)."
    case .invalidHooksObject:
      return "Codex hooks use an unsupported shape."
    case .invalidJSON:
      return "Codex hooks must be valid JSON before Supaterm can install hooks."
    case .invalidRootObject:
      return "Codex hooks must be a JSON object before Supaterm can install hooks."
    }
  }
}
