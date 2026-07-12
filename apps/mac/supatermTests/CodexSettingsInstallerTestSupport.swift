import Foundation
import Testing

@testable import SupatermCLIShared

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
  private let rejectsBatchWrite: Bool
  private let rejectsBatchWriteAfterCommit: Bool
  private let afterFirstHooksList: @Sendable () throws -> Void
  private let beforeBatchWriteResponse: @Sendable () throws -> Void
  private let lock = NSLock()
  private var didWriteBatch = false
  private var hookState: JSONObject
  private var hooksListCount = 0
  private var version = 1

  init(
    homeDirectoryURL: URL,
    hookState: JSONObject = [:],
    duplicateSourcePath: String? = nil,
    rejectsConfigRead: Bool = false,
    rejectsConfigReadAfterBatchWrite: Bool = false,
    rejectsBatchWrite: Bool = false,
    rejectsBatchWriteAfterCommit: Bool = false,
    afterFirstHooksList: @escaping @Sendable () throws -> Void = {},
    beforeBatchWriteResponse: @escaping @Sendable () throws -> Void = {},
    hooksFeatureEnabled: @escaping @Sendable () throws -> Bool = { true }
  ) {
    self.homeDirectoryURL = homeDirectoryURL
    self.hookState = hookState
    self.duplicateSourcePath = duplicateSourcePath
    self.rejectsConfigRead = rejectsConfigRead
    self.rejectsConfigReadAfterBatchWrite = rejectsConfigReadAfterBatchWrite
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
    let result = hookState
    lock.unlock()
    return result
  }

  private func hooksListResponse() throws -> JSONValue {
    let settingsURL = CodexSettingsInstaller.settingsURL(homeDirectoryURL: homeDirectoryURL)
    let root = try? JSONDecoder().decode(JSONValue.self, from: Data(contentsOf: settingsURL))
    let hooksObject = root?.objectValue?["hooks"]?.objectValue ?? [:]
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
          lock.lock()
          let state = hookState[key]?.objectValue
          lock.unlock()
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
    lock.unlock()
    if shouldReject {
      throw CodexAppServerClientError.serverRejected("config/read")
    }
    let configURL = CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
    lock.lock()
    let state = hookState
    let currentVersion = version
    lock.unlock()
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
          "config": ["hooks": ["state": .object(state)]],
        ]
      ],
    ]
  }

  private func batchWriteResponse(params: JSONObject) throws -> JSONValue {
    try beforeBatchWriteResponse()
    if rejectsBatchWrite {
      throw CodexAppServerClientError.serverRejected("config/batchWrite")
    }
    guard
      let edits = params["edits"]?.arrayValue,
      let state = edits.first?.objectValue?["value"]?.objectValue,
      let filePath = params["filePath"]?.stringValue
    else {
      throw CodexAppServerClientError.invalidResponse("config/batchWrite")
    }
    lock.lock()
    hookState = state
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
