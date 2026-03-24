import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct ClaudeWrapperTests {
  @Test
  func wrapperInjectsSettingsInsideSupatermPane() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))
    let spLogURL = rootURL.appendingPathComponent("sp.log", isDirectory: false)
    let spURL = try writeFakeSPExecutable(
      at: rootURL.appendingPathComponent("sp", isDirectory: false),
      logURL: spLogURL,
      settingsJSON: #"{"hooks":{"Notification":[{"hooks":[{"command":"fake","type":"command","timeout":10}]}]}}"#
    )

    let socketURL = rootURL.appendingPathComponent("supaterm.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    let output = try runExecutable(
      at: wrapperURL,
      arguments: [],
      environment: [
        "PATH": "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)",
        SupatermCLIEnvironment.cliPathKey: spURL.path,
        SupatermCLIEnvironment.socketPathKey: socketURL.path,
        SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
        "CLAUDECODE": "nested",
      ]
    )
    let spLog = try String(contentsOf: spLogURL, encoding: .utf8)

    #expect(output.contains("ARG[0]=--settings"))
    #expect(
      output.contains(
        #"ARG[1]={"hooks":{"Notification":[{"hooks":[{"command":"fake","type":"command","timeout":10}]}]}}"#))
    #expect(output.contains("CLAUDECODE="))
    #expect(!output.contains("CLAUDECODE=nested"))
    #expect(spLog.contains("ping --timeout 0.75"))
    #expect(spLog.contains("claude-hook-settings"))
  }

  @Test
  func wrapperPassesThroughOutsideSupaterm() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let output = try runExecutable(
      at: wrapperURL,
      arguments: ["hello", "world"],
      environment: [
        "PATH": "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)"
      ]
    )

    #expect(output.contains("ARG[0]=hello"))
    #expect(output.contains("ARG[1]=world"))
    #expect(!output.contains("ARG[0]=--settings"))
  }

  @Test
  func wrapperPassesThroughWhenSocketIsUnavailableOrHooksDisabled() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let basePath = "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)"
    let unavailableSocketOutput = try runExecutable(
      at: wrapperURL,
      arguments: ["hello"],
      environment: [
        "PATH": basePath,
        SupatermCLIEnvironment.socketPathKey: rootURL.appendingPathComponent("missing.sock").path,
        SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
      ]
    )
    #expect(unavailableSocketOutput.contains("ARG[0]=hello"))
    #expect(!unavailableSocketOutput.contains("ARG[0]=--settings"))

    let disabledOutput = try runExecutable(
      at: wrapperURL,
      arguments: ["hello"],
      environment: [
        "PATH": basePath,
        SupatermCLIEnvironment.claudeHooksDisabledKey: "1",
        SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
      ]
    )
    #expect(disabledOutput.contains("ARG[0]=hello"))
    #expect(!disabledOutput.contains("ARG[0]=--settings"))
  }

  @Test
  func wrapperPassesThroughNonInteractiveClaudeCommands() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let socketURL = rootURL.appendingPathComponent("supaterm.sock", isDirectory: false)
    try createSocketNode(at: socketURL)
    let baseEnvironment = [
      "PATH": "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)",
      SupatermCLIEnvironment.socketPathKey: socketURL.path,
      SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
    ]

    for arguments in [["auth", "status"], ["update"], ["agents"], ["mcp"], ["remote-control"], ["--remote-control"]] {
      let output = try runExecutable(
        at: wrapperURL,
        arguments: arguments,
        environment: baseEnvironment
      )
      #expect(output.contains("ARG[0]=\(arguments[0])"))
      #expect(!output.contains("ARG[0]=--settings"))
    }
  }

  @Test
  func wrapperSkipsSupatermBundledClaudeCandidatesWhenResolvingRealBinary() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try copyClaudeWrapper(
      to: rootURL.appendingPathComponent("Debug/supaterm.app/Contents/MacOS/claude", isDirectory: false)
    )
    let siblingWrapperURL = rootURL.appendingPathComponent(
      "Installed/supaterm.app/Contents/Resources/bin/claude",
      isDirectory: false
    )
    try writeExecutable(
      at: siblingWrapperURL,
      script: """
        #!/bin/bash
        printf 'WRONG_WRAPPER\\n'
        """
    )
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))
    let path = [
      wrapperURL.deletingLastPathComponent().path,
      siblingWrapperURL.deletingLastPathComponent().path,
      realBinURL.path,
    ].joined(separator: ":")

    let output = try runExecutable(
      at: wrapperURL,
      arguments: ["hello"],
      environment: [
        "PATH": path
      ],
    )

    #expect(output.contains("ARG[0]=hello"))
    #expect(!output.contains("WRONG_WRAPPER"))
  }
}

