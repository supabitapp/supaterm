import Foundation
import SupatermCLIShared

struct PiPackageSource: Hashable, Sendable {
  enum Identity: Hashable, Sendable {
    case git(host: String, path: String)
    case local(String)
    case npm(String)
  }

  let installedValue: String
  let identity: Identity

  init(_ installedValue: String, homeDirectoryURL: URL) {
    self.installedValue = installedValue
    if let packageName = Self.npmPackageName(for: installedValue) {
      identity = .npm(packageName)
    } else if let gitIdentity = Self.gitIdentity(for: installedValue) {
      identity = gitIdentity
    } else {
      identity = .local(
        Self.localPath(for: installedValue, homeDirectoryURL: homeDirectoryURL)
      )
    }
  }

  var isLocal: Bool {
    if case .local = identity {
      return true
    }
    return false
  }

  var isSupatermPackage: Bool {
    guard !installedValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      return false
    }
    let path =
      switch identity {
      case .git(_, let path), .local(let path): path
      case .npm(let packageName): packageName
      }
    return Self.packageName(for: path) == "supaterm-skills"
  }

  var removalValue: String {
    if case .local(let path) = identity {
      return path
    }
    return installedValue
  }

  private static func npmPackageName(for source: String) -> String? {
    guard source.hasPrefix("npm:") else { return nil }
    let spec = String(source.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines)
    guard let versionSeparator = spec.dropFirst().firstIndex(of: "@") else {
      return spec
    }
    return String(spec[..<versionSeparator])
  }

  private static func gitIdentity(for source: String) -> Identity? {
    let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
    let hasGitPrefix = source.hasPrefix("git:")
    let repository =
      hasGitPrefix
      ? String(source.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines)
      : source
    let lowercasedRepository = repository.lowercased()
    let hasExplicitProtocol = ["git://", "http://", "https://", "ssh://"]
      .contains { lowercasedRepository.hasPrefix($0) }
    guard hasGitPrefix || hasExplicitProtocol else { return nil }

    if hasGitPrefix,
      let separator = repository.firstIndex(of: ":"),
      let host = hostedGitDomain(for: String(repository[..<separator]))
    {
      let path = String(repository[repository.index(after: separator)...])
      return normalizedGitIdentity(host: host, path: path)
    }

    if repository.hasPrefix("git@"),
      let separator = repository.firstIndex(of: ":")
    {
      let host = String(
        repository[repository.index(repository.startIndex, offsetBy: 4)..<separator])
      let path = String(repository[repository.index(after: separator)...])
      return normalizedGitIdentity(host: host, path: path)
    }

    if hasExplicitProtocol,
      let components = URLComponents(string: repository),
      let host = components.host
    {
      return normalizedGitIdentity(host: host, path: components.path)
    }

    guard hasGitPrefix, let separator = repository.firstIndex(of: "/") else {
      return nil
    }
    let host = String(repository[..<separator])
    guard host.contains(".") || host == "localhost" else { return nil }
    let path = String(repository[repository.index(after: separator)...])
    return normalizedGitIdentity(host: host, path: path)
  }

  private static func hostedGitDomain(for shorthand: String) -> String? {
    switch shorthand.lowercased() {
    case "bitbucket": "bitbucket.org"
    case "gist": "gist.github.com"
    case "github": "github.com"
    case "gitlab": "gitlab.com"
    default: nil
    }
  }

  private static func normalizedGitIdentity(host: String, path: String) -> Identity? {
    let pathWithoutLeadingSlash = path.drop(while: { $0 == "/" })
    guard
      let pathWithoutRef = pathWithoutLeadingSlash.split(
        maxSplits: 1,
        whereSeparator: { $0 == "@" || $0 == "#" }
      ).first
    else { return nil }
    let normalizedPath =
      pathWithoutRef.hasSuffix(".git")
      ? pathWithoutRef.dropLast(4)
      : pathWithoutRef[...]
    guard !host.isEmpty, normalizedPath.split(separator: "/").count >= 2 else {
      return nil
    }
    return .git(host: host.lowercased(), path: String(normalizedPath))
  }

  private static func localPath(for source: String, homeDirectoryURL: URL) -> String {
    let source = source.trimmingCharacters(in: .whitespacesAndNewlines)
    let path =
      if let url = URL(string: source), url.isFileURL {
        url.path
      } else if source == "~" {
        homeDirectoryURL.path
      } else if source.hasPrefix("~/") {
        homeDirectoryURL.appendingPathComponent(String(source.dropFirst(2))).path
      } else {
        source
      }
    let url =
      NSString(string: path).isAbsolutePath
      ? URL(fileURLWithPath: path, isDirectory: true)
      : PiSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
        .deletingLastPathComponent()
        .appendingPathComponent(path, isDirectory: true)
    return url.standardizedFileURL.path
  }

  private static func packageName(for source: String) -> String {
    let lastPathComponent = URL(fileURLWithPath: source).lastPathComponent
    guard lastPathComponent.hasSuffix(".git") else {
      return lastPathComponent
    }
    return String(lastPathComponent.dropLast(4))
  }
}

