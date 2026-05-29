import ComposableArchitecture
import Darwin
import Foundation
import SupatermCLIShared

nonisolated private func zmxLogDebug(
  _ event: String,
  fields: [String] = []
) {
  SupatermLog.debug(SupatermLog.zmx, event, fields: fields)
}

nonisolated private func zmxLogError(
  _ event: String,
  fields: [String] = []
) {
  SupatermLog.error(SupatermLog.zmx, event, fields: fields)
}

nonisolated private func zmxLogRunStart(_ argumentLabel: String, captureStdout: Bool) {
  zmxLogDebug(
    "zmx.run.start",
    fields: [
      "arguments=\(argumentLabel)",
      "captureStdout=\(captureStdout)",
    ]
  )
}

nonisolated private func zmxLogRunLaunchFailed(_ argumentLabel: String, error: Error) {
  zmxLogError(
    "zmx.run.launchFailed",
    fields: [
      "arguments=\(argumentLabel)",
      "error=\(String(describing: error))",
    ]
  )
}

nonisolated private func zmxLogRunFailure(_ argumentLabel: String, exitStatus: Int32) {
  zmxLogError(
    "zmx.run.failed",
    fields: [
      "arguments=\(argumentLabel)",
      "exitStatus=\(exitStatus)",
    ]
  )
}

nonisolated private func zmxLogRunFinished(_ argumentLabel: String, stdoutLineCount: Int? = nil) {
  var fields = ["arguments=\(argumentLabel)", "exitStatus=0"]
  if let stdoutLineCount {
    fields.append("stdoutLines=\(stdoutLineCount)")
  }
  zmxLogDebug("zmx.run.finished", fields: fields)
}

public nonisolated struct ZmxClient: Sendable {
  public typealias WrapCommand = @Sendable (
    _ surfaceID: UUID,
    _ userCommand: String?,
    _ defaultShellCommand: String?
  ) -> String?

  public var executableURL: @Sendable () -> URL?
  public var isBundled: @Sendable () -> Bool
  public var wrapCommand: WrapCommand
  public var killSession: @Sendable (_ surfaceID: UUID) async -> Void
  public var listSessions: @Sendable () async -> [String]?

  public nonisolated init(
    executableURL: @escaping @Sendable () -> URL?,
    isBundled: @escaping @Sendable () -> Bool,
    wrapCommand: @escaping WrapCommand,
    killSession: @escaping @Sendable (_ surfaceID: UUID) async -> Void,
    listSessions: @escaping @Sendable () async -> [String]?
  ) {
    self.executableURL = executableURL
    self.isBundled = isBundled
    self.wrapCommand = wrapCommand
    self.killSession = killSession
    self.listSessions = listSessions
  }
}

extension ZmxClient {
  public nonisolated static let subprocessTimeout: Duration = .seconds(5)

