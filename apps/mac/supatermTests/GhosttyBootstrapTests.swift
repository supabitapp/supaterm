import Foundation
import SupatermCLIShared
import SupatermSupport
import Testing

@testable import supaterm

struct GhosttyBootstrapTests {
  @Test
  func missingResourcesStopBeforeCoreInitialization() {
    var coreInitialized = false

    #expect(throws: GhosttyBootstrapError.missingResources) {
      try GhosttyBootstrap.initialize(
        resourceDirectories: { nil },
        seedDefaultConfig: {},
        setEnvironment: { _, _ in true },
        initializeCore: {
          coreInitialized = true
          return 0
        }
      )
    }

    #expect(!coreInitialized)
  }

  @Test
  func configSeedFailureStopsBeforeEnvironmentAndCoreInitialization() {
    var operations: [String] = []

    #expect(throws: GhosttyBootstrapError.configSeedFailed("seed failed")) {
      try GhosttyBootstrap.initialize(
        resourceDirectories: { ghosttyBootstrapResourceDirectories() },
        seedDefaultConfig: { throw GhosttyBootstrapTestError.seedFailure },
        setEnvironment: { _, _ in
          operations.append("environment")
          return true
        },
        initializeCore: {
          operations.append("core")
          return 0
        }
      )
    }

    #expect(operations.isEmpty)
  }

  @Test
  func environmentFailureStopsBeforeCoreInitialization() {
    var coreInitialized = false

    #expect(throws: GhosttyBootstrapError.environmentSetFailed("TERMINFO_DIRS")) {
      try GhosttyBootstrap.initialize(
        resourceDirectories: { ghosttyBootstrapResourceDirectories() },
        seedDefaultConfig: {},
        setEnvironment: { name, _ in name != "TERMINFO_DIRS" },
        initializeCore: {
          coreInitialized = true
          return 0
        }
      )
    }

    #expect(!coreInitialized)
  }

  @Test
  func coreInitializationFailureReportsStatus() {
    #expect(throws: GhosttyBootstrapError.coreInitializationFailed(17)) {
      try GhosttyBootstrap.initialize(
        resourceDirectories: { ghosttyBootstrapResourceDirectories() },
        seedDefaultConfig: {},
        setEnvironment: { _, _ in true },
        initializeCore: { 17 }
      )
    }
  }

  @Test
  func successfulBootstrapSetsEnvironmentBeforeCoreInitialization() throws {
    var operations: [String] = []

    try GhosttyBootstrap.initialize(
      resourceDirectories: { ghosttyBootstrapResourceDirectories() },
      seedDefaultConfig: {},
      setEnvironment: { name, value in
        operations.append("\(name)=\(value)")
        return true
      },
      initializeCore: {
        operations.append("core")
        return 0
      }
    )

    #expect(
      operations == [
        "GHOSTTY_RESOURCES_DIR=/Resources/ghostty",
        "TERMINFO_DIRS=/Resources/terminfo",
        "core",
      ]
    )
  }

  @Test
  func bundledCommandDirectoryUsesResourcesBin() {
    let resourcesURL = URL(fileURLWithPath: "/Applications/Supaterm.app/Contents/Resources", isDirectory: true)

    #expect(
      GhosttySupport.bundledCommandDirectory(resourcesURL: resourcesURL)
        == resourcesURL.appendingPathComponent("bin", isDirectory: true)
    )
    #expect(
      GhosttySupport.bundledCLIPath(resourcesURL: resourcesURL)
        == "/Applications/Supaterm.app/Contents/Resources/bin/sp"
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

    let resourceDirectories = GhosttySupport.resourceDirectories(resourcesURL: rootURL)

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

    #expect(GhosttySupport.resourceDirectories(resourcesURL: rootURL) == nil)
  }

  @Test
  func configFileLocationsUseXdgConfigHomeWhenPresent() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)
    let xdgConfigHomeURL = URL(fileURLWithPath: "/tmp/supaterm-xdg", isDirectory: true)

    let locations = GhosttySupport.configFileLocations(
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
  func configFileLocationsUseStateHomeWhenPresent() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)
    let stateHomeURL = URL(fileURLWithPath: "/tmp/supaterm-state", isDirectory: true)

    let locations = GhosttySupport.configFileLocations(
      homeDirectoryURL: homeDirectoryURL,
      environment: [
        SupatermCLIEnvironment.stateHomeKey: stateHomeURL.path,
        "XDG_CONFIG_HOME": "/tmp/ignored",
      ]
    )

    #expect(
      locations.preferred
        == stateHomeURL
        .appendingPathComponent("ghostty", isDirectory: true)
        .appendingPathComponent("config", isDirectory: false)
    )
  }

  @Test
  func configFileLocationsFallBackToDotConfigWhenXdgConfigHomeIsMissing() throws {
    let homeDirectoryURL = URL(fileURLWithPath: "/tmp/supaterm-home", isDirectory: true)

    let locations = GhosttySupport.configFileLocations(
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
    let locations = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    try GhosttySupport.seedDefaultConfigIfNeeded(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    let contents = try String(contentsOf: locations.preferred, encoding: .utf8)

    #expect(contents.contains("cursor-style = block"))
    #expect(contents == GhosttySupport.defaultConfigContents)
  }

  @Test
  func seedDefaultConfigSkipsWhenCanonicalConfigAlreadyExists() throws {
    let rootURL = try makeGhosttyBootstrapTemporaryDirectory()
    defer { try? FileManager.default.removeItem(at: rootURL) }

    let xdgConfigHomeURL = rootURL.appendingPathComponent("xdg", isDirectory: true)
    let locations = GhosttySupport.configFileLocations(
      homeDirectoryURL: rootURL,
      environment: ["XDG_CONFIG_HOME": xdgConfigHomeURL.path]
    )

    try writeGhosttyBootstrapFile(at: locations.preferred, contents: "existing")

    try GhosttySupport.seedDefaultConfigIfNeeded(
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

private func ghosttyBootstrapResourceDirectories() -> (ghostty: URL, terminfo: URL) {
  (
    ghostty: URL(fileURLWithPath: "/Resources/ghostty", isDirectory: true),
    terminfo: URL(fileURLWithPath: "/Resources/terminfo", isDirectory: true)
  )
}

private enum GhosttyBootstrapTestError: LocalizedError {
  case seedFailure

  var errorDescription: String? {
    "seed failed"
  }
}