enum PiPackageMutation: Equatable, Sendable {
  case install(PiPackageSource)
  case remove(PiPackageSource)
  case update(PiPackageSource)
}

struct PiPackageMutationExecutor: Sendable {
  typealias CommandResult = CodingAgentCommandResult

  let runCommand: @Sendable ([String], TimeInterval) throws -> CommandResult

  func run(
    _ mutation: PiPackageMutation,
    timeout: TimeInterval
  ) throws -> CommandResult {
    try runCommand(Self.commandArguments(for: mutation), timeout)
  }

  static func commandArguments(for mutation: PiPackageMutation) -> [String] {
    let operation: String
    let source: String
    switch mutation {
    case .install(let packageSource):
      operation = "install"
      source = packageSource.installedValue
    case .remove(let packageSource):
      operation = "remove"
      source = packageSource.removalValue
    case .update(let packageSource):
      operation = "update"
      source = packageSource.installedValue
    }
    return LoginShellCommandAvailability.interactiveCommandArguments(
      for: "pi \(operation) \(shellEscaped(source))"
    )
  }

  private static func shellEscaped(_ value: String) -> String {
    "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
  }
}

public struct PiSettingsInstaller {
  typealias CommandResult = CodingAgentCommandResult

  private struct PackageFile: Decodable {
    let version: String
  }

  static let canonicalPackageSource = "git:github.com/supabitapp/supaterm-skills"
  static let availabilityTimeout: TimeInterval = 10
  static let mutationTimeout: TimeInterval = 60
  static let maximumMutationsPerRequest = 3
  static let maximumSetupDuration =
    availabilityTimeout + mutationTimeout * TimeInterval(maximumMutationsPerRequest)
  private static let minimumPackageVersion = PiIntegrationVersion(major: 0, minor: 2, patch: 0)