  public nonisolated static let live: ZmxClient = {
    let probed = LockIsolated<Bool?>(nil)
    let cachedBundledURL = Bundle.main.url(forResource: "zmx", withExtension: nil, subdirectory: "zmx")

    @Sendable func resolveExecutable() -> URL? {
      guard let url = cachedBundledURL else {
        zmxLogError("zmx.executable.missing")
        return nil
      }
      let canUseZmx = probed.withValue { current -> Bool in
        if let current { return current }
        let probeResult = ZmxSocketBudget.probe()
        let computed = probeResult == nil
        current = computed
        if let probeResult {
          zmxLogError(
            "zmx.socketDir.unavailable",
            fields: ["reason=\(probeResult)"]
          )
        } else {
          zmxLogDebug("zmx.executable.available")
        }
        return computed
      }
      return canUseZmx ? url : nil
    }

    @Sendable func runZmx(_ arguments: [String], captureStdout: Bool = false) async -> String? {
      let argumentLabel = arguments.joined(separator: " ")
      zmxLogRunStart(argumentLabel, captureStdout: captureStdout)
      guard let executable = cachedBundledURL else {
        zmxLogError(
          "zmx.run.missingExecutable",
          fields: ["arguments=\(argumentLabel)"]
        )
        return nil
      }
      let process = Process()
      process.executableURL = executable
      process.arguments = arguments
      var environment = ProcessInfo.processInfo.environment
      environment[ZmxSocketBudget.environmentKey] = ZmxSocketBudget.socketDir()
      process.environment = environment

      let stdoutPipe: Pipe?
      if captureStdout {
        let pipe = Pipe()
        stdoutPipe = pipe
        process.standardOutput = pipe
      } else {
        stdoutPipe = nil
        process.standardOutput = FileHandle.nullDevice
      }

      process.standardError = FileHandle.nullDevice

      let exitStream = AsyncStream<Int32> { continuation in
        process.terminationHandler = { process in
          continuation.yield(process.terminationStatus)
          continuation.finish()
        }
      }

      do {
        try process.run()
      } catch {
        zmxLogRunLaunchFailed(argumentLabel, error: error)
        return nil
      }

      let exitStatus = await withTaskGroup(of: Int32?.self) { group -> Int32? in
        group.addTask {
          for await status in exitStream {
            return status
          }
          return nil
        }
        group.addTask {
          try? await Task.sleep(for: subprocessTimeout)
          return nil
        }
        defer { group.cancelAll() }
        guard let result = await group.next() else { return nil }
        return result
      }

      guard let exitStatus else {
        if process.isRunning {
          process.terminate()
        }
        _ = await withTaskGroup(of: Void.self) { group in
          group.addTask {
            for await _ in exitStream {}
          }
          group.addTask {
            try? await Task.sleep(for: .seconds(1))
          }
          defer { group.cancelAll() }
          await group.next()
        }
        zmxLogError(
          "zmx.run.timeout",
          fields: ["arguments=\(argumentLabel)"]
        )
        return nil
      }

      guard exitStatus == 0 else {
        zmxLogRunFailure(argumentLabel, exitStatus: exitStatus)
        return nil
      }
      guard captureStdout, let stdoutPipe else {
        zmxLogRunFinished(argumentLabel)
        return nil
      }
      let stdout = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
      let output = String(data: stdout, encoding: .utf8) ?? ""
      zmxLogRunFinished(argumentLabel, stdoutLineCount: output.split(whereSeparator: \.isNewline).count)
      return output
    }

    return ZmxClient(
      executableURL: resolveExecutable,
      isBundled: { cachedBundledURL != nil },
      wrapCommand: { surfaceID, userCommand, defaultShellCommand in
        let sessionID = ZmxSessionID.make(surfaceID: surfaceID)
        guard let executable = resolveExecutable() else {
          zmxLogError(
            "zmx.attach.unavailable",
            fields: [
              "surfaceID=\(surfaceID.uuidString.lowercased())",
              "sessionID=\(sessionID)",
            ]
          )
          return nil
        }
        let hasDefaultShellCommand =
          defaultShellCommand?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        zmxLogDebug(
          "zmx.attach.wrap",
          fields: [
            "surfaceID=\(surfaceID.uuidString.lowercased())",
            "sessionID=\(sessionID)",
            "hasUserCommand=\(userCommand?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)",
            "hasDefaultShellCommand=\(hasDefaultShellCommand)",
          ]
        )
        return ZmxAttach.buildCommand(
          executablePath: executable.path(percentEncoded: false),
          sessionID: sessionID,
          userCommand: userCommand,
          defaultShellCommand: defaultShellCommand
        )
      },
      killSession: { surfaceID in
        zmxLogDebug(
          "zmx.kill.requested",
          fields: [
            "surfaceID=\(surfaceID.uuidString.lowercased())",
            "sessionID=\(ZmxSessionID.make(surfaceID: surfaceID))",
          ]
        )
        _ = await runZmx(["kill", ZmxSessionID.make(surfaceID: surfaceID)])
      },
      listSessions: {
        guard let stdout = await runZmx(["ls", "--short"], captureStdout: true) else {
          zmxLogError("zmx.list.failed")
          return nil
        }
        let sessions =
          stdout
          .split(whereSeparator: \.isNewline)
          .map { $0.trimmingCharacters(in: .whitespaces) }
          .filter { ZmxSessionID.surfaceID(from: $0) != nil }
        zmxLogDebug(
          "zmx.list.parsed",
          fields: ["count=\(sessions.count)"]
        )
        return sessions
      }
    )
  }()

