import Foundation

public struct PiSettingsInstaller {
  typealias CommandResult = CodingAgentCommandResult

  private struct PackageFile: Decodable {
    let version: String
  }

  static let canonicalPackageSource = "git:github.com/supabitapp/supaterm-skills"
  private static let minimumPackageVersion = PiIntegrationVersion(major: 0, minor: 2, patch: 0)

  public static var canonicalInstallDisplayCommand: String {
    installDisplayCommand(source: canonicalPackageSource)
  }

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

  public func integrationHealth() throws -> CodingAgentIntegrationHealth {
    let sources = try installedSupatermPackageSources()
    guard try isPiAvailable() else {
      return sources.isEmpty ? .unavailable : .unavailableInstalled
    }
    guard !sources.isEmpty else { return .absent }
    if sources.count == 1, Self.isLocalPackageSource(sources[0]) {
      return .healthy
    }
    guard sources == [Self.canonicalPackageSource] else { return .drifted }
    guard let version = try? installedPackageVersion(),
      version >= Self.minimumPackageVersion
    else {
      return .drifted
    }
    return .healthy
  }

  public func installSupatermPackage() throws {
    guard try isPiAvailable() else {
      throw PiSettingsInstallerError.piUnavailable
    }

    let sources = try installedSupatermPackageSources()
    for source in sources where source != Self.canonicalPackageSource {
      try runInstallCommand(Self.removeCommandArguments(source: source))
    }
    let arguments =
      sources.contains(Self.canonicalPackageSource)
      ? Self.updateCommandArguments(source: Self.canonicalPackageSource)
      : Self.installCommandArguments(source: Self.canonicalPackageSource)
    try runInstallCommand(arguments)
  }

  public func removeSupatermPackage() throws {
    let sources = try installedSupatermPackageSources()
    guard !sources.isEmpty else { return }
    guard try isPiAvailable() else {
      try removeSupatermPackagesFromSettings()
      return
    }
    for source in sources {
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
    LoginShellCommandAvailability.commandArguments(for: ["pi"])
  }

  static func installCommandArguments(source: String) -> [String] {
    LoginShellCommandAvailability.interactiveCommandArguments(
      for: "pi install \(shellEscaped(source))"
    )
  }

  static func updateCommandArguments(source: String) -> [String] {
    LoginShellCommandAvailability.interactiveCommandArguments(
      for: "pi update \(shellEscaped(source))"
    )
  }

  public static func installDisplayCommand(source: String) -> String {
    "pi install \(source)"
  }

  static func removeCommandArguments(source: String) -> [String] {
    LoginShellCommandAvailability.interactiveCommandArguments(
      for: "pi remove \(shellEscaped(source))"
    )
  }

  static func isSupatermPackageSource(_ source: String) -> Bool {
    let normalizedSource = source.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedSource.isEmpty else {
      return false
    }
    if normalizedSource.contains("github.com/supabitapp/supaterm-skills")
      || normalizedSource.contains("github.com:supabitapp/supaterm-skills")
    {
      return true
    }
    guard
      normalizedSource.contains("/")
        || normalizedSource.hasPrefix(".")
        || normalizedSource.hasPrefix("~")
    else {
      return false
    }
    return packageName(for: normalizedSource) == "supaterm-skills"
  }

  static func isLocalPackageSource(_ source: String) -> Bool {
    let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
    return !["git:", "github:", "http:", "https:", "npm:", "ssh:"]
      .contains { source.hasPrefix($0) }
  }

  private static func packageName(for source: String) -> String {
    let lastPathComponent = URL(fileURLWithPath: source).lastPathComponent
    guard lastPathComponent.hasSuffix(".git") else {
      return lastPathComponent
    }
    return String(lastPathComponent.dropLast(4))
  }

  private func installedSupatermPackageSources() throws -> [String] {
    let settingsObject = try loadSettingsObject()
    guard let packagesValue = settingsObject["packages"] else { return [] }
    guard let packages = packagesValue.arrayValue else {
      throw PiSettingsInstallerError.invalidSettings
    }
    return packages.compactMap(Self.packageSource).filter(Self.isSupatermPackageSource)
  }

  private func removeSupatermPackagesFromSettings() throws {
    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    guard fileManager.fileExists(atPath: settingsURL.path) else { return }
    var settingsObject = try loadSettingsObject()
    guard let packagesValue = settingsObject["packages"] else { return }
    guard let packages = packagesValue.arrayValue else {
      throw PiSettingsInstallerError.invalidSettings
    }
    let remainingPackages = packages.filter { package in
      guard let source = Self.packageSource(package) else { return true }
      return !Self.isSupatermPackageSource(source)
    }
    guard remainingPackages != packages else { return }
    settingsObject["packages"] = .array(remainingPackages)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    try encoder.encode(JSONValue.object(settingsObject)).write(to: settingsURL, options: .atomic)
  }

  private func loadSettingsObject() throws -> JSONObject {
    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    guard fileManager.fileExists(atPath: settingsURL.path) else { return [:] }
    do {
      let value = try JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: settingsURL))
      guard let object = value.objectValue else {
        throw PiSettingsInstallerError.invalidSettings
      }
      return object
    } catch let error as PiSettingsInstallerError {
      throw error
    } catch {
      throw PiSettingsInstallerError.invalidSettings
    }
  }

  private static func packageSource(_ package: JSONValue) -> String? {
    package.stringValue ?? package.objectValue?["source"]?.stringValue
  }

  private func installedPackageVersion() throws -> PiIntegrationVersion? {
    let packageURL =
      homeDirectoryURL
      .appendingPathComponent(".pi/agent/git/github.com/supabitapp/supaterm-skills/package.json")
    guard fileManager.fileExists(atPath: packageURL.path) else { return nil }
    let package = try JSONDecoder().decode(PackageFile.self, from: Data(contentsOf: packageURL))
    return PiIntegrationVersion(package.version)
  }

  private func runInstallCommand(_ arguments: [String]) throws {
    let commandResult = try runPiCommand(arguments)
    guard commandResult.status == 0 else {
      throw PiSettingsInstallerError.installFailed(
        Self.commandFailureDetails(from: commandResult)
      )
    }
  }

  private static func runShellCommand(commandArguments: [String]) throws -> CommandResult {
    try CodingAgentCommandRunner.run(arguments: commandArguments)
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

private struct PiIntegrationVersion: Comparable {
  let major: Int
  let minor: Int
  let patch: Int

  init(major: Int, minor: Int, patch: Int) {
    self.major = major
    self.minor = minor
    self.patch = patch
  }

  init?(_ value: String) {
    let components = value.split(separator: ".")
    guard components.count == 3,
      let major = Int(components[0]),
      let minor = Int(components[1]),
      let patch = Int(components[2])
    else {
      return nil
    }
    self.init(major: major, minor: minor, patch: patch)
  }

  static func < (lhs: Self, rhs: Self) -> Bool {
    (lhs.major, lhs.minor, lhs.patch) < (rhs.major, rhs.minor, rhs.patch)
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
      return "Pi must be installed and available in your login shell before Supaterm can install or update the package."
    case .removeFailed(let details):
      if details.isEmpty {
        return "Supaterm could not remove the Pi package."
      }
      return "Supaterm could not remove the Pi package: \(details)"
    }
  }
}
