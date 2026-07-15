import Darwin
import Foundation

struct CodexAppServerHook: Equatable, Sendable {
  let key: String
  let eventName: String
  let handlerType: String
  let matcher: String?
  let command: String?
  let timeoutSeconds: Int
  let statusMessage: String?
  let sourcePath: String
  let enabled: Bool
  let isManaged: Bool
  let currentHash: String
  let trustStatus: String
}

struct CodexAppServerUserConfig: Equatable, Sendable {
  let hooksFeatureEnabled: Bool
  let filePath: String
  let version: String?
  let hookState: JSONObject
}

struct CodexAppServerClient: Sendable {
  typealias Request = @Sendable (String, JSONObject) throws -> JSONValue

  private let request: Request

  init(homeDirectoryURL: URL) {
    request = { method, params in
      try CodexAppServerTransport.perform(
        homeDirectoryURL: homeDirectoryURL,
        method: method,
        params: params
      )
    }
  }

  init(request: @escaping Request) {
    self.request = request
  }

  func hooksList(cwd: URL) throws -> [CodexAppServerHook] {
    let cwdPath = Self.canonicalPath(cwd)
    let result = try request("hooks/list", ["cwds": [.string(cwdPath)]])
    guard
      let data = result.objectValue?["data"]?.arrayValue,
      let entry = data.first(where: {
        guard let path = $0.objectValue?["cwd"]?.stringValue else { return false }
        return Self.canonicalPath(URL(fileURLWithPath: path)) == cwdPath
      }),
      let entryObject = entry.objectValue,
      let hooks = entryObject["hooks"]?.arrayValue,
      let errors = entryObject["errors"]?.arrayValue
    else {
      throw CodexAppServerClientError.invalidResponse("hooks/list")
    }
    guard errors.isEmpty else {
      let messages = errors.compactMap { $0.objectValue?["message"]?.stringValue }
      throw CodexAppServerClientError.hookDiscoveryFailed(messages.joined(separator: "\n"))
    }
    return try hooks.map(decodeHook(_:))
  }

  func readUserConfig(cwd: URL, configURL: URL) throws -> CodexAppServerUserConfig {
    let cwdPath = Self.canonicalPath(cwd)
    let configPath = Self.canonicalPath(configURL)
    let result = try request(
      "config/read",
      [
        "includeLayers": true,
        "cwd": .string(cwdPath),
      ]
    )
    guard
      let resultObject = result.objectValue,
      let config = resultObject["config"]?.objectValue,
      let layers = resultObject["layers"]?.arrayValue
    else {
      throw CodexAppServerClientError.invalidResponse("config/read")
    }
    let hooksFeatureEnabled =
      config["features"]?.objectValue?["hooks"]?.boolValue == true
    guard
      let layer = layers.first(where: { value in
        guard
          let name = value.objectValue?["name"]?.objectValue,
          name["type"]?.stringValue == "user",
          let file = name["file"]?.stringValue
        else {
          return false
        }
        return Self.canonicalPath(URL(fileURLWithPath: file)) == configPath
          && (name["profile"] == nil || name["profile"] == .null)
      })?.objectValue
    else {
      guard !FileManager.default.fileExists(atPath: configPath) else {
        throw CodexAppServerClientError.userConfigLayerMissing(configPath)
      }
      return CodexAppServerUserConfig(
        hooksFeatureEnabled: hooksFeatureEnabled,
        filePath: configPath,
        version: nil,
        hookState: [:]
      )
    }
    guard
      let version = layer["version"]?.stringValue,
      let filePath = layer["name"]?.objectValue?["file"]?.stringValue,
      let layerConfig = layer["config"]?.objectValue
    else {
      throw CodexAppServerClientError.userConfigLayerMissing(configPath)
    }
    let hookState =
      layerConfig["hooks"]?.objectValue?["state"]?.objectValue ?? [:]
    return CodexAppServerUserConfig(
      hooksFeatureEnabled: hooksFeatureEnabled,
      filePath: filePath,
      version: version,
      hookState: hookState
    )
  }

  func replaceHookState(
    _ hookState: JSONObject,
    filePath: String,
    expectedVersion: String?
  ) throws {
    var params: JSONObject = [
      "edits": [
        [
          "keyPath": "hooks.state",
          "value": .object(hookState),
          "mergeStrategy": "replace",
        ]
      ],
      "filePath": .string(filePath),
      "reloadUserConfig": true,
    ]
    if let expectedVersion {
      params["expectedVersion"] = .string(expectedVersion)
    }
    let result = try request("config/batchWrite", params)
    guard
      let resultObject = result.objectValue,
      resultObject["status"]?.stringValue == "ok",
      resultObject["filePath"]?.stringValue == filePath,
      resultObject["version"]?.stringValue != nil
    else {
      throw CodexAppServerClientError.configWriteRejected
    }
  }

