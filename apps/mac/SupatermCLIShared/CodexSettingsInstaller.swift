import Darwin
import Foundation

enum LoginShellCommandAvailability {
  static func isAvailable(_ commandNames: [String]) throws -> Bool {
    let process = Process()
    process.executableURL = CodexSettingsInstaller.loginShellURL()
    process.arguments = commandArguments(for: commandNames)
    try process.run()
    process.waitUntilExit()
    return process.terminationStatus == 0
  }

  static func commandArguments(for commandNames: [String]) -> [String] {
    let checks = commandNames.map { "command -v \($0) >/dev/null 2>&1" }
    return interactiveCommandArguments(for: checks.joined(separator: " || "))
  }

  static func interactiveCommandArguments(for command: String) -> [String] {
    ["-l", "-i", "-c", command]
  }
}

public struct CodexSettingsInstaller {
  struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardError: String
  }

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let checkCodexAvailable: @Sendable () throws -> Bool
  let runEnableHooksCommand: @Sendable () throws -> CommandResult

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      checkCodexAvailable: Self.checkCodexAvailable,
      runEnableHooksCommand: Self.runEnableHooksCommand
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    checkCodexAvailable: @escaping @Sendable () throws -> Bool = Self.checkCodexAvailable,
    runEnableHooksCommand: @escaping @Sendable () throws -> CommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.checkCodexAvailable = checkCodexAvailable
    self.runEnableHooksCommand = runEnableHooksCommand
  }

  public func isCodexAvailable() throws -> Bool {
    try checkCodexAvailable()
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
      .appendingPathComponent(".codex", isDirectory: true)
      .appendingPathComponent("hooks.json", isDirectory: false)
  }

  static func checkCodexAvailable() throws -> Bool {
    try LoginShellCommandAvailability.isAvailable(["codex"])
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
    LoginShellCommandAvailability.interactiveCommandArguments(
      for: "codex features enable codex_hooks"
    )
  }

  static func availabilityCommandArguments() -> [String] {
    LoginShellCommandAvailability.commandArguments(for: ["codex"])
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
