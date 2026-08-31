import Foundation
import Testing

@testable import SupatermCLIShared
@testable import SupatermSupport

let canonicalCodexHookEvents: Set<String> = [
  "PermissionRequest",
  "PostToolUse",
  "PreToolUse",
  "SessionStart",
  "Stop",
  "SubagentStart",
  "SubagentStop",
  "UserPromptSubmit",
]

func temporaryCodexHomeDirectory() throws -> URL {
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  return url
}

func testCodexSettingsInstaller(
  homeDirectoryURL: URL = FileManager.default.homeDirectoryForCurrentUser,
  fileManager: FileManager = .default,
  runEnableHooksCommand: @escaping @Sendable () throws -> CodingAgentCommandResult,
  runVersionCommand: @escaping @Sendable () throws -> CodingAgentCommandResult = {
    CodingAgentCommandResult(status: 0, standardOutput: "codex-cli 0.144.1")
  },
  runHooksFeatureCommand: @escaping @Sendable () throws -> CodingAgentCommandResult = {
    CodingAgentCommandResult(status: 0, standardOutput: "hooks stable true")
  },
  appServer: TestCodexAppServer? = nil
) -> CodexSettingsInstaller {
  let appServer =
    appServer
    ?? TestCodexAppServer(
      homeDirectoryURL: homeDirectoryURL,
      hooksFeatureEnabled: {
        let result = try runHooksFeatureCommand()
        return result.status == 0
          && result.standardOutput.split(whereSeparator: \.isWhitespace).last == "true"
      }
    )
  return CodexSettingsInstaller(
    homeDirectoryURL: homeDirectoryURL,
    fileManager: fileManager,
    runEnableHooksCommand: runEnableHooksCommand,
    runVersionCommand: runVersionCommand,
    appServerClient: appServer.client
  )
}