struct ShellIntegrationCommandResolutionTests {
  @Test
  func zshIntegrationResolvesBundledCommandsAfterRcPathRewrite() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let integrationURL = try installGhosttyZshIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let appBinURL = rootURL.appendingPathComponent("app/Contents/MacOS", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: appBinURL, withIntermediateDirectories: true)

    try """
    path=("$HOME/.local/bin" $path)
    """.write(
      to: homeURL.appendingPathComponent(".zshrc", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: appBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: appBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let output = try runExecutable(
      at: URL(fileURLWithPath: "/bin/zsh", isDirectory: false),
      arguments: ["-i", "-c", "_ghostty_deferred_init >/dev/null 2>&1; sp; claude"],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "SUPATERM_CLI_PATH": appBinURL.appendingPathComponent("sp", isDirectory: false).path,
        "ZDOTDIR": integrationURL.path,
        "GHOSTTY_ZSH_ZDOTDIR": homeURL.path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }

  @Test
  func bashIntegrationResolvesBundledCommandsAfterRcPathRewrite() throws {
    let rootURL = try makeTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let resourcesURL = try installGhosttyBashIntegration(at: rootURL)
    let homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    let userBinURL = homeURL.appendingPathComponent(".local/bin", isDirectory: true)
    let appBinURL = rootURL.appendingPathComponent("app/Contents/MacOS", isDirectory: true)
    try FileManager.default.createDirectory(at: userBinURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: appBinURL, withIntermediateDirectories: true)

    try """
    PATH="$HOME/.local/bin:$PATH"
    source "$GHOSTTY_RESOURCES_DIR/shell-integration/bash/ghostty.bash"
    """.write(
      to: homeURL.appendingPathComponent(".bashrc", isDirectory: false),
      atomically: true,
      encoding: .utf8
    )
    try writeExecutable(
      at: userBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'USER_CLAUDE\\n'
        """
    )
    try writeExecutable(
      at: appBinURL.appendingPathComponent("sp", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_SP\\n'
        """
    )
    try writeExecutable(
      at: appBinURL.appendingPathComponent("claude", isDirectory: false),
      script: """
        #!/bin/bash
        printf 'BUNDLED_CLAUDE\\n'
        """
    )

    let output = try runExecutable(
      at: URL(fileURLWithPath: "/bin/bash", isDirectory: false),
      arguments: [
        "--noprofile",
        "--rcfile",
        homeURL.appendingPathComponent(".bashrc", isDirectory: false).path,
        "-i",
        "-c",
        "sp; claude",
      ],
      environment: [
        "HOME": homeURL.path,
        "PATH": "/usr/bin:/bin",
        "SUPATERM_CLI_PATH": appBinURL.appendingPathComponent("sp", isDirectory: false).path,
        "GHOSTTY_RESOURCES_DIR": resourcesURL.path,
      ]
    )

    #expect(output.contains("BUNDLED_SP"))
    #expect(output.contains("BUNDLED_CLAUDE"))
    #expect(!output.contains("USER_CLAUDE"))
  }
}

private func installClaudeWrapper(at rootURL: URL) throws -> URL {
  let wrapperDirectory = rootURL.appendingPathComponent("wrapper-bin", isDirectory: true)
  let wrapperURL = wrapperDirectory.appendingPathComponent("claude", isDirectory: false)
  return try copyClaudeWrapper(to: wrapperURL)
}

private func copyClaudeWrapper(to wrapperURL: URL) throws -> URL {
  try FileManager.default.createDirectory(
    at: wrapperURL.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("Resources/bin/claude", isDirectory: false)
  try FileManager.default.copyItem(at: sourceURL, to: wrapperURL)
  try setExecutablePermissions(at: wrapperURL)
  return wrapperURL
}

private func writeFakeClaudeExecutable(at url: URL) throws {
  try writeExecutable(
    at: url,
    script: """
      #!/bin/bash
      i=0
      for arg in "$@"; do
        printf 'ARG[%d]=%s\n' "$i" "$arg"
        i=$((i + 1))
      done
      printf 'CLAUDECODE=%s\n' "${CLAUDECODE:-}"
      """
  )
}

private func writeFakeSPExecutable(
  at url: URL,
  logURL: URL,
  settingsJSON: String
) throws -> URL {
  let escapedLogPath = logURL.path.replacingOccurrences(of: "'", with: "'\"'\"'")
  let escapedSettingsJSON = settingsJSON.replacingOccurrences(of: "'", with: "'\"'\"'")
  let script = """
    #!/bin/bash
    printf '%s\\n' "$*" >> '\(escapedLogPath)'
    case "${1:-}" in
      ping)
        printf 'pong\\n'
        ;;
      claude-hook-settings)
        printf '%s' '\(escapedSettingsJSON)'
        ;;
      *)
        exit 1
        ;;
    esac
    """
  try script.write(to: url, atomically: true, encoding: .utf8)
  try setExecutablePermissions(at: url)
  return url
}

private func writeExecutable(
  at url: URL,
  script: String
) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try script.write(to: url, atomically: true, encoding: .utf8)
  try setExecutablePermissions(at: url)
}

private func setExecutablePermissions(at url: URL) throws {
  let result = url.path.withCString { pointer in
    chmod(pointer, mode_t(0o755))
  }
  guard result == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}

private func installGhosttyZshIntegration(at rootURL: URL) throws -> URL {
  let integrationURL = rootURL.appendingPathComponent("integration/zsh", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("ThirdParty/ghostty/src/shell-integration/zsh", isDirectory: true)
  try FileManager.default.copyItem(
    at: sourceRoot.appendingPathComponent(".zshenv", isDirectory: false),
    to: integrationURL.appendingPathComponent(".zshenv", isDirectory: false)
  )
  try FileManager.default.copyItem(
    at: sourceRoot.appendingPathComponent("ghostty-integration", isDirectory: false),
    to: integrationURL.appendingPathComponent("ghostty-integration", isDirectory: false)
  )
  return integrationURL
}

private func installGhosttyBashIntegration(at rootURL: URL) throws -> URL {
  let resourcesURL = rootURL.appendingPathComponent("resources", isDirectory: true)
  let integrationURL = resourcesURL.appendingPathComponent("shell-integration/bash", isDirectory: true)
  try FileManager.default.createDirectory(at: integrationURL, withIntermediateDirectories: true)
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("ThirdParty/ghostty/src/shell-integration/bash/ghostty.bash", isDirectory: false)
  try FileManager.default.copyItem(
    at: sourceURL,
    to: integrationURL.appendingPathComponent("ghostty.bash", isDirectory: false)
  )
  return resourcesURL
}

private func runExecutable(
  at executableURL: URL,
  arguments: [String],
  environment: [String: String]
) throws -> String {
  let process = Process()
  process.executableURL = executableURL
  process.arguments = arguments
  var processEnvironment = ProcessInfo.processInfo.environment
  for (key, value) in environment {
    processEnvironment[key] = value
  }
  process.environment = processEnvironment

  let stdoutPipe = Pipe()
  let stderrPipe = Pipe()
  process.standardOutput = stdoutPipe
  process.standardError = stderrPipe

  try process.run()
  process.waitUntilExit()

  let stdout =
    String(
      data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""
  let stderr =
    String(
      data: stderrPipe.fileHandleForReading.readDataToEndOfFile(),
      encoding: .utf8
    ) ?? ""

  if process.terminationStatus != 0 {
    Issue.record("Wrapper failed with status \(process.terminationStatus): \(stderr)")
  }
  return stdout
}

private func makeTemporaryDirectory() throws -> URL {
  var template = Array("/tmp/stm.XXXXXX".utf8CString)
  guard let pointer = mkdtemp(&template) else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  let path = SupatermSocketPath.canonicalized(String(cString: pointer)) ?? String(cString: pointer)
  return URL(fileURLWithPath: path, isDirectory: true)
}

private func createSocketNode(at url: URL) throws {
  _ = url.path.withCString(unlink)

  let socketDescriptor = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
  guard socketDescriptor >= 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
  defer { Darwin.close(socketDescriptor) }

  var address = sockaddr_un()
  memset(&address, 0, MemoryLayout<sockaddr_un>.size)
  address.sun_family = sa_family_t(AF_UNIX)

  let path = url.path
  let maxLength = MemoryLayout.size(ofValue: address.sun_path)
  guard path.utf8.count < maxLength else {
    throw POSIXError(.ENAMETOOLONG)
  }

  path.withCString { pointer in
    withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
      let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
      strncpy(buffer, pointer, maxLength - 1)
    }
  }

  let bindResult = withUnsafePointer(to: &address) { pointer in
    pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
      Darwin.bind(socketDescriptor, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size))
    }
  }
  guard bindResult == 0 else {
    throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
  }
}
