import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct CodexSettingsClient: Sendable {
  var installSupatermHooks: @Sendable () async throws -> Void
}

extension CodexSettingsClient: DependencyKey {
  static let liveValue = Self(
    installSupatermHooks: {
      try CodexSettingsInstaller().installSupatermHooks()
    }
  )

  static let testValue = Self(
    installSupatermHooks: {}
  )
}

extension DependencyValues {
  var codexSettingsClient: CodexSettingsClient {
    get { self[CodexSettingsClient.self] }
    set { self[CodexSettingsClient.self] = newValue }
  }
}

nonisolated struct CodexSettingsInstaller {
  struct CommandResult: Equatable, Sendable {
    let status: Int32
    let standardError: String
  }

  let homeDirectoryURL: URL
  let fileManager: FileManager
  let runEnableHooksCommand: @Sendable () throws -> CommandResult

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default,
    runEnableHooksCommand: @escaping @Sendable () throws -> CommandResult = Self.runEnableHooksCommand
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
    self.runEnableHooksCommand = runEnableHooksCommand
  }

  func installSupatermHooks() throws {
    let commandResult = try runEnableHooksCommand()
    guard commandResult.status == 0 else {
      throw CodexSettingsInstallerError.enableHooksFailed(commandResult.standardError)
    }

    let settingsURL = Self.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let settingsObject = try loadSettingsObject(at: settingsURL)
    let mergedObject = try mergedSettingsObject(from: settingsObject)
    try fileManager.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(JSONValue.object(mergedObject))
    try data.write(to: settingsURL, options: .atomic)
  }

  static func settingsURL(homeDirectoryURL: URL) -> URL {
    homeDirectoryURL
      .appendingPathComponent(".codex", isDirectory: true)
      .appendingPathComponent("hooks.json", isDirectory: false)
  }

  static func runEnableHooksCommand() throws -> CommandResult {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/bin/zsh")
    process.arguments = [
      "-l",
      "-c",
      "command -v codex >/dev/null 2>&1 || exit 127; exec codex features enable codex_hooks",
    ]

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
    return .init(status: status, standardError: standardError.trimmingCharacters(in: .whitespacesAndNewlines))
  }

  private func loadSettingsObject(at url: URL) throws -> [String: JSONValue] {
    guard fileManager.fileExists(atPath: url.path) else {
      return [:]
    }

    let data = try Data(contentsOf: url)

    do {
      let jsonValue = try JSONDecoder().decode(JSONValue.self, from: data)
      guard let object = jsonValue.objectValue else {
        throw CodexSettingsInstallerError.invalidRootObject
      }
      return object
    } catch let error as CodexSettingsInstallerError {
      throw error
    } catch {
      throw CodexSettingsInstallerError.invalidJSON
    }
  }

  private func mergedSettingsObject(
    from settingsObject: [String: JSONValue]
  ) throws -> [String: JSONValue] {
    var mergedObject = settingsObject
    var hooksObject: [String: JSONValue]

    if let hooksValue = mergedObject["hooks"] {
      guard let existingHooksObject = hooksValue.objectValue else {
        throw CodexSettingsInstallerError.invalidHooksObject
      }
      hooksObject = existingHooksObject
    } else {
      hooksObject = [:]
    }

    for (event, canonicalGroups) in try SupatermCodexHookSettings.hookGroupsByEvent() {
      let existingGroups = try existingGroups(for: event, hooksObject: hooksObject)
      let filteredGroups = existingGroups.compactMap(prunedGroup(_:))
      hooksObject[event] = .array(filteredGroups + canonicalGroups)
    }

    mergedObject["hooks"] = .object(hooksObject)
    return mergedObject
  }

  private func existingGroups(
    for event: String,
    hooksObject: [String: JSONValue]
  ) throws -> [JSONValue] {
    guard let existingValue = hooksObject[event] else {
      return []
    }
    guard let groups = existingValue.arrayValue else {
      throw CodexSettingsInstallerError.invalidEventHooks(event)
    }
    return groups
  }

  private func prunedGroup(_ group: JSONValue) -> JSONValue? {
    guard var groupObject = group.objectValue else {
      return group
    }
    guard let hooksValue = groupObject["hooks"] else {
      return group
    }
    guard let hooks = hooksValue.arrayValue else {
      return group
    }

    let filteredHooks = hooks.filter { hook in
      guard let hookObject = hook.objectValue else {
        return true
      }
      return !AgentHookCommandOwnership.isSupatermManagedCommand(hookObject["command"]?.stringValue)
    }

    guard !filteredHooks.isEmpty else {
      return nil
    }

    groupObject["hooks"] = .array(filteredHooks)
    return .object(groupObject)
  }
}

nonisolated enum CodexSettingsInstallerError: Error, Equatable, LocalizedError {
  case codexUnavailable
  case enableHooksFailed(String)
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject

  var errorDescription: String? {
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
