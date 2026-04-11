import Foundation

public struct SupatermSkillInstaller {
  public struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardError: String
  }

  public static let manualInstallCommand =
    "npx skills add supabitapp/supaterm-skills --skill supaterm -g"
  public static let automatedInstallCommand = "\(manualInstallCommand) -y"

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let checkNPXAvailable: @Sendable () throws -> Bool
  let runInstallCommand: @Sendable ([String]) throws -> CommandResult

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      checkNPXAvailable: Self.checkNPXAvailable,
      runInstallCommand: Self.runInstallCommand
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    checkNPXAvailable: @escaping @Sendable () throws -> Bool,
    runInstallCommand: @escaping @Sendable ([String]) throws -> CommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.checkNPXAvailable = checkNPXAvailable
    self.runInstallCommand = runInstallCommand
  }

  public func isNPXAvailable() throws -> Bool {
    try checkNPXAvailable()
  }

  public func hasSupatermSkillInstalled() -> Bool {
    fileManager.fileExists(atPath: Self.skillDefinitionURL(homeDirectoryURL: homeDirectoryURL).path)
  }

  public func installSupatermSkill() throws {
    guard try isNPXAvailable() else {
      throw SupatermSkillInstallerError.npxUnavailable
    }

    let commandResult = try runInstallCommand(Self.automatedInstallCommandArguments())
    guard commandResult.status == 0 else {
      throw SupatermSkillInstallerError.installFailed(commandResult.standardError)
    }
  }

  public static func skillsDirectoryURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".agents", isDirectory: true)
      .appendingPathComponent("skills", isDirectory: true)
  }

  public static func skillDirectoryURL(homeDirectoryURL: URL) -> URL {
    skillsDirectoryURL(homeDirectoryURL: homeDirectoryURL)
      .appendingPathComponent("supaterm", isDirectory: true)
  }

  public static func skillDefinitionURL(homeDirectoryURL: URL) -> URL {
    skillDirectoryURL(homeDirectoryURL: homeDirectoryURL)
      .appendingPathComponent("SKILL.md", isDirectory: false)
  }

  static func checkNPXAvailable() throws -> Bool {
    try LoginShellCommandAvailability.isAvailable(["npx"])
  }

  static func automatedInstallCommandArguments() -> [String] {
    ["-l", "-c", automatedInstallCommand]
  }

  static func runInstallCommand(commandArguments: [String]) throws -> CommandResult {
    let process = Process()
    process.executableURL = CodexSettingsInstaller.loginShellURL()
    process.arguments = commandArguments

    let errorPipe = Pipe()
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    let standardError =
      String(
        bytes: errorPipe.fileHandleForReading.readDataToEndOfFile(),
        encoding: .utf8
      ) ?? ""

    return .init(
      status: process.terminationStatus,
      standardError: standardError.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }
}

public enum SupatermSkillInstallerError: Error, Equatable, LocalizedError {
  case installFailed(String)
  case npxUnavailable

  public var errorDescription: String? {
    switch self {
    case .installFailed(let details):
      if details.isEmpty {
        return "Run \(SupatermSkillInstaller.manualInstallCommand) in a terminal to install the Supaterm skill."
      }
      return details
    case .npxUnavailable:
      return "Install Node.js tooling and run \(SupatermSkillInstaller.manualInstallCommand) in a terminal."
    }
  }
}
