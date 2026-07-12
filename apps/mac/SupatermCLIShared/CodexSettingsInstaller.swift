import Foundation

public struct CodexSettingsInstaller {
  typealias CommandResult = CodingAgentCommandResult

  private static let operationLock = NSLock()

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let runEnableHooksCommand: @Sendable () throws -> CommandResult
  let runVersionCommand: @Sendable () throws -> CodingAgentCommandResult
  let appServerClient: CodexAppServerClient

  public init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.init(
      homeDirectoryURL: homeDirectoryURL,
      fileManager: fileManager,
      runEnableHooksCommand: Self.runEnableHooksCommand,
      runVersionCommand: Self.runVersionCommand,
      appServerClient: CodexAppServerClient(homeDirectoryURL: homeDirectoryURL)
    )
  }

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    runEnableHooksCommand: @escaping @Sendable () throws -> CommandResult,
    runVersionCommand: @escaping @Sendable () throws -> CodingAgentCommandResult = {
      CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.1")
    },
    appServerClient: CodexAppServerClient? = nil
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.runEnableHooksCommand = runEnableHooksCommand
    self.runVersionCommand = runVersionCommand
    self.appServerClient = appServerClient ?? CodexAppServerClient(homeDirectoryURL: homeDirectoryURL)
  }

  public func installSupatermHooks() throws {
    Self.operationLock.lock()
    defer { Self.operationLock.unlock() }
    try installSupatermHooksLocked()
  }

  private func installSupatermHooksLocked() throws {
    switch try codexAvailability() {
    case .unavailable:
      throw CodexSettingsInstallerError.codexUnavailable
    case .unsupported:
      throw CodexSettingsInstallerError.unsupportedCodexVersion
    case .supported:
      break
    }
    let commandResult = try runEnableHooksCommand()
    guard commandResult.status == 0 else {
      throw CodexSettingsInstallerError.enableHooksFailed(commandResult.standardError)
    }

    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    var fileMutation: AgentHookSettingsFileInstaller.Mutation?
    do {
      let config = try appServerClient.readUserConfig(
        cwd: homeDirectoryURL,
        configURL: Self.configURL(homeDirectoryURL: homeDirectoryURL)
      )
      guard config.hooksFeatureEnabled else {
        throw CodexSettingsInstallerError.hooksFeatureDisabled
      }
      let oldHooks = try appServerClient.hooksList(cwd: homeDirectoryURL)
      fileMutation = try fileInstaller.install(
        settingsURL: settingsURL,
        hookGroupsByEvent: try SupatermCodexHookSettings.hookGroupsByEvent()
      )
      let newHooks = try appServerClient.hooksList(cwd: homeDirectoryURL)
      let managedHooks = try canonicalNativeHooks(
        newHooks,
        settingsURL: settingsURL
      )
      let hookState = try rebasedHookState(
        existing: config.hookState,
        oldHooks: oldHooks,
        newHooks: newHooks,
        managedHooks: managedHooks,
        settingsURL: settingsURL
      )
      if hookState != config.hookState {
        try replaceHookState(
          hookState,
          filePath: config.filePath,
          expectedVersion: config.version,
          configURL: Self.configURL(homeDirectoryURL: homeDirectoryURL)
        )
      }
    } catch CodexSettingsInstallerError.configWriteOutcomeUnknown(let message) {
      throw CodexSettingsInstallerError.configWriteOutcomeUnknown(message)
    } catch {
      do {
        try fileMutation?.rollback(fileManager: fileManager)
      } catch {
        throw CodexSettingsInstallerError.rollbackFailed(error.localizedDescription)
      }
      throw error
    }
  }

  public func integrationHealth() throws -> CodingAgentIntegrationHealth {
    Self.operationLock.lock()
    defer { Self.operationLock.unlock() }
    return try integrationHealthLocked()
  }

  private func integrationHealthLocked() throws -> CodingAgentIntegrationHealth {
    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let settingsHealth = try fileInstaller.integrationHealth(
      settingsURL: settingsURL,
      hookGroupsByEvent: SupatermCodexHookSettings.hookGroupsByEvent()
    )
    guard try codexAvailability() == .supported else {
      return settingsHealth == .absent ? .unavailable : .unavailableInstalled
    }
    guard settingsHealth == .healthy else {
      return settingsHealth
    }

    let hooks: [CodexAppServerHook]
    do {
      hooks = try canonicalNativeHooks(
        try appServerClient.hooksList(cwd: homeDirectoryURL),
        settingsURL: settingsURL
      )
    } catch CodexSettingsInstallerError.nativeHooksMismatch {
      return .drifted
    }
    let config = try appServerClient.readUserConfig(
      cwd: homeDirectoryURL,
      configURL: Self.configURL(homeDirectoryURL: homeDirectoryURL)
    )
    guard config.hooksFeatureEnabled else {
      return .drifted
    }
    guard
      hooks.allSatisfy({ $0.enabled && $0.trustStatus == "trusted" })
    else {
      return .drifted
    }
    return .healthy
  }

  public func removeSupatermHooks() throws {
    Self.operationLock.lock()
    defer { Self.operationLock.unlock() }
    try removeSupatermHooksLocked()
  }

  private func removeSupatermHooksLocked() throws {
    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    guard (try? codexAvailability()) == .supported else {
      try fileInstaller.removeSupatermHooks(settingsURL: settingsURL)
      return
    }

    let config: CodexAppServerUserConfig
    let oldHooks: [CodexAppServerHook]
    do {
      config = try appServerClient.readUserConfig(
        cwd: homeDirectoryURL,
        configURL: Self.configURL(homeDirectoryURL: homeDirectoryURL)
      )
      oldHooks = try appServerClient.hooksList(cwd: homeDirectoryURL)
    } catch CodexAppServerClientError.userConfigLayerMissing {
      try fileInstaller.removeSupatermHooks(settingsURL: settingsURL)
      return
    } catch {
      try fileInstaller.removeSupatermHooks(settingsURL: settingsURL)
      throw CodexSettingsInstallerError.trustCleanupFailed(error.localizedDescription)
    }

    try fileInstaller.removeSupatermHooks(settingsURL: settingsURL)
    do {
      let newHooks = try appServerClient.hooksList(cwd: homeDirectoryURL)
      let hookState = try rebasedHookState(
        existing: config.hookState,
        oldHooks: oldHooks,
        newHooks: newHooks,
        managedHooks: [],
        settingsURL: settingsURL
      )
      if hookState != config.hookState {
        try replaceHookState(
          hookState,
          filePath: config.filePath,
          expectedVersion: config.version,
          configURL: Self.configURL(homeDirectoryURL: homeDirectoryURL)
        )
      }
    } catch CodexSettingsInstallerError.configWriteOutcomeUnknown(let message) {
      throw CodexSettingsInstallerError.trustCleanupOutcomeUnknown(message)
    } catch {
      throw CodexSettingsInstallerError.trustCleanupFailed(error.localizedDescription)
    }
  }

  public static func settingsURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".codex", isDirectory: true)
      .appendingPathComponent("hooks.json", isDirectory: false)
  }

  public static func configURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".codex", isDirectory: true)
      .appendingPathComponent("config.toml", isDirectory: false)
  }

  static func runEnableHooksCommand() throws -> CommandResult {
    let environment = ProcessInfo.processInfo.environment
    if isTestHookInstallation(environment: environment) {
      return CodingAgentCommandResult(status: 0)
    }
    let result = try CodingAgentCommandRunner.run(arguments: enableHooksCommandArguments())
    if result.status == 127 {
      throw CodexSettingsInstallerError.codexUnavailable
    }
    return result
  }

  static func runVersionCommand() throws -> CodingAgentCommandResult {
    let environment = ProcessInfo.processInfo.environment
    if isTestHookInstallation(environment: environment) {
      return CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.1")
    }
    return try CodingAgentCommandRunner.run(arguments: versionCommandArguments())
  }

  static func enableHooksCommandArguments() -> [String] {
    LoginShellCommandAvailability.interactiveCommandArguments(
      for: "codex features enable hooks"
    )
  }

  static func versionCommandArguments() -> [String] {
    LoginShellCommandAvailability.interactiveCommandArguments(for: "codex --version")
  }

  private func codexAvailability() throws -> CodexAvailability {
    let result = try runVersionCommand()
    if result.status == 127 {
      return .unavailable
    }
    guard
      result.status == 0,
      let version = CodexVersion(output: result.standardOutput)
    else {
      return .unsupported
    }
    return version >= .minimum ? .supported : .unsupported
  }

  private func replaceHookState(
    _ hookState: JSONObject,
    filePath: String,
    expectedVersion: String?,
    configURL: URL
  ) throws {
    do {
      try appServerClient.replaceHookState(
        hookState,
        filePath: filePath,
        expectedVersion: expectedVersion
      )
    } catch {
      let config: CodexAppServerUserConfig
      do {
        config = try appServerClient.readUserConfig(
          cwd: homeDirectoryURL,
          configURL: configURL
        )
      } catch {
        throw CodexSettingsInstallerError.configWriteOutcomeUnknown(
          error.localizedDescription
        )
      }
      guard config.hookState != hookState else { return }
      throw error
    }
  }

  private func canonicalNativeHooks(
    _ hooks: [CodexAppServerHook],
    settingsURL: URL
  ) throws -> [CodexAppServerHook] {
    let expected = SupatermCodexHookSettings.nativeHookIdentities
    let settingsPath = canonicalPath(settingsURL)
    let owned = hooks.filter {
      canonicalPath(URL(fileURLWithPath: $0.sourcePath)) == settingsPath
        && $0.command == SupatermCodexHookSettings.command
    }
    guard
      owned.count == expected.count,
      Set(owned.map(CodexHookIdentity.init(hook:))) == expected,
      owned.allSatisfy({
        !$0.isManaged
          && stateKey($0.key, belongsToSourcePath: $0.sourcePath)
          && !$0.currentHash.isEmpty
      })
    else {
      throw CodexSettingsInstallerError.nativeHooksMismatch
    }
    return owned
  }

  private func rebasedHookState(
    existing: JSONObject,
    oldHooks: [CodexAppServerHook],
    newHooks: [CodexAppServerHook],
    managedHooks: [CodexAppServerHook],
    settingsURL: URL
  ) throws -> JSONObject {
    let settingsPath = canonicalPath(settingsURL)
    let oldSourceHooks = oldHooks.filter {
      canonicalPath(URL(fileURLWithPath: $0.sourcePath)) == settingsPath
    }
    let newSourceHooks = newHooks.filter {
      canonicalPath(URL(fileURLWithPath: $0.sourcePath)) == settingsPath
    }
    let oldUnrelated = oldSourceHooks.filter { !isManagedHook($0) }
    let newUnrelated = newSourceHooks.filter { !isManagedHook($0) }
    let oldOccurrences = hooksByOccurrence(oldUnrelated)
    let newOccurrences = hooksByOccurrence(newUnrelated)
    guard Set(oldOccurrences.keys) == Set(newOccurrences.keys) else {
      throw CodexSettingsInstallerError.nativeHooksMismatch
    }

    let movedStates = oldOccurrences.compactMap { occurrence, oldHook -> (String, JSONValue)? in
      guard
        let newHook = newOccurrences[occurrence],
        let value = hookState(existing[oldHook.key], for: oldHook)
      else {
        return nil
      }
      return (newHook.key, value)
    }
    let sourcePaths = Set((oldSourceHooks + newSourceHooks).map(\.sourcePath))
    var state = existing
    for key in state.keys
    where sourcePaths.contains(where: {
      stateKey(key, belongsToSourcePath: $0)
    }) {
      state.removeValue(forKey: key)
    }
    for (key, value) in movedStates {
      state[key] = value
    }
    for hook in managedHooks {
      state[hook.key] = ["trusted_hash": .string(hook.currentHash)]
    }
    return state
  }

  private func hookState(
    _ value: JSONValue?,
    for hook: CodexAppServerHook
  ) -> JSONValue? {
    guard var state = value?.objectValue else { return value }
    if let trustedHash = state["trusted_hash"]?.stringValue,
      trustedHash != hook.currentHash
    {
      state.removeValue(forKey: "trusted_hash")
    }
    return state.isEmpty ? nil : .object(state)
  }

  private func hooksByOccurrence(
    _ hooks: [CodexAppServerHook]
  ) -> [CodexHookOccurrence: CodexAppServerHook] {
    var counts: [CodexHookIdentity: Int] = [:]
    var result: [CodexHookOccurrence: CodexAppServerHook] = [:]
    for hook in hooks {
      let identity = CodexHookIdentity(hook: hook)
      let occurrence = counts[identity, default: 0]
      counts[identity] = occurrence + 1
      result[CodexHookOccurrence(identity: identity, index: occurrence)] = hook
    }
    return result
  }

  private func isManagedHook(_ hook: CodexAppServerHook) -> Bool {
    hook.command == SupatermCodexHookSettings.command
  }

  private func stateKey(_ key: String, belongsToSourcePath sourcePath: String) -> Bool {
    key.hasPrefix(sourcePath + ":")
  }

  private func canonicalPath(_ url: URL) -> String {
    url.standardizedFileURL.resolvingSymlinksInPath().path
  }

  private static func isTestHookInstallation(environment: [String: String]) -> Bool {
    environment[SupatermCLIEnvironment.testHomeKey] != nil
      && environment[SupatermCLIEnvironment.testCodexEnableHooksKey] == "1"
  }

  private var fileInstaller: AgentHookSettingsFileInstaller {
    AgentHookSettingsFileInstaller(
      fileManager: fileManager,
      errors: AgentHookSettingsFileInstaller.Errors(
        invalidEventHooks: { CodexSettingsInstallerError.invalidEventHooks($0) },
        invalidHooksObject: { CodexSettingsInstallerError.invalidHooksObject },
        invalidJSON: { CodexSettingsInstallerError.invalidJSON },
        invalidRootObject: { CodexSettingsInstallerError.invalidRootObject }
      )
    )
  }
}

