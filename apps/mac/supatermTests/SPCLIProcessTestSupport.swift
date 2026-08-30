import Darwin
import Foundation
import SupatermCLIShared
import SupatermSupport

struct SPCLIResult: Equatable {
  let exitCode: Int32
  let stdout: String
  let stderr: String
}

struct SPCLIError: Error, CustomStringConvertible {
  let description: String
}

struct SPCLIHarness {
  let rootURL: URL
  let homeURL: URL
  let stateHomeURL: URL
  var environment: [String: String]

  init() throws {
    var template = Array("/tmp/spc.XXXXXX".utf8CString)
    guard let pointer = mkdtemp(&template) else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
    rootURL = URL(fileURLWithPath: String(cString: pointer), isDirectory: true)
    homeURL = rootURL.appendingPathComponent("home", isDirectory: true)
    stateHomeURL = rootURL.appendingPathComponent("state", isDirectory: true)
    let runtimeURL = rootURL.appendingPathComponent("runtime", isDirectory: true)
    for url in [homeURL, stateHomeURL, runtimeURL] {
      try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
    environment = [
      "HOME": homeURL.path,
      "PATH": "/usr/bin:/bin:/usr/sbin:/sbin",
      "TMPDIR": runtimeURL.path,
      "XDG_RUNTIME_DIR": runtimeURL.path,
      SupatermCLIEnvironment.stateHomeKey: stateHomeURL.path,
      SupatermCLIEnvironment.testHomeKey: homeURL.path,
      SupatermCLIEnvironment.testSocketRootKey: runtimeURL.path,
    ]
  }

  var settingsURL: URL {
    stateHomeURL.appendingPathComponent("settings.toml", isDirectory: false)
  }

  var claudeSettingsURL: URL {
    ClaudeSettingsInstaller.settingsURL(homeDirectoryURL: homeURL)
  }

  func remove() {
    try? FileManager.default.removeItem(at: rootURL)
  }

  func run(_ arguments: [String], standardInput: String? = nil) throws -> SPCLIResult {
    let outputURL = rootURL.appendingPathComponent("stdout", isDirectory: false)
    let errorURL = rootURL.appendingPathComponent("stderr", isDirectory: false)
    for url in [outputURL, errorURL] {
      try Data().write(to: url)
    }
    let outputHandle = try FileHandle(forWritingTo: outputURL)
    let errorHandle = try FileHandle(forWritingTo: errorURL)
    let inputHandle: FileHandle?
    if let standardInput {
      let inputURL = rootURL.appendingPathComponent("stdin", isDirectory: false)
      try Data(standardInput.utf8).write(to: inputURL)
      inputHandle = try FileHandle(forReadingFrom: inputURL)
    } else {
      inputHandle = nil
    }
    defer {
      try? outputHandle.close()
      try? errorHandle.close()
      try? inputHandle?.close()
    }

    let process = Process()
    process.executableURL = try spExecutableURL()
    process.arguments = arguments
    process.environment = environment
    process.currentDirectoryURL = homeURL
    process.standardInput = inputHandle ?? FileHandle.nullDevice
    process.standardOutput = outputHandle
    process.standardError = errorHandle
    try process.run()

    let deadline = Date().addingTimeInterval(30)
    while process.isRunning, Date() < deadline {
      usleep(20_000)
    }
    guard !process.isRunning else {
      kill(process.processIdentifier, SIGKILL)
      process.waitUntilExit()
      throw SPCLIError(description: "sp timed out: \(arguments.joined(separator: " "))")
    }
    process.waitUntilExit()

    return SPCLIResult(
      exitCode: process.terminationStatus,
      stdout: try text(at: outputURL),
      stderr: try text(at: errorURL)
    )
  }

  private func text(at url: URL) throws -> String {
    let data = try Data(contentsOf: url)
    guard let text = String(bytes: data, encoding: .utf8) else {
      throw SPCLIError(description: "sp emitted non-UTF-8 output")
    }
    return text
  }
}

private final class SPCLIBundleToken {}

private func spExecutableURL() throws -> URL {
  let url = Bundle(for: SPCLIBundleToken.self).bundleURL
    .deletingLastPathComponent()
    .appendingPathComponent("supaterm.app/Contents/MacOS/sp", isDirectory: false)
  guard FileManager.default.isExecutableFile(atPath: url.path) else {
    throw SPCLIError(description: "Missing \(url.path). Build the supaterm scheme first.")
  }
  return url
}
