import Foundation

struct AgentHookSettingsFileInstaller {
  struct Mutation {
    let url: URL
    let previousData: Data?
    let writtenData: Data

    func rollback(fileManager: FileManager) throws {
      let currentData = fileManager.fileExists(atPath: url.path) ? try Data(contentsOf: url) : nil
      guard currentData == writtenData else { return }
      if let previousData {
        try previousData.write(to: url, options: .atomic)
      } else {
        try fileManager.removeItem(at: url)
      }
    }
  }

  struct Errors {
    let invalidEventHooks: @Sendable (String) -> Error
    let invalidHooksObject: @Sendable () -> Error
    let invalidJSON: @Sendable () -> Error
    let invalidRootObject: @Sendable () -> Error
  }

  private enum LoadError: Error {
    case invalidRootObject
  }

  let fileManager: FileManager
  let errors: Errors

  @discardableResult
  func install(
    settingsURL: URL,
    hookGroupsByEvent: @autoclosure () throws -> [String: [JSONValue]]
  ) throws -> Mutation {
    let loadedSettings = try loadSettings(at: settingsURL)
    let mergedObject = try mergedSettingsObject(
      from: loadedSettings.object,
      hookGroupsByEvent: try hookGroupsByEvent()
    )
    try fileManager.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(JSONValue.object(mergedObject))
    try data.write(to: settingsURL, options: .atomic)
    return Mutation(
      url: settingsURL,
      previousData: loadedSettings.data,
      writtenData: data
    )
  }

  func integrationHealth(
    settingsURL: URL,
    hookGroupsByEvent: [String: [JSONValue]]
  ) throws -> CodingAgentIntegrationHealth {
    let settingsObject = try loadSettingsObject(at: settingsURL)
    guard let hooksValue = settingsObject["hooks"] else {
      return .absent
    }
    guard let hooksObject = hooksValue.objectValue else {
      throw errors.invalidHooksObject()
    }

    var remainingCanonicalGroups = hookGroupsByEvent
    var foundManagedHook = false
    var foundDrift = false

    for (event, value) in hooksObject {
      guard let groups = value.arrayValue else {
        throw errors.invalidEventHooks(event)
      }
      for group in groups where groupContainsManagedHooks(group) {
        foundManagedHook = true
        guard
          let index = remainingCanonicalGroups[event]?.firstIndex(of: group)
        else {
          foundDrift = true
          continue
        }
        remainingCanonicalGroups[event]?.remove(at: index)
      }
    }

    guard foundManagedHook else {
      return .absent
    }
    guard !foundDrift else {
      return .drifted
    }
    return remainingCanonicalGroups.values.allSatisfy(\.isEmpty) ? .healthy : .partial
  }

  func removeSupatermHooks(settingsURL: URL) throws {
    guard fileManager.fileExists(atPath: settingsURL.path) else {
      return
    }
    let settingsObject = try loadSettingsObject(at: settingsURL)
    let prunedObject = try settingsObjectByRemovingManagedHooks(from: settingsObject)
    try fileManager.createDirectory(
      at: settingsURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )

    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(JSONValue.object(prunedObject))
    try data.write(to: settingsURL, options: .atomic)
  }

  private func loadSettingsObject(at url: URL) throws -> [String: JSONValue] {
    try loadSettings(at: url).object
  }

  private func loadSettings(at url: URL) throws -> (
    object: [String: JSONValue],
    data: Data?
  ) {
    guard fileManager.fileExists(atPath: url.path) else {
      return ([:], nil)
    }

    let data = try Data(contentsOf: url)

    do {
      let jsonValue = try JSONDecoder().decode(JSONValue.self, from: data)
      guard let object = jsonValue.objectValue else {
        throw LoadError.invalidRootObject
      }
      return (object, data)
    } catch LoadError.invalidRootObject {
      throw errors.invalidRootObject()
    } catch {
      throw errors.invalidJSON()
    }
  }

  private func mergedSettingsObject(
    from settingsObject: [String: JSONValue],
    hookGroupsByEvent: [String: [JSONValue]]
  ) throws -> [String: JSONValue] {
    var mergedObject = try settingsObjectByRemovingManagedHooks(from: settingsObject)
    let hooksObject = mergedObject["hooks"]?.objectValue ?? [:]
    var mergedHooksObject = hooksObject

    for (event, canonicalGroups) in hookGroupsByEvent {
      let existingGroups = try existingGroups(for: event, hooksObject: mergedHooksObject)
      mergedHooksObject[event] = .array(existingGroups + canonicalGroups)
    }

    mergedObject["hooks"] = .object(mergedHooksObject)
    return mergedObject
  }

  private func settingsObjectByRemovingManagedHooks(
    from settingsObject: [String: JSONValue]
  ) throws -> [String: JSONValue] {
    var prunedObject = settingsObject
    guard let hooksValue = prunedObject["hooks"] else {
      return prunedObject
    }
    guard let hooksObject = hooksValue.objectValue else {
      throw errors.invalidHooksObject()
    }

    var prunedHooksObject: [String: JSONValue] = [:]
    for (event, value) in hooksObject {
      guard let groups = value.arrayValue else {
        throw errors.invalidEventHooks(event)
      }
      let filteredGroups = groups.compactMap(prunedGroup(_:))
      guard !filteredGroups.isEmpty else {
        continue
      }
      prunedHooksObject[event] = .array(filteredGroups)
    }

    if prunedHooksObject.isEmpty {
      prunedObject.removeValue(forKey: "hooks")
    } else {
      prunedObject["hooks"] = .object(prunedHooksObject)
    }
    return prunedObject
  }

  private func existingGroups(
    for event: String,
    hooksObject: [String: JSONValue]
  ) throws -> [JSONValue] {
    guard let existingValue = hooksObject[event] else {
      return []
    }
    guard let groups = existingValue.arrayValue else {
      throw errors.invalidEventHooks(event)
    }
    return groups
  }

  private func groupContainsManagedHooks(_ group: JSONValue) -> Bool {
    guard
      let groupObject = group.objectValue,
      let hooksValue = groupObject["hooks"],
      let hooks = hooksValue.arrayValue
    else {
      return false
    }

    return hooks.contains { hook in
      guard let hookObject = hook.objectValue else {
        return false
      }
      return AgentHookCommandOwnership.isSupatermManagedCommand(hookObject["command"]?.stringValue)
    }
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
