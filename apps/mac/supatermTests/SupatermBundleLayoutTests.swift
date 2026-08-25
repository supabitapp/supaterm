import Foundation
import SupatermCLIShared
import Testing

struct SupatermBundleLayoutTests {
  @Test
  func resolvesBundledExecutablesAndResources() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let contentsURL =
      rootURL
      .appendingPathComponent("Supaterm.app", isDirectory: true)
      .appendingPathComponent("Contents", isDirectory: true)
    let macOSURL = contentsURL.appendingPathComponent("MacOS", isDirectory: true)
    let helpersURL = contentsURL.appendingPathComponent("Helpers", isDirectory: true)
    let executableURL = macOSURL.appendingPathComponent("supaterm", isDirectory: false)
    let spURL = macOSURL.appendingPathComponent("sp", isDirectory: false)
    let sessionHostURL = helpersURL.appendingPathComponent("supaterm-host", isDirectory: false)
    let remoteHostURL =
      contentsURL
      .appendingPathComponent("Resources/supaterm-host/linux-aarch64", isDirectory: true)
      .appendingPathComponent("supaterm-host", isDirectory: false)
    try FileManager.default.createDirectory(at: macOSURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)
    try Data().write(to: spURL)
    try Data().write(to: sessionHostURL)
    try FileManager.default.createDirectory(
      at: remoteHostURL.deletingLastPathComponent(),
      withIntermediateDirectories: true
    )
    try Data().write(to: remoteHostURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: spURL.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: sessionHostURL.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: remoteHostURL.path)

    #expect(SupatermBundleLayout.spExecutableURL(nextTo: executableURL) == spURL)
    #expect(SupatermBundleLayout.sessionHostExecutableURL(nextTo: executableURL) == sessionHostURL)
    #expect(
      SupatermBundleLayout.remoteSessionHostExecutableURL(
        nextTo: executableURL,
        platform: .linuxAArch64
      ) == remoteHostURL
    )
    #expect(
      SupatermBundleLayout.resourcesDirectoryURL(nextTo: executableURL)
        == contentsURL.appendingPathComponent("Resources", isDirectory: true)
    )

    let testExecutableURL =
      contentsURL
      .appendingPathComponent("PlugIns/supatermTests.xctest/Contents/MacOS", isDirectory: true)
      .appendingPathComponent("supatermTests", isDirectory: false)
    #expect(SupatermBundleLayout.spExecutableURL(nextTo: testExecutableURL) == spURL)
    #expect(SupatermBundleLayout.sessionHostExecutableURL(nextTo: testExecutableURL) == sessionHostURL)
  }

  @Test
  func rejectsMissingNonExecutableAndLinkedSessionHostExecutables() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let contentsURL =
      rootURL
      .appendingPathComponent("Supaterm.app", isDirectory: true)
      .appendingPathComponent("Contents", isDirectory: true)
    let helpersURL = contentsURL.appendingPathComponent("Helpers", isDirectory: true)
    let executableURL =
      contentsURL
      .appendingPathComponent("MacOS", isDirectory: true)
      .appendingPathComponent("supaterm", isDirectory: false)
    let sessionHostURL = helpersURL.appendingPathComponent("supaterm-host", isDirectory: false)
    let linkedSessionHostURL = helpersURL.appendingPathComponent("real-supaterm-host", isDirectory: false)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)

    #expect(SupatermBundleLayout.sessionHostExecutableURL(nextTo: executableURL) == nil)

    try Data().write(to: sessionHostURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: sessionHostURL.path)
    #expect(SupatermBundleLayout.sessionHostExecutableURL(nextTo: executableURL) == nil)

    try FileManager.default.removeItem(at: sessionHostURL)
    try Data().write(to: linkedSessionHostURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: linkedSessionHostURL.path)
    try FileManager.default.createSymbolicLink(at: sessionHostURL, withDestinationURL: linkedSessionHostURL)
    #expect(SupatermBundleLayout.sessionHostExecutableURL(nextTo: executableURL) == nil)
  }

  @Test
  func mapsRemotePlatformAliases() {
    #expect(SupatermSessionHostPlatform(operatingSystem: "Linux", architecture: "amd64") == .linuxX86_64)
    #expect(SupatermSessionHostPlatform(operatingSystem: "Linux", architecture: "arm64") == .linuxAArch64)
    #expect(SupatermSessionHostPlatform(operatingSystem: "Darwin", architecture: "x86_64") == .macOSX86_64)
    #expect(SupatermSessionHostPlatform(operatingSystem: "Darwin", architecture: "aarch64") == .macOSAArch64)
    #expect(SupatermSessionHostPlatform(operatingSystem: "FreeBSD", architecture: "x86_64") == nil)
  }
}
