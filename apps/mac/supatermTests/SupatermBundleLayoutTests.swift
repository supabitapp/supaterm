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
    let hostURL = helpersURL.appendingPathComponent(
      SupatermBundleLayout.hostExecutableName,
      isDirectory: false
    )
    let zmxURL = helpersURL.appendingPathComponent(
      SupatermBundleLayout.zmxExecutableName,
      isDirectory: false
    )
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
  func rejectsInvalidHelperExecutables() throws {
    try expectInvalidHelperExecutable(
      named: SupatermBundleLayout.hostExecutableName,
      resolve: { SupatermBundleLayout.hostExecutableURL(nextTo: $0) }
    )
    try expectInvalidHelperExecutable(
      named: SupatermBundleLayout.zmxExecutableName,
      resolve: { SupatermBundleLayout.zmxExecutableURL(nextTo: $0) }
    )
  }

  private func expectInvalidHelperExecutable(
    named name: String,
    resolve: (URL) -> URL?
  ) throws {
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
    let helperURL = helpersURL.appendingPathComponent(name, isDirectory: false)
    let linkedHelperURL = helpersURL.appendingPathComponent("real-\(name)", isDirectory: false)
    try FileManager.default.createDirectory(at: helpersURL, withIntermediateDirectories: true)

    #expect(resolve(executableURL) == nil)

    try Data().write(to: helperURL)
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: helperURL.path)
    #expect(resolve(executableURL) == nil)

    try FileManager.default.removeItem(at: helperURL)
    try Data().write(to: linkedHelperURL)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: linkedHelperURL.path
    )
    try FileManager.default.createSymbolicLink(at: helperURL, withDestinationURL: linkedHelperURL)
    #expect(resolve(executableURL) == nil)
  }
}