  private func decodeHook(_ value: JSONValue) throws -> CodexAppServerHook {
    guard
      let object = value.objectValue,
      let key = object["key"]?.stringValue,
      let eventName = object["eventName"]?.stringValue,
      let handlerType = object["handlerType"]?.stringValue,
      let timeoutSeconds = object["timeoutSec"]?.intValue,
      let sourcePath = object["sourcePath"]?.stringValue,
      let enabled = object["enabled"]?.boolValue,
      let isManaged = object["isManaged"]?.boolValue,
      let currentHash = object["currentHash"]?.stringValue,
      let trustStatus = object["trustStatus"]?.stringValue
    else {
      throw CodexAppServerClientError.invalidResponse("hooks/list")
    }
    return CodexAppServerHook(
      key: key,
      eventName: eventName,
      handlerType: handlerType,
      matcher: object["matcher"]?.stringValue,
      command: object["command"]?.stringValue,
      timeoutSeconds: timeoutSeconds,
      statusMessage: object["statusMessage"]?.stringValue,
      sourcePath: sourcePath,
      enabled: enabled,
      isManaged: isManaged,
      currentHash: currentHash,
      trustStatus: trustStatus
    )
  }

  private static func canonicalPath(_ url: URL) -> String {
    url.standardizedFileURL.resolvingSymlinksInPath().path
  }
}

enum CodexAppServerClientError: Error, Equatable, LocalizedError {
  case configWriteRejected
  case hookDiscoveryFailed(String)
  case invalidResponse(String)
  case requestTimedOut(String)
  case serverExited(String)
  case serverRejected(String)
  case userConfigLayerMissing(String)

  var errorDescription: String? {
    switch self {
    case .configWriteRejected:
      return "Codex rejected the hook trust update."
    case .hookDiscoveryFailed(let message):
      return message.isEmpty ? "Codex could not discover hooks." : message
    case .invalidResponse(let method):
      return "Codex returned an invalid response for \(method)."
    case .requestTimedOut(let method):
      return "Codex timed out while handling \(method)."
    case .serverExited(let message):
      return message.isEmpty ? "Codex app-server exited unexpectedly." : message
    case .serverRejected(let message):
      return message
    case .userConfigLayerMissing(let path):
      return "Codex did not return its user config layer for \(path)."
    }
  }
}

private final class CodexAppServerTransport {
  private static let timeout: TimeInterval = 10

  private let process = Process()
  private let inputHandle: FileHandle
  private let outputHandle: FileHandle
  private let output = CodexAppServerLineBuffer()
  private let errorHandle: FileHandle
  private let errorDirectoryURL: URL
  private let errorURL: URL
  private let processExited = DispatchSemaphore(value: 0)
  private let closeLock = NSLock()
  private var isClosed = false
  private var nextRequestID = 1

  static func perform(
    homeDirectoryURL: URL,
    method: String,
    params: JSONObject
  ) throws -> JSONValue {
    let transport = try CodexAppServerTransport(homeDirectoryURL: homeDirectoryURL)
    defer { transport.close() }
    try transport.initialize()
    return try transport.request(method: method, params: params)
  }

