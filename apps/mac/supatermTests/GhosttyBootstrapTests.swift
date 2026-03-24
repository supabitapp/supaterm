import Foundation
import Testing

@testable import supaterm

struct GhosttyBootstrapTests {
  @Test
  func bundledCommandDirectoryUsesResourcesBin() {
    let resourcesURL = URL(fileURLWithPath: "/Applications/Supaterm.app/Contents/Resources", isDirectory: true)

    #expect(
      GhosttyBootstrap.bundledCommandDirectory(resourcesURL: resourcesURL)
        == resourcesURL.appendingPathComponent("bin", isDirectory: true)
    )
    #expect(
      GhosttyBootstrap.bundledCLIPath(resourcesURL: resourcesURL)
        == "/Applications/Supaterm.app/Contents/Resources/bin/sp"
    )
  }

  @Test
  func hostedConfigOverrideTargetsBundledCommandDirectory() {
    let resourcesURL = URL(fileURLWithPath: #"/Applications/Supaterm "Dev"/Contents/Resources"#, isDirectory: true)

    #expect(
      GhosttyBootstrap.hostedConfigOverride(resourcesURL: resourcesURL)
        == #"shell-integration-preferred-bin-dir = "/Applications/Supaterm \"Dev\"/Contents/Resources/bin""#
    )
  }

  @Test
  func resourceDirectoriesRequirePreservedGhosttyFolders() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let ghosttyURL = rootURL.appendingPathComponent("ghostty", isDirectory: true)
    let terminfoURL = rootURL.appendingPathComponent("terminfo", isDirectory: true)
    try FileManager.default.createDirectory(at: ghosttyURL, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: terminfoURL, withIntermediateDirectories: true)

    let resourceDirectories = GhosttyBootstrap.resourceDirectories(resourcesURL: rootURL)

    #expect(resourceDirectories?.ghostty == ghosttyURL)
    #expect(resourceDirectories?.terminfo == terminfoURL)
  }

  @Test
  func resourceDirectoriesRejectFlattenedGhosttyResources() throws {
    let rootURL = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let ghosttyURL = rootURL.appendingPathComponent("ghostty")
    let xtermGhosttyURL = rootURL.appendingPathComponent("xterm-ghostty")
    FileManager.default.createFile(atPath: ghosttyURL.path, contents: Data())
    FileManager.default.createFile(atPath: xtermGhosttyURL.path, contents: Data())

    #expect(GhosttyBootstrap.resourceDirectories(resourcesURL: rootURL) == nil)
  }

  @Test
  func configFileLocationsUseXdgConfigHomeWhenPresent() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)
    let xdgConfigHomeURL = URL(fileURLWithPath: "/tmp/supaterm-xdg", isDirectory: true)

    let locations = GhosttyBootstrap.configFileLocations(
      homeDirectoryURL: homeDirectoryURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    let xdgDirectoryURL = xdgConfigHomeURL.appendingPathComponent("ghostty", isDirectory: true)

    #expect(
      locations.preferred
        == xdgDirectoryURL
        .appendingPathComponent("config", isDirectory: false)
    )
  }

  @Test
  func configFileLocationsFallBackToDotConfigWhenXdgConfigHomeIsMissing() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)

    let locations = GhosttyBootstrap.configFileLocations(
      homeDirectoryURL: homeDirectoryURL,
      environment: [:]
    )

    #expect(
      locations.preferred
        == homeDirectoryURL
        .appendingPathComponent(".config", isDirectory: true)
        .appendingPathComponent("ghostty", isDirectory: true)
        .appendingPathComponent("config", isDirectory: false)
    )
  }

  @Test
  func seedDefaultConfigCreatesLegacyXdgConfigWhenNoConfigExists() throws {
    let rootURL = try makeGhosttyBootstrapTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgConfigHomeURL = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let locations = GhosttyBootstrap.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    try GhosttyBootstrap.seedDefaultConfigIfNeeded(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    let contents = try String(contentsOf: locations.preferred, encoding: .utf8)

    #expect(contents == GhosttyBootstrap.defaultConfigContents)
  }

  @Test
  func seedDefaultConfigSkipsWhenCanonicalConfigAlreadyExists() throws {
    let rootURL = try makeGhosttyBootstrapTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgConfigHomeURL = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let locations = GhosttyBootstrap.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    try writeGhosttyBootstrapFile(at: locations.preferred, contents: "existing")

    try GhosttyBootstrap.seedDefaultConfigIfNeeded(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    let contents = try String(contentsOf: locations.preferred, encoding: .utf8)
    #expect(contents == "existing")
  }
}

private func makeGhosttyBootstrapTemporaryDirectory() throws -> URL {
  let rootURL = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString, isDirectory: true)
  try FileManager.default.createDirectory(at: rootURL, withIntermediateDirectories: true)
  return rootURL
}

private func writeGhosttyBootstrapFile(at url: URL, contents: String) throws {
  try FileManager.default.createDirectory(
    at: url.deletingLastPathComponent(),
    withIntermediateDirectories: true
  )
  try contents.write(to: url, atomically: true, encoding: .utf8)
}
