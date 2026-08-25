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

public nonisolated enum ZmxEnvironment {
  public static let disabledKey = "SUPATERM_DISABLE_ZMX"
  public static let enabledKey = "SUPATERM_ENABLE_ZMX"
  public static let directoryKey = "ZMX_DIR"
  public static let sessionKey = "ZMX_SESSION"
  public static let sessionPrefixKey = "ZMX_SESSION_PREFIX"

  public static func sessionsEnabled(
    setting: Bool,
    isDevelopmentBuild: Bool = AppBuild.isDevelopmentBuild,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> Bool {
    setting && environment[disabledKey] != "1"
      && (!isDevelopmentBuild || environment[enabledKey] == "1")
  }
}

public nonisolated enum TerminalSessionHostAttachMode: Sendable {
  case createIfNeeded
  case existing
}

public nonisolated struct TerminalSessionHostSession: Equatable, Sendable {
  public let surfaceID: UUID
  public let processID: Int32

  public init(surfaceID: UUID, processID: Int32) {
    self.surfaceID = surfaceID
    self.processID = processID
  }
}

nonisolated enum ZmxSessionList {
  static func parse(
    _ output: String,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> [TerminalSessionHostSession] {
    output.split(whereSeparator: \.isNewline).compactMap { line in
      let fields = line.split(separator: "\t")
      guard
        let nameField = fields.first,
        let nameRange = nameField.range(of: "name="),
        let processField = fields.first(where: { $0.hasPrefix("pid=") }),
        let processID = Int32(processField.dropFirst(4)),
        processID > 0,
        let surfaceID = ZmxSessionID.surfaceID(
          from: String(nameField[nameRange.upperBound...]),
          environment: environment
        )
      else {
        return nil
      }
      return TerminalSessionHostSession(surfaceID: surfaceID, processID: processID)
    }
  }
}

public nonisolated struct TerminalSessionHostClient: Sendable {
  public var isAvailable: @Sendable () -> Bool
  public var canManageSessions: @Sendable () -> Bool
  public var sessionID: @Sendable (_ surfaceID: UUID) -> String
  public var commandWrapper: @Sendable (_ surfaceID: UUID, _ mode: TerminalSessionHostAttachMode) -> [String]?
  public var killSession: @Sendable (_ surfaceID: UUID) async -> Void
  public var listSessions: @Sendable () async -> [TerminalSessionHostSession]?

  public nonisolated init(
    isAvailable: @escaping @Sendable () -> Bool,
    canManageSessions: @escaping @Sendable () -> Bool,
    sessionID: @escaping @Sendable (_ surfaceID: UUID) -> String,
    commandWrapper:
      @escaping @Sendable (
        _ surfaceID: UUID,
        _ mode: TerminalSessionHostAttachMode
      ) -> [String]?,
    killSession: @escaping @Sendable (_ surfaceID: UUID) async -> Void,
    listSessions: @escaping @Sendable () async -> [TerminalSessionHostSession]?
  ) {
    self.isAvailable = isAvailable
    self.canManageSessions = canManageSessions
    self.sessionID = sessionID
    self.commandWrapper = commandWrapper
    self.killSession = killSession
    self.listSessions = listSessions
  }
}

private nonisolated enum ZmxSubprocess {
  static func run(
    executableURL: URL?,
    arguments: [String],
    captureStdout: Bool,
    timeout: Duration
  ) async -> String? {
    let argumentLabel = arguments.joined(separator: " ")
    zmxLogRunStart(argumentLabel, captureStdout: captureStdout)
    guard let executableURL else {
      zmxLogError(
        "zmx.run.missingExecutable",
        fields: ["arguments=\(argumentLabel)"]
      )
      return nil
    }
    let process = Process()
    process.executableURL = executableURL
    process.arguments = arguments
    var environment = ProcessInfo.processInfo.environment
    environment[ZmxEnvironment.directoryKey] = ZmxSocketBudget.socketDir()
    environment[ZmxEnvironment.sessionKey] = ""
    environment[ZmxEnvironment.sessionPrefixKey] = ""
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

    let stdoutTask = stdoutPipe.map { pipe in
      Task.detached(priority: .utility) {
        pipe.fileHandleForReading.readDataToEndOfFile()
      }
    }
    let exitStatus = await withTaskGroup(of: Int32?.self) { group -> Int32? in
      group.addTask {
        for await status in exitStream {
          return status
        }
        return nil
      }
      group.addTask {
        try? await Task.sleep(for: timeout)
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
    guard captureStdout, let stdoutTask else {
      zmxLogRunFinished(argumentLabel)
      return nil
    }
    let stdout = await stdoutTask.value
    let output = String(data: stdout, encoding: .utf8) ?? ""
    zmxLogRunFinished(argumentLabel, stdoutLineCount: output.split(whereSeparator: \.isNewline).count)
    return output
  }
}

extension TerminalSessionHostClient {
  private nonisolated static let subprocessTimeout: Duration = .seconds(5)

  public nonisolated static let live = makeZmx(
    executableURL: Bundle.main.executableURL.flatMap {
      SupatermBundleLayout.zmxExecutableURL(nextTo: $0)
    }
  )

  nonisolated static func makeZmx(
    executableURL: URL?,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> TerminalSessionHostClient {
    let probed = LockIsolated<Bool?>(nil)
    let cachedBundledURL = executableURL

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

    return TerminalSessionHostClient(
      isAvailable: { resolveExecutable() != nil },
      canManageSessions: { cachedBundledURL != nil },
      sessionID: { surfaceID in
        ZmxSessionID.make(surfaceID: surfaceID, environment: environment)
      },
      commandWrapper: { surfaceID, mode in
        guard let executableURL = resolveExecutable() else { return nil }
        return ZmxAttach.buildWrapperArgv(
          executablePath: executableURL.path(percentEncoded: false),
          sessionID: ZmxSessionID.make(surfaceID: surfaceID, environment: environment),
          mode: mode
        )
      },
      killSession: { surfaceID in
        zmxLogDebug(
          "zmx.kill.requested",
          fields: [
            "surfaceID=\(surfaceID.uuidString.lowercased())",
            "sessionID=\(ZmxSessionID.make(surfaceID: surfaceID, environment: environment))",
          ]
        )
        _ = await ZmxSubprocess.run(
          executableURL: cachedBundledURL,
          arguments: ["kill", ZmxSessionID.make(surfaceID: surfaceID, environment: environment)],
          captureStdout: false,
          timeout: subprocessTimeout
        )
      },
      listSessions: {
        guard
          let stdout = await ZmxSubprocess.run(
            executableURL: cachedBundledURL,
            arguments: ["ls"],
            captureStdout: true,
            timeout: subprocessTimeout
          )
        else {
          zmxLogError("zmx.list.failed")
          return nil
        }
        let sessions = ZmxSessionList.parse(stdout, environment: environment)
        zmxLogDebug(
          "zmx.list.parsed",
          fields: ["count=\(sessions.count)"]
        )
        return sessions
      }
    )
  }

  public nonisolated static let noop = TerminalSessionHostClient(
    isAvailable: { false },
    canManageSessions: { false },
    sessionID: { $0.uuidString.lowercased() },
    commandWrapper: { _, _ in nil },
    killSession: { _ in },
    listSessions: { nil }
  )
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
  public nonisolated static let sunPathLimit = 104
  public nonisolated static let safetyMargin = 2
  public nonisolated static let sessionNameByteCount =
    ZmxSessionID.prefix.utf8.count + ZmxSessionID.instanceHashHexDigitCount + 1 + 36

  public nonisolated static func socketDir(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    environment[ZmxEnvironment.directoryKey] ?? "/tmp/zmx-\(getuid())"
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

private nonisolated enum ZmxAttach {
  static func buildWrapperArgv(
    executablePath: String,
    sessionID: String,
    mode: TerminalSessionHostAttachMode
  ) -> [String] {
    switch mode {
    case .createIfNeeded:
      [executablePath, "attach", sessionID]
    case .existing:
      [executablePath, "attach", "--existing", sessionID]
    }
  }
}