private struct CodexHookOccurrence: Hashable {
  let identity: CodexHookIdentity
  let index: Int

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.identity == rhs.identity && lhs.index == rhs.index
  }

  func hash(into hasher: inout Hasher) {
    hasher.combine(identity)
    hasher.combine(index)
  }
}

private struct CodexVersion: Comparable {
  static let minimum = CodexVersion(major: 0, minor: 144, patch: 1)

  let major: Int
  let minor: Int
  let patch: Int

  init(major: Int, minor: Int, patch: Int) {
    self.major = major
    self.minor = minor
    self.patch = patch
  }

  init?(output: String) {
    guard
      let token = output.split(whereSeparator: \.isWhitespace).last,
      let stable = token.split(separator: "-", maxSplits: 1).first
    else {
      return nil
    }
    let components = stable.split(separator: ".")
    guard
      components.count == 3,
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

private enum CodexAvailability: Equatable {
  case unavailable
  case unsupported
  case supported
}

enum CodexSettingsInstallerError: Error, Equatable, LocalizedError {
  case codexUnavailable
  case configWriteOutcomeUnknown(String)
  case enableHooksFailed(String)
  case hooksFeatureDisabled
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject
  case nativeHooksMismatch
  case rollbackFailed(String)
  case trustCleanupFailed(String)
  case trustCleanupOutcomeUnknown(String)
  case unsupportedCodexVersion

  var errorDescription: String? {
    switch self {
    case .codexUnavailable:
      return "Codex must be installed and available in your login shell before Supaterm can install hooks."
    case .configWriteOutcomeUnknown(let message):
      return "Supaterm could not verify Codex's hook trust update: \(message)"
    case .enableHooksFailed(let details):
      if details.isEmpty {
        return "Supaterm could not enable the Codex hooks feature."
      }
      return "Supaterm could not enable the Codex hooks feature: \(details)"
    case .hooksFeatureDisabled:
      return "Codex did not enable the hooks feature."
    case .invalidEventHooks(let event):
      return "Codex hooks use an unsupported shape for \(event)."
    case .invalidHooksObject:
      return "Codex hooks use an unsupported shape."
    case .invalidJSON:
      return "Codex hooks must be valid JSON before Supaterm can install hooks."
    case .invalidRootObject:
      return "Codex hooks must be a JSON object before Supaterm can install hooks."
    case .nativeHooksMismatch:
      return "Codex did not discover the canonical Supaterm hooks."
    case .rollbackFailed(let message):
      return "Supaterm could not restore Codex hooks after a failed update: \(message)"
    case .trustCleanupFailed(let message):
      return "Supaterm removed Codex hooks, but could not remove their trust state: \(message)"
    case .trustCleanupOutcomeUnknown(let message):
      return "Supaterm removed Codex hooks, but could not verify whether Codex removed their trust state: \(message)"
    case .unsupportedCodexVersion:
      return "Codex 0.144.1 or newer is required before Supaterm can install hooks."
    }
  }
}
