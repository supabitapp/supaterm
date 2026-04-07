import Darwin
import Foundation

public struct PiSettingsInstaller {
  struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardOutput: String
    let standardError: String
  }

  private struct SettingsFile: Decodable {
    let packages: [String]?
  }

  static let canonicalPackageSource = "git:github.com/supabitapp/supaterm"

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let checkPiAvailable: @Sendable () throws -> Bool
  let runPiCommand: @Sendable ([String]) throws -> CommandResult

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      checkPiAvailable: Self.checkPiAvailable,
      runPiCommand: Self.runPiCommand
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    checkPiAvailable: @escaping @Sendable () throws -> Bool,
    runPiCommand: @escaping @Sendable ([String]) throws -> CommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.checkPiAvailable = checkPiAvailable
    self.runPiCommand = runPiCommand
  }

  public func isPiAvailable() throws -> Bool {
    try checkPiAvailable()
  }

  public func hasSupatermPackageInstalled() throws -> Bool {
    try !installedSupatermPackageSources().isEmpty
  }

  public func installSupatermPackage() throws {
    guard try isPiAvailable() else {
      throw PiSettingsInstallerError.piUnavailable
    }

    let commandResult = try runPiCommand(
      Self.installCommandArguments(source: Self.canonicalPackageSource)
    )
    guard commandResult.status == 0 else {
      throw PiSettingsInstallerError.installFailed(
        Self.commandFailureDetails(from: commandResult)
      )
    }
  }

  public func removeSupatermPackage() throws {
    guard try isPiAvailable() else {
      throw PiSettingsInstallerError.piUnavailable
    }

    for source in try installedSupatermPackageSources() {
      let commandResult = try runPiCommand(
        Self.removeCommandArguments(source: source)
      )
      guard commandResult.status == 0 else {
        throw PiSettingsInstallerError.removeFailed(
          Self.commandFailureDetails(from: commandResult)
        )
      }
    }
  }

  public static func settingsURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".pi", isDirectory: true)
      .appendingPathComponent("agent", isDirectory: true)
      .appendingPathComponent("settings.json", isDirectory: false)
  }

  static func checkPiAvailable() throws -> Bool {
    try runShellCommand(commandArguments: piAvailabilityCommandArguments()).status == 0
  }

  static func runPiCommand(commandArguments: [String]) throws -> CommandResult {
    try runShellCommand(commandArguments: commandArguments)
  }

  static func piAvailabilityCommandArguments() -> [String] {
    ["-l", "-c", "command -v pi >/dev/null 2>&1"]
  }

  static func installCommandArguments(source: String) -> [String] {
    ["-l", "-c", "pi install \(shellEscaped(source))"]
  }

  static func removeCommandArguments(source: String) -> [String] {
    ["-l", "-c", "pi remove \(shellEscaped(source))"]
  }

  static func isSupatermPackageSource(_ source: String) -> Bool {
    let normalizedSource = source.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedSource.isEmpty else {
      return false
    }
    if normalizedSource.contains("github.com/supabitapp/supaterm") {
      return true
    }
    guard
      normalizedSource.contains("/")
        || normalizedSource.hasPrefix(".")
        || normalizedSource.hasPrefix("~")
    else {
      return false
    }
    return URL(fileURLWithPath: normalizedSource).lastPathComponent == "supaterm"
  }

  private func installedSupatermPackageSources() throws -> [String] {
    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    guard fileManager.fileExists(atPath: settingsURL.path) else {
      return []
    }

    let data = try Data(contentsOf: settingsURL)
    let settingsFile: SettingsFile
    do {
      settingsFile = try JSONDecoder().decode(SettingsFile.self, from: data)
    } catch {
      throw PiSettingsInstallerError.invalidSettings
    }

    return (settingsFile.packages ?? []).filter(Self.isSupatermPackageSource)
  }

  private static func runShellCommand(commandArguments: [String]) throws -> CommandResult {
    let process = Process()
    process.executableURL = CodexSettingsInstaller.loginShellURL()
    process.arguments = commandArguments

    let outputPipe = Pipe()
    let errorPipe = Pipe()
    process.standardOutput = outputPipe
    process.standardError = errorPipe

    try process.run()
    process.waitUntilExit()

    return .init(
      status: process.terminationStatus,
      standardOutput: normalizedPipeOutput(outputPipe),
      standardError: normalizedPipeOutput(errorPipe)
    )
  }

  private static func normalizedPipeOutput(_ pipe: Pipe) -> String {
    String(
      bytes: pipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    )?
    .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  }

  private static func commandFailureDetails(from commandResult: CommandResult) -> String {
    let details = [commandResult.standardError, commandResult.standardOutput]
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .first { !$0.isEmpty }
    return details ?? ""
  }

  private static func shellEscaped(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }
}

public enum PiSettingsInstallerError: Error, Equatable, LocalizedError {
  case installFailed(String)
  case invalidSettings
  case piUnavailable
  case removeFailed(String)

  public var errorDescription: String? {
    switch self {
    case .installFailed(let details):
      if details.isEmpty {
        return "Supaterm could not install the Pi package."
      }
      return "Supaterm could not install the Pi package: \(details)"
    case .invalidSettings:
      return "Pi settings must be valid JSON before Supaterm can manage the package."
    case .piUnavailable:
      return "Pi must be installed and available in your login shell before Supaterm can manage the package."
    case .removeFailed(let details):
      if details.isEmpty {
        return "Supaterm could not remove the Pi package."
      }
      return "Supaterm could not remove the Pi package: \(details)"
    }
  }
}