  public static var canonicalInstallDisplayCommand: String {
    installDisplayCommand(source: canonicalPackageSource)
  }

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let checkPiAvailable: @Sendable () throws -> Bool
  let runPiMutation: @Sendable (PiPackageMutation, TimeInterval) throws -> CommandResult

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
    runPiCommand: @escaping @Sendable ([String], TimeInterval) throws -> CommandResult
  ) {
    let executor = PiPackageMutationExecutor(runCommand: runPiCommand)
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      checkPiAvailable: checkPiAvailable,
      runPiMutation: executor.run
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    checkPiAvailable: @escaping @Sendable () throws -> Bool,
    runPiMutation: @escaping @Sendable (PiPackageMutation, TimeInterval) throws -> CommandResult
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.checkPiAvailable = checkPiAvailable
    self.runPiMutation = runPiMutation
  }

  public func isPiAvailable() throws -> Bool {
    try checkPiAvailable()
  }

  public func hasSupatermPackageInstalled() throws -> Bool {
    try !installedSupatermPackageSources().isEmpty
  }

  public func integrationHealth() throws -> CodingAgentIntegrationHealth {
    let sources = try installedSupatermPackageSources()
    return try integrationHealth(for: sources, isPiAvailable: isPiAvailable())
  }

  private func integrationHealth(
    for sources: [PiPackageSource],
    isPiAvailable: Bool
  ) throws -> CodingAgentIntegrationHealth {
    guard isPiAvailable else {
      return sources.isEmpty ? .unavailable : .unavailableInstalled
    }
    guard !sources.isEmpty else { return .absent }
    if sources.count == 1, sources[0].isLocal {
      return .healthy
    }
    guard sources.map(\.installedValue) == [Self.canonicalPackageSource] else { return .drifted }
    guard let version = try? installedPackageVersion(),
      version >= Self.minimumPackageVersion
    else {
      return .drifted
    }
    return .healthy
  }

  public func setup() throws -> CodingAgentIntegrationHealth {
    guard try isPiAvailable() else { return .unavailable }
    let sources = try installedSupatermPackageSources()
    let plan = try setupMutationPlan(for: sources)
    try runInstallPlan(plan)
    return try integrationHealth(
      for: installedSupatermPackageSources(),
      isPiAvailable: true
    )
  }

  public func installSupatermPackage() throws {
    let sources = try installedSupatermPackageSources()
    let plan = try installMutationPlan(for: sources)
    guard try isPiAvailable() else {
      throw PiSettingsInstallerError.piUnavailable
    }
    try runInstallPlan(plan)
  }

  public func removeSupatermPackage() throws {
    let sources = try installedSupatermPackageSources()
    let sourcesToRemove = uniquePackageSourcesByIdentity(sources)
    guard !sourcesToRemove.isEmpty else { return }
    guard try isPiAvailable() else {
      try removeSupatermPackagesFromSettings()
      return
    }
    try Self.validateMutationCount(sourcesToRemove.count)
    for source in sourcesToRemove {
      let commandResult = try runMutationCommand(.remove(source))
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
    try CodingAgentCommandRunner.run(
      arguments: piAvailabilityCommandArguments(),
      timeout: availabilityTimeout
    ).status == 0
  }

  static func runPiCommand(
    commandArguments: [String],
    timeout: TimeInterval
  ) throws -> CommandResult {
    try CodingAgentCommandRunner.run(arguments: commandArguments, timeout: timeout)
  }

  static func piAvailabilityCommandArguments() -> [String] {
    LoginShellCommandAvailability.commandArguments(for: ["pi"])
  }

  public static func installDisplayCommand(source: String) -> String {
    "pi install \(source)"
  }

  private func installedSupatermPackageSources() throws -> [PiPackageSource] {
    let settingsObject = try loadSettingsObject()
    guard let packagesValue = settingsObject["packages"] else { return [] }
    guard let packages = packagesValue.arrayValue else {
      throw PiSettingsInstallerError.invalidSettings
    }
    return
      packages
      .compactMap(Self.packageSource)
      .map { PiPackageSource($0, homeDirectoryURL: homeDirectoryURL) }
      .filter(\.isSupatermPackage)
  }

  private func setupMutationPlan(for sources: [PiPackageSource]) throws -> [PiPackageMutation] {
    if sources.count == 1 {
      let source = sources[0]
      if source.isLocal {
        return []
      }
      if source.installedValue == Self.canonicalPackageSource,
        let version = try? installedPackageVersion(),
        version >= Self.minimumPackageVersion
      {
        return []
      }
    }
    return try installMutationPlan(for: sources)
  }

  private func installMutationPlan(
    for sources: [PiPackageSource]
  ) throws -> [PiPackageMutation] {
    let canonicalSource = PiPackageSource(
      Self.canonicalPackageSource,
      homeDirectoryURL: homeDirectoryURL
    )
    let canonicalSources = sources.filter { $0.identity == canonicalSource.identity }
    let plan: [PiPackageMutation]
    if canonicalSources.map(\.installedValue) == [Self.canonicalPackageSource] {
      let sourcesToRemove = uniquePackageSourcesByIdentity(
        sources.filter { $0.identity != canonicalSource.identity }
      )
      plan = sourcesToRemove.map(PiPackageMutation.remove) + [.update(canonicalSource)]
    } else {
      plan =
        uniquePackageSourcesByIdentity(sources).map(PiPackageMutation.remove)
        + [.install(canonicalSource)]
    }
    try Self.validateMutationCount(plan.count)
    return plan
  }

  private func uniquePackageSourcesByIdentity(
    _ sources: [PiPackageSource]
  ) -> [PiPackageSource] {
    var identities: Set<PiPackageSource.Identity> = []
    return sources.compactMap { source in
      guard identities.insert(source.identity).inserted else { return nil }
      return source
    }
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
      return !PiPackageSource(source, homeDirectoryURL: homeDirectoryURL).isSupatermPackage
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

  private func runInstallPlan(_ plan: [PiPackageMutation]) throws {
    for mutation in plan {
      let commandResult = try runMutationCommand(mutation)
      guard commandResult.status == 0 else {
        throw PiSettingsInstallerError.installFailed(
          Self.commandFailureDetails(from: commandResult)
        )
      }
    }
  }

  private func runMutationCommand(_ mutation: PiPackageMutation) throws -> CommandResult {
    try runPiMutation(mutation, Self.mutationTimeout)
  }

  private static func commandFailureDetails(from commandResult: CommandResult) -> String {
    let details = [commandResult.standardError, commandResult.standardOutput]
      .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
      .first { !$0.isEmpty }
    return details ?? ""
  }

  private static func validateMutationCount(_ count: Int) throws {
    guard count <= maximumMutationsPerRequest else {
      throw PiSettingsInstallerError.tooManyPackageSources
    }
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
  case tooManyPackageSources

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
      return
        "Pi must be installed and available in your login shell before Supaterm can install or update the package."
    case .removeFailed(let details):
      if details.isEmpty {
        return "Supaterm could not remove the Pi package."
      }
      return "Supaterm could not remove the Pi package: \(details)"
    case .tooManyPackageSources:
      let limit = PiSettingsInstaller.maximumMutationsPerRequest
      return
        "Supaterm can run at most \(limit) Pi package changes at once. Remove package sources before trying again."
    }
  }
}
