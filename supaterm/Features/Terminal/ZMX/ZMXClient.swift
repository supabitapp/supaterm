import Foundation

struct ZMXClient: Sendable {
  var killSession: @Sendable (String) -> Void
  var killSessions: @Sendable ([String]) -> Void

  static let live = Self(
    killSession: Self.killSessionNamed,
    killSessions: Self.killSessionsNamed
  )

  static let noop = Self(
    killSession: { _ in },
    killSessions: { _ in }
  )

  nonisolated private static func killSessionNamed(_ sessionName: String) {
    runBundledSP(arguments: ["__kill-session", "--session", sessionName])
  }

  nonisolated static func killSessionNamed(
    _ sessionName: String,
    runCommand: @escaping @Sendable ([String]) -> Void
  ) {
    runCommand(["__kill-session", "--session", sessionName])
  }

  nonisolated private static func killSessionsNamed(_ sessionNames: [String]) {
    for sessionName in sortedUniqueSessionNames(sessionNames) {
      killSessionNamed(sessionName)
    }
  }

  nonisolated static func killSessionsNamed(
    _ sessionNames: [String],
    runCommand: @escaping @Sendable ([String]) -> Void
  ) {
    for sessionName in sortedUniqueSessionNames(sessionNames) {
      killSessionNamed(sessionName, runCommand: runCommand)
    }
  }

  nonisolated static func sortedUniqueSessionNames(_ sessionNames: [String]) -> [String] {
    Array(Set(sessionNames)).sorted()
  }

  nonisolated static func bundledSPURL(
    executableURL: URL? = Bundle.main.executableURL
  ) -> URL? {
    executableURL?.deletingLastPathComponent().appendingPathComponent("sp")
  }

  nonisolated static func sessionSocketPath(
    for sessionName: String,
    environment: [String: String] = ProcessInfo.processInfo.environment
  ) -> String {
    if let explicitDirectory = environment["ZMX_DIR"], !explicitDirectory.isEmpty {
      return URL(fileURLWithPath: explicitDirectory, isDirectory: true)
        .appendingPathComponent(sessionName, isDirectory: false)
        .path
    }

    if let runtimeDirectory = environment["XDG_RUNTIME_DIR"], !runtimeDirectory.isEmpty {
      return URL(fileURLWithPath: runtimeDirectory, isDirectory: true)
        .appendingPathComponent("zmx", isDirectory: true)
        .appendingPathComponent(sessionName, isDirectory: false)
        .path
    }

    let uid = getuid()
    let tmpDirectory = (environment["TMPDIR"]?.trimmingCharacters(in: CharacterSet(charactersIn: "/"))).flatMap {
      $0.isEmpty ? nil : "/\($0)"
    } ?? "/tmp"
    return "\(tmpDirectory)/zmx-\(uid)/\(sessionName)"
  }

  nonisolated private static func runBundledSP(arguments: [String]) {
    guard let executableURL = bundledSPURL() else { return }

    let process = Process()
    process.executableURL = executableURL
    process.arguments = arguments
    process.standardInput = nil
    process.standardOutput = nil
    process.standardError = nil

    do {
      try process.run()
      process.waitUntilExit()
    } catch {
      return
    }
  }
}
