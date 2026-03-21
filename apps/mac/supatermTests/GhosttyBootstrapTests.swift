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
}