nonisolated final class TestCodexAppServer: @unchecked Sendable {
  private let homeDirectoryURL: URL
  private let hooksFeatureEnabled: @Sendable () throws -> Bool
  private let duplicateSourcePath: String?
  private let rejectsConfigRead: Bool
  private let rejectsConfigReadAfterBatchWrite: Bool
  private let rejectsHooksListAfterBatchWrite: Bool
  private let rejectsBatchWrite: Bool
  private let rejectsBatchWriteAfterCommit: Bool
  private let afterFirstHooksList: @Sendable () throws -> Void
  private let beforeBatchWriteResponse: @Sendable (TestCodexAppServer) throws -> Void
  private let lock = NSLock()
  private var batchKeyPaths: [[String]] = []
  private var config: JSONObject
  private var configReadCount = 0
  private var didWriteBatch = false
  private var hooksListCount = 0
  private var version = 1

  init(
    homeDirectoryURL: URL,
    hookState: JSONObject = [:],
    duplicateSourcePath: String? = nil,
    rejectsConfigRead: Bool = false,
    rejectsConfigReadAfterBatchWrite: Bool = false,
    rejectsHooksListAfterBatchWrite: Bool = false,
    rejectsBatchWrite: Bool = false,
    rejectsBatchWriteAfterCommit: Bool = false,
    afterFirstHooksList: @escaping @Sendable () throws -> Void = {},
    beforeBatchWriteResponse: @escaping @Sendable (TestCodexAppServer) throws -> Void = { _ in },
    terminalTitle: JSONValue? = nil,
    hooksFeatureEnabled: @escaping @Sendable () throws -> Bool = { true }
  ) {
    var config: JSONObject = ["hooks": ["state": .object(hookState)]]
    if let terminalTitle {
      config["tui"] = ["terminal_title": terminalTitle]
    }
    self.homeDirectoryURL = homeDirectoryURL
    self.config = config
    self.duplicateSourcePath = duplicateSourcePath
    self.rejectsConfigRead = rejectsConfigRead
    self.rejectsConfigReadAfterBatchWrite = rejectsConfigReadAfterBatchWrite
    self.rejectsHooksListAfterBatchWrite = rejectsHooksListAfterBatchWrite
    self.rejectsBatchWrite = rejectsBatchWrite
    self.rejectsBatchWriteAfterCommit = rejectsBatchWriteAfterCommit
    self.afterFirstHooksList = afterFirstHooksList
    self.beforeBatchWriteResponse = beforeBatchWriteResponse
    self.hooksFeatureEnabled = hooksFeatureEnabled
  }

  var client: CodexAppServerClient {
    CodexAppServerClient(request: request(method:params:))
  }

  func request(method: String, params: JSONObject) throws -> JSONValue {
    switch method {
    case "hooks/list":
      let response = try hooksListResponse()
      lock.lock()
      hooksListCount += 1
      let isFirst = hooksListCount == 1
      lock.unlock()
      if isFirst {
        try afterFirstHooksList()
      }
      return response
    case "config/read":
      return try configReadResponse()
    case "config/batchWrite":
      return try batchWriteResponse(params: params)
    default:
      throw CodexAppServerClientError.serverRejected(method)
    }
  }

  func state() -> JSONObject {
    lock.lock()
    let result = config["hooks"]?.objectValue?["state"]?.objectValue ?? [:]
    lock.unlock()
    return result
  }

  func terminalTitle() -> JSONValue? {
    lock.lock()
    let result = config["tui"]?.objectValue?["terminal_title"]
    lock.unlock()
    return result
  }

  func batchWriteCount() -> Int {
    lock.lock()
    let result = batchKeyPaths.count
    lock.unlock()
    return result
  }

  func batchWriteKeyPaths() -> [[String]] {
    lock.lock()
    let result = batchKeyPaths
    lock.unlock()
    return result
  }

  func userConfigReadCount() -> Int {
    lock.lock()
    let result = configReadCount
    lock.unlock()
    return result
  }

  func setTerminalTitle(_ value: JSONValue) {
    lock.lock()
    Self.set(value, at: ["tui", "terminal_title"], in: &config)
    version += 1
    lock.unlock()
  }

  private func hooksListResponse() throws -> JSONValue {
    lock.lock()
    let shouldReject = rejectsHooksListAfterBatchWrite && didWriteBatch
    lock.unlock()
    if shouldReject {
      throw CodexAppServerClientError.serverRejected("hooks/list")
    }
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let root = try? JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: settingsURL))
    let hooksObject = root?.objectValue?["hooks"]?.objectValue ?? [:]
    lock.lock()
    let hookState = config["hooks"]?.objectValue?["state"]?.objectValue ?? [:]
    lock.unlock()
    var metadata: [JSONValue] = []
    var displayOrder = 0
    for event in hooksObject.keys.sorted() {
      guard let groups = hooksObject[event]?.arrayValue else { continue }
      for (groupIndex, group) in groups.enumerated() {
        guard
          let groupObject = group.objectValue,
          let hooks = groupObject["hooks"]?.arrayValue
        else {
          continue
        }
        for (hookIndex, hook) in hooks.enumerated() {
          guard
            let hookObject = hook.objectValue,
            let command = hookObject["command"]?.stringValue,
            let timeout = hookObject["timeout"]?.intValue
          else {
            continue
          }
          let eventName = nativeEventName(event)
          let eventKey = nativeEventKey(event)
          let key = "\(settingsURL.path):\(eventKey):\(groupIndex):\(hookIndex)"
          let hash = "sha256:\(eventKey):\(groupIndex):\(hookIndex):\(command):\(timeout)"
          let state = hookState[key]?.objectValue
          metadata.append(
            [
              "key": .string(key),
              "eventName": .string(eventName),
              "handlerType": "command",
              "matcher": groupObject["matcher"] ?? .null,
              "command": .string(command),
              "timeoutSec": .int(timeout),
              "statusMessage": hookObject["statusMessage"] ?? .null,
              "sourcePath": .string(settingsURL.path),
              "source": "user",
              "pluginId": nil,
              "displayOrder": .int(displayOrder),
              "enabled": .bool(state?["enabled"]?.boolValue != false),
              "isManaged": false,
              "currentHash": .string(hash),
              "trustStatus": .string(
                state?["trusted_hash"]?.stringValue == hash ? "trusted" : "untrusted"
              ),
            ]
          )
          displayOrder += 1
        }
      }
    }
    if let duplicateSourcePath {
      metadata += metadata.compactMap { value in
        guard var object = value.objectValue else { return nil }
        object["sourcePath"] = .string(duplicateSourcePath)
        if let key = object["key"]?.stringValue {
          object["key"] = .string(
            duplicateSourcePath + key.dropFirst(settingsURL.path.count)
          )
        }
        return .object(object)
      }
    }
    return [
      "data": [
        [
          "cwd": .string(homeDirectoryURL.path),
          "hooks": .array(metadata),
          "warnings": [],
          "errors": [],
        ]
      ]
    ]
  }

  private func configReadResponse() throws -> JSONValue {
    lock.lock()
    let shouldReject = rejectsConfigRead || (rejectsConfigReadAfterBatchWrite && didWriteBatch)
    configReadCount += 1
    let config = self.config
    let currentVersion = version
    lock.unlock()
    if shouldReject {
      throw CodexAppServerClientError.serverRejected("config/read")
    }
    return [
      "config": ["features": ["hooks": .bool(try hooksFeatureEnabled())]],
      "origins": [:],
      "layers": [
        [
          "name": [
            "type": "user",
            "file": .string(configURL.path),
            "profile": nil,
          ],
          "version": .string("version-\(currentVersion)"),
          "config": .object(config),
        ]
      ],
    ]
  }

  private func batchWriteResponse(params: JSONObject) throws -> JSONValue {
    guard
      let edits = params["edits"]?.arrayValue,
      !edits.isEmpty,
      let filePath = params["filePath"]?.stringValue,
      filePath == configURL.path,
      params["reloadUserConfig"]?.boolValue == true
    else {
      throw CodexAppServerClientError.invalidResponse("config/batchWrite")
    }
    let configEdits = try edits.map { value in
      guard
        let edit = value.objectValue,
        let keyPath = edit["keyPath"]?.stringValue,
        !keyPath.isEmpty,
        let editValue = edit["value"],
        edit["mergeStrategy"]?.stringValue == "replace"
      else {
        throw CodexAppServerClientError.invalidResponse("config/batchWrite")
      }
      return CodexAppServerConfigEdit(keyPath: keyPath, value: editValue)
    }
    lock.lock()
    batchKeyPaths.append(configEdits.map(\.keyPath))
    let isFirstBatchWrite = batchKeyPaths.count == 1
    lock.unlock()
    if isFirstBatchWrite {
      try beforeBatchWriteResponse(self)
    }
    if rejectsBatchWrite {
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    lock.lock()
    guard params["expectedVersion"]?.stringValue == "version-\(version)" else {
      lock.unlock()
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    var updatedConfig = config
    for edit in configEdits {
      Self.set(
        edit.value,
        at: edit.keyPath.split(separator: ".").map(String.init),
        in: &updatedConfig
      )
    }
    config = updatedConfig
    didWriteBatch = true
    version += 1
    let currentVersion = version
    lock.unlock()
    if rejectsBatchWriteAfterCommit {
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    return [
      "status": "ok",
      "version": .string("version-\(currentVersion)"),
      "filePath": .string(filePath),
      "overriddenMetadata": nil,
    ]
  }

  private static func set(
    _ value: JSONValue,
    at keyPath: ArraySlice<String>,
    in object: inout JSONObject
  ) {
    guard let key = keyPath.first else { return }
    let remainingKeyPath = keyPath.dropFirst()
    guard !remainingKeyPath.isEmpty else {
      object[key] = value
      return
    }
    var child = object[key]?.objectValue ?? [:]
    set(value, at: remainingKeyPath, in: &child)
    object[key] = .object(child)
  }

  private static func set(
    _ value: JSONValue,
    at keyPath: [String],
    in object: inout JSONObject
  ) {
    set(value, at: keyPath[...], in: &object)
  }

  private func nativeEventName(_ event: String) -> String {
    SupatermCodexHookSettings.nativeEventName(forConfigEvent: event) ?? event
  }

  private func nativeEventKey(_ event: String) -> String {
    switch event {
    case "PermissionRequest": "permission_request"
    case "PostToolUse": "post_tool_use"
    case "PreToolUse": "pre_tool_use"
    case "SessionStart": "session_start"
    case "Stop": "stop"
    case "SubagentStart": "subagent_start"
    case "SubagentStop": "subagent_stop"
    case "UserPromptSubmit": "user_prompt_submit"
    default: event
    }
  }

  private var configURL: URL {
    CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
  }
}

nonisolated func writeCodexSettings(
  _ contents: String,
  homeDirectoryURL: URL
) throws {
  let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try FileManager.default.createDirectory(
    at: settingsURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: settingsURL, atomically: true, encoding: .utf8)
}

func writeCodexSettingsObject(
  _ object: [String: Any],
  homeDirectoryURL: URL
) throws {
  let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
  let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  try data.write(to: settingsURL, options: .atomic)
}

func codexSettingsObject(homeDirectoryURL: URL) throws -> [String: Any] {
  let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
  let data = try Data(contentsOf: settingsURL)
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

nonisolated func codexExecutableIsAvailable() -> Bool {
  guard
    let result = try? CodingAgentCommandRunner.run(
      arguments: LoginShellCommandAvailability.commandArguments(for: ["codex"])
    )
  else {
    return false
  }
  return result.status == 0
}

func codexEventGroupsValue(_ event: String, in object: [String: Any]) throws -> [[String: Any]] {
  let hooks = try #require(object["hooks"] as? [String: Any])
  return try #require(hooks[event] as? [[String: Any]])
}