  public nonisolated static let noop = ZmxClient(
    executableURL: { nil },
    isBundled: { false },
    wrapCommand: { _, _, _ in nil },
    killSession: { _ in },
    listSessions: { nil }
  )
}

extension ZmxClient: DependencyKey {
  public nonisolated static let liveValue: ZmxClient = .live
  public nonisolated static let testValue: ZmxClient = .noop
}

extension DependencyValues {
  public var zmxClient: ZmxClient {
    get { self[ZmxClient.self] }
    set { self[ZmxClient.self] = newValue }
  }
}

public nonisolated enum ZmxSessionID {
  public nonisolated static let prefix = "spt-"
  public nonisolated static let instanceHashHexDigitCount = 16

  public nonisolated static func make(
    surfaceID: UUID,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    namespacePrefix(environment: environment) + surfaceID.uuidString.lowercased()
  }

  public nonisolated static func surfaceID(
    from sessionID: String,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> UUID? {
    let namespacePrefix = namespacePrefix(environment: environment)
    guard sessionID.hasPrefix(namespacePrefix) else { return nil }
    return UUID(uuidString: String(sessionID.dropFirst(namespacePrefix.count)))
  }

  public nonisolated static func namespacePrefix(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    prefix + instanceHash(environment: environment) + "-"
  }

  public nonisolated static func instanceHash(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    SupatermInstanceIdentity.stableHash(
      for: SupatermInstanceIdentity.resolvedName(environment: environment),
      hexDigitCount: instanceHashHexDigitCount
    )
  }
}

public nonisolated enum ZmxSocketBudget {
  public nonisolated static let environmentKey = "ZMX_DIR"
  public nonisolated static let sunPathLimit = 104
  public nonisolated static let safetyMargin = 2
  public nonisolated static let sessionNameByteCount =
    ZmxSessionID.prefix.utf8.count + ZmxSessionID.instanceHashHexDigitCount + 1 + 36

  public nonisolated static func socketDir() -> String {
    "/tmp/zmx-\(getuid())"
  }

  public nonisolated static func probe() -> String? {
    let directory = socketDir()
    if !fits(directory: directory) {
      return "socket path \(socketPathByteCount(directory: directory))B exceeds budget \(socketPathByteBudget)B"
    }
    return nil
  }

  private nonisolated static var socketPathByteBudget: Int {
    sunPathLimit - safetyMargin
  }

  private nonisolated static func fits(directory: String) -> Bool {
    socketPathByteCount(directory: directory) <= socketPathByteBudget
  }

  private nonisolated static func socketPathByteCount(directory: String) -> Int {
    directory.utf8.count + 1 + sessionNameByteCount
  }
}

public nonisolated enum ZmxAttach {
  public static let defaultShellCommandFlag = "--default-shell-command"

  public nonisolated static func buildCommand(
    executablePath: String,
    sessionID: String,
    userCommand: String?,
    defaultShellCommand: String? = nil
  ) -> String {
    let attach = "\(shellQuote(executablePath)) attach \(sessionID)"
    guard let command = userCommand?.trimmingCharacters(in: .whitespacesAndNewlines), !command.isEmpty else {
      guard let defaultShellCommand = defaultShellCommand?.trimmingCharacters(in: .whitespacesAndNewlines),
        !defaultShellCommand.isEmpty
      else { return attach }
      return "\(attach) \(defaultShellCommandFlag) \(shellQuote(defaultShellCommand))"
    }
    return "\(attach) /bin/sh -c \(shellQuote(command))"
  }

  public nonisolated static func defaultShellCommand(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    if let shell = environment["SHELL"]?.trimmingCharacters(in: .whitespacesAndNewlines), !shell.isEmpty {
      return shell
    }
    return "/bin/sh"
  }

  public nonisolated static func shellQuote(_ value: String) -> String {
    "'\(value.replacing("'", with: "'\\''"))'"
  }
}
