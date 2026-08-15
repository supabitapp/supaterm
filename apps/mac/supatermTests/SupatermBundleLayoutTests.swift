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
    let hostURL = helpersURL.appendingPathComponent("supaterm-host", isDirectory: false)
    let zmxURL = helpersURL.appendingPathComponent("zmx", isDirectory: false)
    try FileManager.default.createDirectory(at: macOSURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)
    try Data().write(to: spURL)
    try Data().write(to: hostURL)
    try Data().write(to: zmxURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: spURL.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: hostURL.path)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: zmxURL.path)

    #expect(SupatermBundleLayout.spExecutableURL(nextTo: executableURL) == spURL)
    #expect(SupatermBundleLayout.hostExecutableURL(nextTo: executableURL) == hostURL)
    #expect(SupatermBundleLayout.zmxExecutableURL(nextTo: executableURL) == zmxURL)
    #expect(
      SupatermBundleLayout.resourcesDirectoryURL(nextTo: executableURL)
        == contentsURL.appendingPathComponent("Resources", isDirectory: true)
    )
  }

  @Test
  func rejectsMissingNonExecutableAndLinkedHostExecutables() throws {
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
    let hostURL = helpersURL.appendingPathComponent("supaterm-host", isDirectory: false)
    let linkedHostURL = helpersURL.appendingPathComponent("real-supaterm-host", isDirectory: false)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)

    #expect(SupatermBundleLayout.hostExecutableURL(nextTo: executableURL) == nil)

    try Data().write(to: hostURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: hostURL.path)
    #expect(SupatermBundleLayout.hostExecutableURL(nextTo: executableURL) == nil)

    try FileManager.default.removeItem(at: hostURL)
    try Data().write(to: linkedHostURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: linkedHostURL.path)
    try FileManager.default.createSymbolicLink(at: hostURL, withDestinationURL: linkedHostURL)
    #expect(SupatermBundleLayout.hostExecutableURL(nextTo: executableURL) == nil)
  }

  @Test
  func rejectsMissingNonExecutableAndLinkedZmxExecutables() throws {
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
    let zmxURL = helpersURL.appendingPathComponent("zmx", isDirectory: false)
    let linkedZmxURL = helpersURL.appendingPathComponent("real-zmx", isDirectory: false)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)

    #expect(SupatermBundleLayout.zmxExecutableURL(nextTo: executableURL) == nil)

    try Data().write(to: zmxURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: zmxURL.path)
    #expect(SupatermBundleLayout.zmxExecutableURL(nextTo: executableURL) == nil)

    try FileManager.default.removeItem(at: zmxURL)
    try Data().write(to: linkedZmxURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: linkedZmxURL.path)
    try FileManager.default.createSymbolicLink(at: zmxURL, withDestinationURL: linkedZmxURL)
    #expect(SupatermBundleLayout.zmxExecutableURL(nextTo: executableURL) == nil)
  }
}
