import Foundation
import Testing

@testable import supaterm

struct GhosttyBootstrapTests {
  @Test
  func bootstrapDoesNotOverrideGhosttyTerminalShortcuts() {
    #expect(GhosttyBootstrap.extraCLIArguments.isEmpty)
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
  func configFileLocationsPreferLegacyXdgConfigTarget() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)
    let xdgConfigHomeURL = URL(fileURLWithPath: "/tmp/supaterm-xdg", isDirectory: true)

    let locations = try #require(
      GhosttyBootstrap.configFileLocations(
        bundleIdentifier: "app.supabit.supaterm",
        homeDirectoryURL: homeDirectoryURL,
        environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
      )
    )

    let appSupportDirectoryURL =
      homeDirectoryURL
      .appendingPathComponent("Library", isDirectory: true)
      .appendingPathComponent("Application Support", isDirectory: true)
      .appendingPathComponent("app.supabit.supaterm", isDirectory: true)
    let xdgDirectoryURL = xdgConfigHomeURL.appendingPathComponent("ghostty", isDirectory: true)

    #expect(
      locations.preferred
        == xdgDirectoryURL
        .appendingPathComponent("config", isDirectory: false)
    )
    #expect(
      locations.candidates == [
        xdgDirectoryURL.appendingPathComponent("config", isDirectory: false),
        xdgDirectoryURL.appendingPathComponent("config.ghostty", isDirectory: false),
        appSupportDirectoryURL.appendingPathComponent("config.ghostty", isDirectory: false),
        appSupportDirectoryURL.appendingPathComponent("config", isDirectory: false),
      ]
    )
  }

  @Test
  func seedDefaultConfigCreatesLegacyXdgConfigWhenNoConfigExists() throws {
    let rootURL = try makeGhosttyBootstrapTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgConfigHomeURL = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let locations = try #require(
      GhosttyBootstrap.configFileLocations(
        bundleIdentifier: "app.supabit.supaterm",
        homeDirectoryURL: rootURL,
        environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
      )
    )

    try GhosttyBootstrap.seedDefaultConfigIfNeeded(
      bundleIdentifier: "app.supabit.supaterm",
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    let contents = try String(contentsOf: locations.preferred, encoding: .utf8)

    #expect(contents == GhosttyBootstrap.defaultConfigContents)
  }

  @Test
  func seedDefaultConfigSkipsWhenAnyCanonicalConfigAlreadyExists() throws {
    let rootURL = try makeGhosttyBootstrapTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    for index in 0..<4 {
      let isolatedRootURL = rootURL.appendingPathComponent(UUID().uuidString, isDirectory: true)
      try FileManager.default.createDirectory(at: isolatedRootURL, withIntermediateDirectories: true)

      let xdgConfigHomeURL = isolatedRootURL.appendingPathComponent("xdg", isDirectory: true)
      let locations = try #require(
        GhosttyBootstrap.configFileLocations(
          bundleIdentifier: "app.supabit.supaterm",
          homeDirectoryURL: isolatedRootURL,
          environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
        )
      )

      let existingURL = locations.candidates[index]
      try writeGhosttyBootstrapFile(at: existingURL, contents: "existing")

      try GhosttyBootstrap.seedDefaultConfigIfNeeded(
        bundleIdentifier: "app.supabit.supaterm",
        homeDirectoryURL: isolatedRootURL,
        environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
      )

      #expect(
        GhosttyBootstrap.existingConfigFileURL(in: locations.candidates) == existingURL
      )

      if existingURL == locations.preferred {
        let contents = try String(contentsOf: locations.preferred, encoding: .utf8)
        #expect(contents == "existing")
      } else {
        #expect(!FileManager.default.fileExists(atPath: locations.preferred.path))
      }
    }
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
