import Darwin
import Foundation
import Testing

@testable import SupatermCLIShared

struct ClaudeWrapperTests {
  @Test
  func wrapperInjectsSettingsInsideSupatermPane() throws {
    let rootURL = try makeClaudeWrapperTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let socketURL = rootURL.appendingPathComponent("supaterm.sock", isDirectory: false)
    try createSocketNode(at: socketURL)

    let output = try runClaudeWrapper(
      wrapperURL: wrapperURL,
      arguments: [],
      environment: [
        "PATH": "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)",
        SupatermCLIEnvironment.cliPathKey: "/Applications/Supaterm.app/Contents/MacOS/sp",
        SupatermCLIEnvironment.socketPathKey: socketURL.path,
        SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
        "CLAUDECODE": "nested",
      ]
    )

    #expect(output.contains("ARG[0]=--settings"))
    #expect(output.contains("\"SessionStart\""))
    #expect(output.contains("\"Notification\""))
    #expect(output.contains("\"SessionEnd\""))
    #expect(output.contains("\\\"$SUPATERM_CLI_PATH\\\" claude-hook || true"))
    #expect(output.contains("CLAUDECODE="))
    #expect(!output.contains("CLAUDECODE=nested"))
  }

  @Test
  func wrapperPassesThroughOutsideSupaterm() throws {
    let rootURL = try makeClaudeWrapperTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let output = try runClaudeWrapper(
      wrapperURL: wrapperURL,
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
    let rootURL = try makeClaudeWrapperTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let wrapperURL = try installClaudeWrapper(at: rootURL)
    let realBinURL = rootURL.appendingPathComponent("real-bin", isDirectory: true)
    try FileManager.default.createDirectory(at: realBinURL, withIntermediateDirectories: true)
    try writeFakeClaudeExecutable(at: realBinURL.appendingPathComponent("claude", isDirectory: false))

    let basePath = "\(wrapperURL.deletingLastPathComponent().path):\(realBinURL.path)"
    let unavailableSocketOutput = try runClaudeWrapper(
      wrapperURL: wrapperURL,
      arguments: ["hello"],
      environment: [
        "PATH": basePath,
        SupatermCLIEnvironment.socketPathKey: rootURL.appendingPathComponent("missing.sock").path,
        SupatermCLIEnvironment.surfaceIDKey: UUID().uuidString,
      ]
    )
    #expect(unavailableSocketOutput.contains("ARG[0]=hello"))
    #expect(!unavailableSocketOutput.contains("ARG[0]=--settings"))

    let disabledOutput = try runClaudeWrapper(
      wrapperURL: wrapperURL,
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
    let rootURL = try makeClaudeWrapperTemporaryDirectory()
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
      let output = try runClaudeWrapper(
        wrapperURL: wrapperURL,
        arguments: arguments,
        environment: baseEnvironment
      )
      #expect(output.contains("ARG[0]=\(arguments[0])"))
      #expect(!output.contains("ARG[0]=--settings"))
    }
  }
}

private func installClaudeWrapper(at rootURL: URL) throws -> URL {
  let wrapperDirectory = rootURL.appendingPathComponent("wrapper-bin", isDirectory: true)
  try FileManager.default.createDirectory(at: wrapperDirectory, withIntermediateDirectories: true)
  let wrapperURL = wrapperDirectory.appendingPathComponent("claude", isDirectory: false)
  let sourceURL = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
    .appendingPathComponent("Resources/bin/claude", isDirectory: false)
  try FileManager.default.copyItem(at: sourceURL, to: wrapperURL)
  try setExecutablePermissions(at: wrapperURL)
  return wrapperURL
}

private func writeFakeClaudeExecutable(at url: URL) throws {
  let script = """
    #!/bin/bash
    i=0
    for arg in "$@"; do
      printf 'ARG[%d]=%s\n' "$i" "$arg"
      i=$((i + 1))
    done
    printf 'CLAUDECODE=%s\n' "${CLAUDECODE:-}"
    """
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

private func runClaudeWrapper(
  wrapperURL: URL,
  arguments: [String],
  environment: [String: String]
) throws -> String {
  let process = Process()
  process.executableURL = wrapperURL
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

private func makeClaudeWrapperTemporaryDirectory() throws -> URL {
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
