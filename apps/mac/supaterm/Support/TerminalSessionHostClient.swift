import ComposableArchitecture
import Darwin
import Foundation
import SupatermCLIShared

nonisolated private func sessionHostLogDebug(
  _ event: String,
  fields: [String] = []
) {
  SupatermLog.debug(SupatermLog.sessionHost, event, fields: fields)
}

nonisolated private func sessionHostLogError(
  _ event: String,
  fields: [String] = []
) {
  SupatermLog.error(SupatermLog.sessionHost, event, fields: fields)
}

nonisolated private func sessionHostLogRunStart(_ argumentLabel: String, captureStdout: Bool) {
  sessionHostLogDebug(
    "sessionHost.run.start",
    fields: [
      "arguments=\(argumentLabel)",
      "captureStdout=\(captureStdout)",
    ]
  )
}

nonisolated private func sessionHostLogRunLaunchFailed(_ argumentLabel: String, error: Error) {
  sessionHostLogError(
    "sessionHost.run.launchFailed",
    fields: [
      "arguments=\(argumentLabel)",
      "error=\(String(describing: error))",
    ]
  )
}

nonisolated private func sessionHostLogRunFailure(_ argumentLabel: String, exitStatus: Int32) {
  sessionHostLogError(
    "sessionHost.run.failed",
    fields: [
      "arguments=\(argumentLabel)",
      "exitStatus=\(exitStatus)",
    ]
  )
}

nonisolated private func sessionHostLogRunFinished(_ argumentLabel: String, stdoutLineCount: Int? = nil) {
  var fields = ["arguments=\(argumentLabel)", "exitStatus=0"]
  if let stdoutLineCount {
    fields.append("stdoutLines=\(stdoutLineCount)")
  }
  sessionHostLogDebug("sessionHost.run.finished", fields: fields)
}

public nonisolated enum SessionHostEnvironment {
  public static let disabledKey = "SUPATERM_DISABLE_SUPATERM_HOST"
  public static let enabledKey = "SUPATERM_ENABLE_SUPATERM_HOST"
  public static let directoryKey = "SUPATERM_HOST_DIR"
  public static let sessionKey = "SUPATERM_HOST_SESSION"
  public static let sessionPrefixKey = "SUPATERM_HOST_SESSION_PREFIX"

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

nonisolated enum SessionHostSessionList {
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
        let surfaceID = SessionHostSessionID.surfaceID(
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

private nonisolated enum SessionHostSubprocess {
  static func run(
    executableURL: URL?,
    arguments: [String],
    captureStdout: Bool,
    timeout: Duration
  ) async -> String? {
    let argumentLabel = arguments.joined(separator: " ")
    sessionHostLogRunStart(argumentLabel, captureStdout: captureStdout)
    guard let executableURL else {
      sessionHostLogError(
        "sessionHost.run.missingExecutable",
        fields: ["arguments=\(argumentLabel)"]
      )
      return nil
    }
    let process = Process()
    process.executableURL = executableURL
    process.arguments = arguments
    var environment = ProcessInfo.processInfo.environment
    environment[SessionHostEnvironment.directoryKey] = SessionHostSocketBudget.socketDir()
    environment[SessionHostEnvironment.sessionKey] = ""
    environment[SessionHostEnvironment.sessionPrefixKey] = ""
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
      sessionHostLogRunLaunchFailed(argumentLabel, error: error)
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
      sessionHostLogError(
        "sessionHost.run.timeout",
        fields: ["arguments=\(argumentLabel)"]
      )
      return nil
    }

    guard exitStatus == 0 else {
      sessionHostLogRunFailure(argumentLabel, exitStatus: exitStatus)
      return nil
    }
    guard captureStdout, let stdoutTask else {
      sessionHostLogRunFinished(argumentLabel)
      return nil
    }
    let stdout = await stdoutTask.value
    let output = String(data: stdout, encoding: .utf8) ?? ""
    sessionHostLogRunFinished(argumentLabel, stdoutLineCount: output.split(whereSeparator: \.isNewline).count)
    return output
  }
}

extension TerminalSessionHostClient {
  private nonisolated static let subprocessTimeout: Duration = .seconds(5)

  public nonisolated static let live = makeSessionHost(
    executableURL: Bundle.main.executableURL.flatMap {
      SupatermBundleLayout.sessionHostExecutableURL(nextTo: $0)
    }
  )

  nonisolated static func makeSessionHost(
    executableURL: URL?,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> TerminalSessionHostClient {
    let probed = LockIsolated<Bool?>(nil)
    let cachedBundledURL = executableURL

    @Sendable func resolveExecutable() -> URL? {
      guard let url = cachedBundledURL else {
        sessionHostLogError("sessionHost.executable.missing")
        return nil
      }
      let canUseSessionHost = probed.withValue { current -> Bool in
        if let current { return current }
        let probeResult = SessionHostSocketBudget.probe()
        let computed = probeResult == nil
        current = computed
        if let probeResult {
          sessionHostLogError(
            "sessionHost.socketDir.unavailable",
            fields: ["reason=\(probeResult)"]
          )
        } else {
          sessionHostLogDebug("sessionHost.executable.available")
        }
        return computed
      }
      return canUseSessionHost ? url : nil
    }

    return TerminalSessionHostClient(
      isAvailable: { resolveExecutable() != nil },
      canManageSessions: { cachedBundledURL != nil },
      sessionID: { surfaceID in
        SessionHostSessionID.make(surfaceID: surfaceID, environment: environment)
      },
      commandWrapper: { surfaceID, mode in
        guard let executableURL = resolveExecutable() else { return nil }
        return SessionHostAttach.buildWrapperArgv(
          executablePath: executableURL.path(percentEncoded: false),
          sessionID: SessionHostSessionID.make(surfaceID: surfaceID, environment: environment),
          mode: mode
        )
      },
      killSession: { surfaceID in
        sessionHostLogDebug(
          "sessionHost.kill.requested",
          fields: [
            "surfaceID=\(surfaceID.uuidString.lowercased())",
            "sessionID=\(SessionHostSessionID.make(surfaceID: surfaceID, environment: environment))",
          ]
        )
        _ = await SessionHostSubprocess.run(
          executableURL: cachedBundledURL,
          arguments: ["kill", SessionHostSessionID.make(surfaceID: surfaceID, environment: environment)],
          captureStdout: false,
          timeout: subprocessTimeout
        )
      },
      listSessions: {
        guard
          let stdout = await SessionHostSubprocess.run(
            executableURL: cachedBundledURL,
            arguments: ["ls"],
            captureStdout: true,
            timeout: subprocessTimeout
          )
        else {
          sessionHostLogError("sessionHost.list.failed")
          return nil
        }
        let sessions = SessionHostSessionList.parse(stdout, environment: environment)
        sessionHostLogDebug(
          "sessionHost.list.parsed",
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

public nonisolated enum SessionHostSessionID {
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

public nonisolated enum SessionHostSocketBudget {
  public nonisolated static let sunPathLimit = 104
  public nonisolated static let safetyMargin = 2
  public nonisolated static let sessionNameByteCount =
    SessionHostSessionID.prefix.utf8.count + SessionHostSessionID.instanceHashHexDigitCount + 1 + 36

  public nonisolated static func socketDir(
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    environment[SessionHostEnvironment.directoryKey] ?? "/tmp/supaterm-host-\(getuid())"
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

private nonisolated enum SessionHostAttach {
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
