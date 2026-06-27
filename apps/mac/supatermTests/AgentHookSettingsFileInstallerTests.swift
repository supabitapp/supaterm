import Foundation
import Testing

@testable import SupatermCLIShared

struct AgentHookSettingsFileInstallerTests {
  @Test
  func concurrentInstallsAndRemovesSerializeSettingsWrites() throws {
    let directoryURL = try temporaryAgentHookSettingsDirectory()
    defer { try? FileManager.default.removeItem(at: directoryURL) }
    let settingsURL = directoryURL.appendingPathComponent("hooks.json", isDirectory: false)
    try writeAgentHookSettings(
      """
      {
        "hooks": {
          "Stop": [
            {
              "hooks": [
                {
                  "command": "echo keep",
                  "timeout": 1,
                  "type": "command"
                },
                {
                  "command": "echo supaterm stale bridge",
                  "timeout": 1,
                  "type": "command"
                }
              ]
            }
          ]
        }
      }
      """,
      to: settingsURL
    )

    let worker = AgentHookSettingsMutationWorker(
      installer: AgentHookSettingsFileInstaller(
        fileManager: .default,
        errors: .test,
        mutationHooks: AgentHookSettingsFileInstaller.MutationHooks(
          afterLoad: { Thread.sleep(forTimeInterval: 0.02) },
          beforeWrite: { Thread.sleep(forTimeInterval: 0.02) }
        )
      ),
      settingsURL: settingsURL
    )
    let queue = DispatchQueue(
      label: "app.supabit.supaterm.agent-hook-settings-test",
      qos: .userInitiated,
      attributes: .concurrent
    )
    let start = DispatchSemaphore(value: 0)
    let group = DispatchGroup()
    let operationCount = 12

    for index in 0..<operationCount {
      group.enter()
      queue.async {
        defer { group.leave() }
        start.wait()
        worker.install(event: "Event\(index)", command: workerCommand(index))
      }

      group.enter()
      queue.async {
        defer { group.leave() }
        start.wait()
        worker.remove()
      }
    }

    for _ in 0..<(operationCount * 2) {
      start.signal()
    }
    group.wait()

    #expect(worker.failures.isEmpty)

    let object = try agentHookSettingsObject(at: settingsURL)
    let commands = agentHookCommands(in: object)
    #expect(commands.contains("echo keep"))
    #expect(commands.contains(where: AgentHookCommandOwnership.isSupatermManagedCommand) == false)
    for index in 0..<operationCount {
      #expect(commands.contains(workerCommand(index)))
    }
  }
}

private func temporaryAgentHookSettingsDirectory() throws -> URL {
  try FileManager.default.url(
    for: .itemReplacementDirectory,
    in: .userDomainMask,
    appropriateFor: FileManager.default.temporaryDirectory,
    create: true
  )
}

private func writeAgentHookSettings(_ contents: String, to url: URL) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try Data(contents.utf8).write(to: url)
}

private func agentHookSettingsObject(at url: URL) throws -> [String: Any] {
  let data = try Data(contentsOf: url)
  return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func agentHookCommands(in object: [String: Any]) -> [String] {
  guard let hooks = object["hooks"] as? [String: Any] else {
    return []
  }
  return hooks.values
    .flatMap { ($0 as? [[String: Any]]) ?? [] }
    .flatMap { ($0["hooks"] as? [[String: Any]]) ?? [] }
    .compactMap { $0["command"] as? String }
}

nonisolated private func agentHookGroup(command: String) -> JSONValue {
  .object([
    "hooks": .array([
      .object([
        "command": .string(command),
        "timeout": .int(1),
        "type": .string("command"),
      ])
    ])
  ])
}

nonisolated private func workerCommand(_ index: Int) -> String {
  "echo worker-\(index)"
}

private enum AgentHookSettingsInstallerTestError: Error, Equatable {
  case invalidEventHooks(String)
  case invalidHooksObject
  case invalidJSON
  case invalidRootObject
}

extension AgentHookSettingsFileInstaller.Errors {
  fileprivate static let test = Self(
    invalidEventHooks: { AgentHookSettingsInstallerTestError.invalidEventHooks($0) },
    invalidHooksObject: { AgentHookSettingsInstallerTestError.invalidHooksObject },
    invalidJSON: { AgentHookSettingsInstallerTestError.invalidJSON },
    invalidRootObject: { AgentHookSettingsInstallerTestError.invalidRootObject }
  )
}

nonisolated private final class AgentHookSettingsMutationWorker: @unchecked Sendable {
  let installer: AgentHookSettingsFileInstaller
  let settingsURL: URL
  private let lock = NSLock()
  private var errors: [String] = []

  init(
    installer: AgentHookSettingsFileInstaller,
    settingsURL: URL
  ) {
    self.installer = installer
    self.settingsURL = settingsURL
  }

  func install(event: String, command: String) {
    do {
      try installer.install(
        settingsURL: settingsURL,
        hookGroupsByEvent: [event: [agentHookGroup(command: command)]]
      )
    } catch {
      record(error)
    }
  }

  func remove() {
    do {
      try installer.removeSupatermHooks(settingsURL: settingsURL)
    } catch {
      record(error)
    }
  }

  var failures: [String] {
    lock.lock()
    let snapshot = errors
    lock.unlock()
    return snapshot
  }

  private func record(_ error: Error) {
    lock.lock()
    errors.append(String(describing: error))
    lock.unlock()
  }
}
