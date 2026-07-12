import Foundation
import Testing

@testable import SupatermCLIShared

struct CodexAppServerClientTests {
  @Test
  func hooksListUsesNativeSchema() throws {
    let recorder = CodexAppServerRequestRecorder { method, _ in
      #expect(method == "hooks/list")
      let hook: JSONValue = [
        "key": "/tmp/home/.codex/hooks.json:stop:0:0",
        "eventName": "stop",
        "handlerType": "command",
        "matcher": nil,
        "command": .string(SupatermCodexHookSettings.command),
        "timeoutSec": 10,
        "statusMessage": nil,
        "sourcePath": "/tmp/home/.codex/hooks.json",
        "source": "user",
        "pluginId": nil,
        "displayOrder": 0,
        "enabled": true,
        "isManaged": false,
        "currentHash": "sha256:native",
        "trustStatus": "trusted",
      ]
      return [
        "data": [
          [
            "cwd": "/tmp/project",
            "hooks": [hook],
            "warnings": [],
            "errors": [],
          ]
        ]
      ]
    }
    let client = CodexAppServerClient(request: recorder.request)

    let hooks = try client.hooksList(cwd: URL(fileURLWithPath: "/tmp/project"))

    #expect(
      recorder.requests() == [
        CodexAppServerRecordedRequest(
          method: "hooks/list",
          params: ["cwds": ["/tmp/project"]]
        )
      ])
    #expect(
      hooks == [
        CodexAppServerHook(
          key: "/tmp/home/.codex/hooks.json:stop:0:0",
          eventName: "stop",
          handlerType: "command",
          matcher: nil,
          command: SupatermCodexHookSettings.command,
          timeoutSeconds: 10,
          statusMessage: nil,
          sourcePath: "/tmp/home/.codex/hooks.json",
          enabled: true,
          isManaged: false,
          currentHash: "sha256:native",
          trustStatus: "trusted"
        )
      ])
  }

  @Test
  func configReadUsesExactUserLayer() throws {
    let recorder = CodexAppServerRequestRecorder { method, _ in
      #expect(method == "config/read")
      return [
        "config": ["features": ["hooks": true]],
        "origins": [:],
        "layers": [
          [
            "name": [
              "type": "system",
              "file": "/etc/codex/config.toml",
            ],
            "version": "system-version",
            "config": ["hooks": ["state": ["system": ["enabled": false]]]],
          ],
          [
            "name": [
              "type": "user",
              "file": "/tmp/home/.codex/config.toml",
              "profile": nil,
            ],
            "version": "user-version",
            "config": [
              "hooks": [
                "state": [
                  "external": ["enabled": false]
                ]
              ]
            ],
          ],
        ],
      ]
    }
    let client = CodexAppServerClient(request: recorder.request)
    let configURL = URL(fileURLWithPath: "/tmp/home/.codex/config.toml")

    let snapshot = try client.readUserConfig(
      cwd: URL(fileURLWithPath: "/tmp/project"),
      configURL: configURL
    )

    #expect(
      recorder.requests() == [
        CodexAppServerRecordedRequest(
          method: "config/read",
          params: [
            "includeLayers": true,
            "cwd": "/tmp/project",
          ]
        )
      ])
    #expect(snapshot.hooksFeatureEnabled)
    #expect(
      snapshot.filePath
        == configURL.standardizedFileURL.resolvingSymlinksInPath().path
    )
    #expect(snapshot.version == "user-version")
    #expect(snapshot.hookState == ["external": ["enabled": false]])
  }

  @Test
  func configReadAcceptsMissingUserLayerBeforeFirstWrite() throws {
    let configURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("missing-\(UUID().uuidString)/config.toml", isDirectory: false)
    let client = CodexAppServerClient { _, _ in
      [
        "config": ["features": ["hooks": true]],
        "origins": [:],
        "layers": [],
      ]
    }

    let snapshot = try client.readUserConfig(
      cwd: FileManager.default.temporaryDirectory,
      configURL: configURL
    )

    #expect(snapshot.filePath == configURL.standardizedFileURL.path)
    #expect(snapshot.version == nil)
    #expect(snapshot.hookState.isEmpty)
  }

  @Test
  func batchWriteReplacesHookStateAtomically() throws {
    let recorder = CodexAppServerRequestRecorder { method, _ in
      #expect(method == "config/batchWrite")
      return [
        "status": "ok",
        "version": "next-version",
        "filePath": "/tmp/home/.codex/config.toml",
        "overriddenMetadata": nil,
      ]
    }
    let client = CodexAppServerClient(request: recorder.request)
    let state: JSONObject = [
      "external": ["enabled": false],
      "/tmp/home/.codex/hooks.json:stop:0:0": ["trusted_hash": "sha256:native"],
    ]

    try client.replaceHookState(
      state,
      filePath: "/tmp/home/.codex/config.toml",
      expectedVersion: "user-version"
    )

    #expect(
      recorder.requests() == [
        CodexAppServerRecordedRequest(
          method: "config/batchWrite",
          params: [
            "edits": [
              [
                "keyPath": "hooks.state",
                "value": .object(state),
                "mergeStrategy": "replace",
              ]
            ],
            "filePath": "/tmp/home/.codex/config.toml",
            "expectedVersion": "user-version",
            "reloadUserConfig": true,
          ]
        )
      ])
  }

  @Test(
    .enabled(
      if: codexExecutableIsAvailable(),
      "Codex must be available in the login shell."
    )
  )
  func liveTransportCompletesInitializationHandshake() throws {
    let homeDirectoryURL = FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-codex-live-\(UUID().uuidString)", isDirectory: true)
    defer { try? FileManager.default.removeItem(at: homeDirectoryURL) }
    let configURL = CodexSettingsInstaller.configURL(homeDirectoryURL: homeDirectoryURL)
    try FileManager.default.createDirectory(
      at: configURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try "[features]\nhooks = true\n".write(
      to: configURL,
      atomically: true,
      encoding: .utf8
    )

    let snapshot = try CodexAppServerClient(homeDirectoryURL: homeDirectoryURL)
      .readUserConfig(cwd: homeDirectoryURL, configURL: configURL)

    #expect(snapshot.hooksFeatureEnabled)
    #expect(
      FileManager.default.contentsEqual(
        atPath: snapshot.filePath,
        andPath: configURL.path
      )
    )
  }
}

nonisolated private struct CodexAppServerRecordedRequest: Equatable, Sendable {
  let method: String
  let params: JSONObject

  static func == (lhs: Self, rhs: Self) -> Bool {
    lhs.method == rhs.method && lhs.params == rhs.params
  }
}

nonisolated private final class CodexAppServerRequestRecorder: @unchecked Sendable {
  private let lock = NSLock()
  private let response: @Sendable (String, JSONObject) throws -> JSONValue
  private var recordedRequests: [CodexAppServerRecordedRequest] = []

  init(response: @escaping @Sendable (String, JSONObject) throws -> JSONValue) {
    self.response = response
  }

  func request(method: String, params: JSONObject) throws -> JSONValue {
    lock.lock()
    recordedRequests.append(CodexAppServerRecordedRequest(method: method, params: params))
    lock.unlock()
    return try response(method, params)
  }

  func requests() -> [CodexAppServerRecordedRequest] {
    lock.lock()
    let result = recordedRequests
    lock.unlock()
    return result
  }
}
