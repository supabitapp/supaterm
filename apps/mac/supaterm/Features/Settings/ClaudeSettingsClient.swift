import ComposableArchitecture
import Foundation
import SupatermCLIShared

struct ClaudeSettingsClient: Sendable {
  var installSupatermHooks: @Sendable () async throws -> Void
}

extension ClaudeSettingsClient: DependencyKey {
  static let liveValue = Self(
    installSupatermHooks: {
      try ClaudeSettingsInstaller().installSupatermHooks()
    }
  )

  static let testValue = Self(
    installSupatermHooks: {}
  )
}

extension DependencyValues {
  var claudeSettingsClient: ClaudeSettingsClient {
    get { self[ClaudeSettingsClient.self] }
    set { self[ClaudeSettingsClient.self] = newValue }
  }
}

nonisolated struct ClaudeSettingsInstaller {
  let homeDirectoryURL: URL
  let fileManager: FileManager

  init(
    homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
    fileManager: FileManager = .default
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.fileManager = fileManager
  }

  func installSupatermHooks() throws {
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
      .appendingPathComponent(".claude", isDirectory: true)
      .appendingPathComponent("settings.json", isDirectory: false)
  }

  private func loadSettingsObject(at url: URL) throws -> [String: JSONValue] {
    guard fileManager.fileExists(atPath: url.path) else {
      return [:]
    }

    let data = try Data(contentsOf: url)

    do {
      let jsonValue = try JSONDecoder().decode(JSONValue.self, from: data)
      guard let object = jsonValue.objectValue else {
        throw ClaudeSettingsInstallerError.invalidRootObject
      }
      return object
    } catch let error as ClaudeSettingsInstallerError {
      throw error
    } catch {
      throw ClaudeSettingsInstallerError.invalidJSON
    }
  }

  private func mergedSettingsObject(
    from settingsObject: [String: JSONValue]
  ) throws -> [String: JSONValue] {
    var mergedObject = settingsObject
    var hooksObject: [String: JSONValue]

    if let hooksValue = mergedObject["hooks"] {
      guard let existingHooksObject = hooksValue.objectValue else {
        throw ClaudeSettingsInstallerError.invalidHooksObject
      }
      hooksObject = existingHooksObject
    } else {
      hooksObject = [:]
    }

    for (event, canonicalGroups) in try SupatermClaudeHookSettings.hookGroupsByEvent() {
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
      throw ClaudeSettingsInstallerError.invalidEventHooks(event)
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
      return hookObject["command"]?.stringValue != SupatermClaudeHookSettings.command
    }

    guard !filteredHooks.isEmpty else {
      return nil
    }

    groupObject["hooks"] = .array(filteredHooks)
    return .object(groupObject)
  }
}

nonisolated enum ClaudeSettingsInstallerError: Error, Equatable, LocalizedError {
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