  private init(homeDirectoryURL: URL) throws {
    let inputPipe = Pipe()
    let outputPipe = Pipe()
    inputHandle = inputPipe.fileHandleForWriting
    outputHandle = outputPipe.fileHandleForReading

    errorDirectoryURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(
        "supaterm-codex-app-server-\(UUID().uuidString)",
        isDirectory: true
      )
    try FileManager.default.createDirectory(
      at: errorDirectoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    errorURL = errorDirectoryURL.appendingPathComponent("stderr", isDirectory: false)
    guard
      FileManager.default.createFile(
        atPath: errorURL.path,
        contents: nil,
        attributes: [.posixPermissions: 0o600]
      )
    else {
      throw CodexAppServerClientError.serverExited("")
    }
    errorHandle = try FileHandle(forWritingTo: errorURL)

    let codexHomeDirectoryURL =
      homeDirectoryURL
      .appendingPathComponent(".codex", isDirectory: true)
    let command = [
      "exec",
      "/usr/bin/env",
      "HOME=\(homeDirectoryURL.path)",
      "CODEX_HOME=\(codexHomeDirectoryURL.path)",
      "codex",
      "app-server",
      "--stdio",
    ]
    .map(SupatermShellCommand.escapedToken)
    .joined(separator: " ")
    process.executableURL = CodingAgentCommandRunner.loginShellURL()
    process.arguments = LoginShellCommandAvailability.interactiveCommandArguments(for: command)
    process.standardInput = inputPipe
    process.standardOutput = outputPipe
    process.standardError = errorHandle
    process.terminationHandler = { [processExited] _ in
      processExited.signal()
    }
    outputHandle.readabilityHandler = { [output] handle in
      let data = handle.availableData
      if data.isEmpty {
        handle.readabilityHandler = nil
        output.finish()
      } else {
        output.append(data)
      }
    }

    do {
      try process.run()
    } catch {
      outputHandle.readabilityHandler = nil
      try? errorHandle.close()
      try? FileManager.default.removeItem(at: errorDirectoryURL)
      throw error
    }
  }

  private func initialize() throws {
    _ = try request(
      method: "initialize",
      params: [
        "clientInfo": [
          "name": "supaterm",
          "title": "Supaterm",
          "version": "1",
        ]
      ]
    )
    try send(["method": "initialized"])
  }

  private func request(method: String, params: JSONObject) throws -> JSONValue {
    let requestID = nextRequestID
    nextRequestID += 1
    try send(
      [
        "id": .int(requestID),
        "method": .string(method),
        "params": .object(params),
      ]
    )
    let deadline = Date().addingTimeInterval(Self.timeout)
    while true {
      let data: Data
      do {
        data = try output.nextLine(deadline: deadline, method: method)
      } catch CodexAppServerClientError.serverExited {
        throw CodexAppServerClientError.serverExited(standardError())
      }
      guard
        let value = try? JSONDecoder().decode(JSONValue.self, from: data),
        let object = value.objectValue,
        object["id"]?.intValue == requestID
      else {
        continue
      }
      if let error = object["error"]?.objectValue {
        throw CodexAppServerClientError.serverRejected(
          error["message"]?.stringValue ?? "Codex rejected \(method)."
        )
      }
      guard let result = object["result"] else {
        throw CodexAppServerClientError.invalidResponse(method)
      }
      return result
    }
  }

  private func send(_ object: JSONObject) throws {
    var data = try JSONEncoder().encode(JSONValue.object(object))
    data.append(0x0A)
    try inputHandle.write(contentsOf: data)
  }

  private func standardError() -> String {
    try? errorHandle.synchronize()
    guard let data = try? Data(contentsOf: errorURL) else { return "" }
    return String(decoding: data, as: UTF8.self)
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private func close() {
    closeLock.lock()
    guard !isClosed else {
      closeLock.unlock()
      return
    }
    isClosed = true
    closeLock.unlock()

    try? inputHandle.close()
    if processExited.wait(timeout: .now() + 1) == .timedOut, process.isRunning {
      process.terminate()
      if processExited.wait(timeout: .now() + 1) == .timedOut, process.isRunning {
        kill(process.processIdentifier, SIGKILL)
        _ = processExited.wait(timeout: .now() + 1)
      }
    }
    outputHandle.readabilityHandler = nil
    output.finish()
    try? outputHandle.close()
    try? errorHandle.close()
    try? FileManager.default.removeItem(at: errorDirectoryURL)
  }
}

private final class CodexAppServerLineBuffer: @unchecked Sendable {
  private let condition = NSCondition()
  private var buffer = Data()
  private var lines: [Data] = []
  private var isFinished = false

  func append(_ data: Data) {
    condition.lock()
    buffer.append(data)
    while let newline = buffer.firstIndex(of: 0x0A) {
      lines.append(Data(buffer[..<newline]))
      buffer.removeSubrange(...newline)
    }
    condition.broadcast()
    condition.unlock()
  }

  func finish() {
    condition.lock()
    if !buffer.isEmpty {
      lines.append(buffer)
      buffer.removeAll()
    }
    isFinished = true
    condition.broadcast()
    condition.unlock()
  }

  func nextLine(deadline: Date, method: String) throws -> Data {
    condition.lock()
    defer { condition.unlock() }
    while lines.isEmpty, !isFinished {
      guard condition.wait(until: deadline) else {
        throw CodexAppServerClientError.requestTimedOut(method)
      }
    }
    if !lines.isEmpty {
      return lines.removeFirst()
    }
    throw CodexAppServerClientError.serverExited("")
  }
}
